// 高层业务流程：登录检测、搜索、详情、打招呼（含导航后备）、聊天编排
import { bossEval, bossWindowOpen } from "./tauri";
import {
  chatListScript,
  chatMessagesScript,
  chatOpenScript,
  chatSendScript,
  cityGroupScript,
  greetFetchScript,
  greetFireScript,
  greetLiveExtractScript,
  hotCityScript,
  jobDetailScript,
  loginProbeScript,
  navigateScript,
  pageStateScript,
  searchJobsScript,
} from "./bossJs";
import { CHAT_URL, RISK_PATTERN } from "../constants";
import type {
  ChatMessage,
  Conversation,
  Job,
  JobDetail,
  LoginState,
  SearchFilters,
} from "../types";

export class BossError extends Error {
  kind: "login" | "risk" | "no-window" | "generic";
  constructor(kind: BossError["kind"], message: string) {
    super(message);
    this.kind = kind;
  }
}

interface SearchResponse {
  code?: number;
  message?: string;
  __httpStatus?: number;
  zpData?: { jobList?: Job[] };
}

/** 统一解释搜索类接口的响应，登录/风控直接抛 BossError */
function interpretSearch(json: SearchResponse): Job[] {
  if (json.__httpStatus === 401) {
    throw new BossError("login", "未登录或登录已过期，请在 BOSS 窗口扫码登录");
  }
  if (json.__httpStatus === 403 || json.__httpStatus === 429) {
    throw new BossError("risk", `请求被限制（HTTP ${json.__httpStatus}），请稍后再试`);
  }
  const code = json.code ?? -1;
  const msg = json.message || "";
  if (code === 31 || code === 37 || RISK_PATTERN.test(msg)) {
    throw new BossError(
      "risk",
      `触发风控（code=${code}${msg ? `，${msg}` : ""}）。请停止操作，在 BOSS 窗口中完成滑块/安全验证，并等待几分钟后再试`
    );
  }
  if (code !== 0) {
    throw new BossError("generic", msg || `接口返回 code=${code}`);
  }
  return json.zpData?.jobList ?? [];
}

async function ensureWindow(): Promise<void> {
  if (!(await bossWindowOpen())) {
    throw new BossError("no-window", "内置浏览器未启动，请先点击顶栏「扫码登录」");
  }
}

export async function checkLogin(): Promise<LoginState> {
  if (!(await bossWindowOpen())) return "no-window";
  try {
    const json = await bossEval<SearchResponse>(loginProbeScript(), 20000);
    if (json.__httpStatus === 401) return "not-logged-in";
    if (json.__httpStatus === 403 || json.__httpStatus === 429) return "risk";
    const code = json.code ?? -1;
    if (code === 31 || code === 37 || RISK_PATTERN.test(json.message || ""))
      return "risk";
    if (code !== 0) return "unknown";
    const list = json.zpData?.jobList ?? [];
    if (list.length === 0) return "unknown";
    const hasSalary = list.some((j) => (j.salaryDesc || "").trim().length > 0);
    return hasSalary ? "logged-in" : "not-logged-in";
  } catch {
    return "unknown";
  }
}

export async function searchJobs(
  f: SearchFilters,
  page: number,
  pageSize: number
): Promise<Job[]> {
  await ensureWindow();
  const json = await bossEval<SearchResponse>(
    searchJobsScript(f, page, pageSize),
    30000
  );
  return interpretSearch(json);
}

export async function fetchJobDetail(job: Job): Promise<JobDetail> {
  await ensureWindow();
  const r = await bossEval<{
    ok: boolean;
    jd?: string;
    skills?: string[];
    error?: string;
    errorType?: string;
  }>(jobDetailScript(job), 30000);
  if (!r.ok) {
    const kind = r.errorType === "login" ? "login" : r.errorType === "risk" ? "risk" : "generic";
    throw new BossError(kind, r.error || "获取职位详情失败");
  }
  return { jd: r.jd || "", skills: r.skills || [] };
}

export interface GreetResult {
  ok: boolean;
  message: string;
  redirect: string | null;
  /** 模板消息是否已尝试发送（仅单次打招呼流程） */
  templateSent?: boolean;
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

/** 轮询 BOSS 窗口页面状态直到满足条件 */
async function pollPageState(
  pred: (href: string, ready: string) => boolean,
  timeoutMs: number,
  intervalMs = 1000
): Promise<boolean> {
  const t0 = Date.now();
  while (Date.now() - t0 < timeoutMs) {
    try {
      const s = await bossEval<{ href: string; ready: string }>(
        pageStateScript(),
        5000
      );
      if (pred(s.href, s.ready)) return true;
    } catch {
      /* 页面跳转中，继续等待 */
    }
    await sleep(intervalMs);
  }
  return false;
}

/** 导航 BOSS 窗口（导航脚本会超时，catch 后轮询） */
async function navigateBoss(url: string): Promise<void> {
  try {
    await bossEval(navigateScript(url), 3000);
  } catch {
    /* 导航导致 eval 上下文销毁，属预期 */
  }
}

/**
 * 打招呼（单次）：fetch 优先；动态渲染时导航到详情页从实时 DOM 提取。
 * 成功后若提供 templateText 且有 redirect，则导航到聊天页发送模板消息（尽力而为）。
 */
export async function greetJob(
  job: Job,
  templateText?: string
): Promise<GreetResult> {
  await ensureWindow();
  // 第一步：fetch 模式
  const r = await bossEval<{
    ok: boolean;
    apiStatus?: number;
    redirect?: string | null;
    needNavigate?: boolean;
    error?: string;
    errorType?: string;
  }>(greetFetchScript(job), 30000);

  let ok = r.ok;
  let redirect = r.redirect ?? null;
  let message = r.ok
    ? `已发起沟通（HTTP ${r.apiStatus ?? 200}）`
    : r.error || "发起沟通失败";

  // 第二步：导航后备
  if (!ok && r.needNavigate) {
    const detailUrl = `https://www.zhipin.com/job_detail/${job.encryptJobId}.html?lid=${encodeURIComponent(
      job.lid || ""
    )}&securityId=${encodeURIComponent(job.securityId || "")}`;
    await navigateBoss(detailUrl);
    const loaded = await pollPageState(
      (href, ready) => href.includes("job_detail") && ready === "complete",
      20000
    );
    if (!loaded) throw new BossError("generic", "详情页加载超时");
    // 等待按钮渲染
    let dataUrl: string | null = null;
    const t0 = Date.now();
    while (Date.now() - t0 < 15000) {
      const ex = await bossEval<{
        found: boolean;
        dataUrl?: string;
        redirect?: string | null;
      }>(greetLiveExtractScript(), 8000);
      if (ex.found && ex.dataUrl) {
        dataUrl = ex.dataUrl;
        redirect = ex.redirect ?? null;
        break;
      }
      await sleep(1000);
    }
    if (!dataUrl) throw new BossError("generic", "未在页面中找到「立即沟通」按钮");
    const fire = await bossEval<{ ok: boolean; apiStatus?: number }>(
      greetFireScript(dataUrl),
      15000
    );
    ok = fire.ok;
    message = fire.ok
      ? `已发起沟通（HTTP ${fire.apiStatus ?? 200}）`
      : `沟通请求被拒绝（HTTP ${fire.apiStatus ?? "?"}）`;
  } else if (!ok) {
    const kind = r.errorType === "login" ? "login" : r.errorType === "risk" ? "risk" : "generic";
    throw new BossError(kind, message);
  }

  // 第三步（仅单次流程）：发送模板消息
  let templateSent = false;
  if (ok && templateText && templateText.trim()) {
    try {
      if (redirect) {
        await navigateBoss(redirect);
      } else {
        await navigateBoss(CHAT_URL);
      }
      const onChat = await pollPageState(
        (href) => href.includes("/web/geek/chat"),
        15000
      );
      if (onChat) {
        await sleep(2000); // 等会话渲染
        const sent = await sendChatMessage(templateText);
        templateSent = sent;
      }
    } catch {
      templateSent = false; // 尽力而为，不视为失败
    }
  }
  return { ok, message, redirect, templateSent };
}

// ---- 聊天编排 ----

/** 确保 BOSS 窗口停在聊天页 */
export async function ensureChatPage(): Promise<void> {
  await ensureWindow();
  let href = "";
  try {
    const s = await bossEval<{ href: string }>(pageStateScript(), 8000);
    href = s.href;
  } catch {
    href = "";
  }
  if (!href.includes("/web/geek/chat")) {
    await navigateBoss(CHAT_URL);
    const ok = await pollPageState(
      (h, ready) => h.includes("/web/geek/chat") && ready === "complete",
      20000
    );
    if (!ok) throw new BossError("generic", "聊天页加载超时，请检查登录状态");
    await sleep(1500);
  }
}

export async function listConversations(): Promise<Conversation[]> {
  const list = await bossEval<Conversation[]>(chatListScript(), 10000);
  return Array.isArray(list) ? list : [];
}

export async function openConversation(index: number): Promise<void> {
  const r = await bossEval<{ ok: boolean; error?: string }>(
    chatOpenScript(index),
    8000
  );
  if (!r.ok) throw new BossError("generic", r.error || "打开会话失败");
}

export async function getChatMessages(): Promise<{
  messages: ChatMessage[];
  position: string;
}> {
  const r = await bossEval<{
    ok: boolean;
    messages?: ChatMessage[];
    position?: string;
    error?: string;
  }>(chatMessagesScript(), 10000);
  if (!r.ok) throw new BossError("generic", r.error || "读取消息失败");
  return { messages: r.messages || [], position: r.position || "" };
}

export async function sendChatMessage(text: string): Promise<boolean> {
  const r = await bossEval<{ ok: boolean; error?: string }>(
    chatSendScript(text),
    15000
  );
  if (!r.ok) throw new BossError("generic", r.error || "发送失败");
  return true;
}

// ---- 城市同步 ----

export interface CityEntry {
  name: string;
  code: string;
}

export async function syncCities(): Promise<{
  hot: CityEntry[];
  all: CityEntry[];
}> {
  await ensureWindow();
  const hotJson = await bossEval<{
    zpData?: { hotCityList?: CityEntry[] };
  }>(hotCityScript(), 15000);
  const groupJson = await bossEval<{
    zpData?: { cityGroup?: { cityList?: CityEntry[] }[] };
  }>(cityGroupScript(), 15000);
  const hot = hotJson.zpData?.hotCityList ?? [];
  const all: CityEntry[] = [];
  for (const g of groupJson.zpData?.cityGroup ?? []) {
    for (const c of g.cityList ?? []) all.push(c);
  }
  return { hot, all };
}
