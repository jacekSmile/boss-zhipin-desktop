// 生成在 BOSS webview（zhipin.com 登录态）内执行的 JS 片段。
// 每个片段都是 async 函数体，可使用 await，必须以 return 结尾。
import type { Job, SearchFilters } from "../types";

function jstr(v: unknown): string {
  return JSON.stringify(v ?? null);
}

// ---- 搜索 ----

export function searchJobsScript(
  f: SearchFilters,
  page: number,
  pageSize: number
): string {
  const params = new URLSearchParams();
  params.set("scene", "1");
  params.set("query", f.query);
  params.set("city", f.city);
  params.set("page", String(page));
  params.set("pageSize", String(pageSize));
  if (f.salary) params.set("salary", f.salary);
  if (f.experience) params.set("experience", f.experience);
  if (f.degree) params.set("degree", f.degree);
  if (f.scale) params.set("scale", f.scale);
  if (f.stage) params.set("stage", f.stage);
  if (f.industry) params.set("industry", f.industry);
  const url = `/wapi/zpgeek/search/joblist.json?${params.toString()}`;
  return `
const resp = await fetch(${jstr(url)}, { credentials: 'include' });
if (resp.status === 401 || resp.status === 403 || resp.status === 429) {
  return { __httpStatus: resp.status, code: -1, message: 'HTTP ' + resp.status };
}
const json = await resp.json();
return json;`;
}

/** 登录探测：搜索 Java（上海），看 salaryDesc 是否为空 */
export function loginProbeScript(): string {
  const url =
    "/wapi/zpgeek/search/joblist.json?scene=1&query=Java&city=101020100&page=1&pageSize=10";
  return `
const resp = await fetch(${jstr(url)}, { credentials: 'include' });
if (resp.status === 401 || resp.status === 403 || resp.status === 429) {
  return { __httpStatus: resp.status, code: -1, message: 'HTTP ' + resp.status };
}
const json = await resp.json();
return json;`;
}

// ---- 职位详情 ----

export function jobDetailUrl(job: Job): string {
  return `https://www.zhipin.com/job_detail/${job.encryptJobId}.html?lid=${encodeURIComponent(
    job.lid || ""
  )}&securityId=${encodeURIComponent(job.securityId || "")}`;
}

export function jobDetailScript(job: Job): string {
  return `
const resp = await fetch(${jstr(jobDetailUrl(job))}, { credentials: 'include' });
const html = await resp.text();
if (html.includes('登录查看完整内容')) {
  return { ok: false, errorType: 'login', error: '需要登录后才能查看职位详情' };
}
if (/验证码|安全验证|访问异常|环境异常|请完成验证|拖动滑块/.test(html) && html.length < 20000) {
  return { ok: false, errorType: 'risk', error: '触发风控校验，请在 BOSS 窗口中完成验证' };
}
const doc = new DOMParser().parseFromString(html, 'text/html');
const secs = [...doc.querySelectorAll('.job-detail-section, .job-sec')]
  .filter(el => (el.textContent || '').includes('职位描述'))
  .sort((a, b) => (b.textContent || '').length - (a.textContent || '').length);
let jd = secs.length ? (secs[0].textContent || '') : '';
jd = jd.replace(/\\s+/g, ' ').trim();
const skills = [...doc.querySelectorAll('.job-tags .tag-all span, .job-keyword-list span')]
  .map(s => (s.textContent || '').trim()).filter(Boolean);
if (!jd) return { ok: false, errorType: 'empty', error: '未能解析到职位描述（页面结构可能已变化）' };
return { ok: true, jd, skills };`;
}

// ---- 打招呼（发起沟通） ----

/**
 * 打招呼 · fetch 优先模式：抓详情页 HTML 提取 "立即沟通" 的 data-url，再 XHR 触发。
 * 返回 { ok, apiStatus?, redirect?, needNavigate?, error? }
 */
export function greetFetchScript(job: Job): string {
  return `
const resp = await fetch(${jstr(jobDetailUrl(job))}, { credentials: 'include' });
const html = await resp.text();
if (html.includes('登录查看完整内容')) {
  return { ok: false, error: '需要登录', errorType: 'login' };
}
if (/验证码|安全验证|访问异常|环境异常|请完成验证|拖动滑块/.test(html) && html.length < 20000) {
  return { ok: false, error: '触发风控校验，请在 BOSS 窗口中完成验证后重试', errorType: 'risk' };
}
const doc = new DOMParser().parseFromString(html, 'text/html');
let dataUrl = null, redirect = null;
const cands = [...doc.querySelectorAll('a,button,div')]
  .filter(el => /立即沟通|继续沟通/.test(el.textContent || ''));
for (const el of cands) {
  const du = el.getAttribute('data-url');
  if (du) { dataUrl = du; redirect = el.getAttribute('redirect-url'); break; }
}
if (!dataUrl) return { ok: false, needNavigate: true, error: '详情页为动态渲染，需切换到实时页面模式' };
if (dataUrl.startsWith('/')) dataUrl = location.origin + dataUrl;
if (redirect && redirect.startsWith('/')) redirect = location.origin + redirect;
const r = await fetch(dataUrl, {
  headers: { 'x-requested-with': 'XMLHttpRequest' },
  credentials: 'include',
});
return { ok: r.status < 400, apiStatus: r.status, redirect };`;
}

/** 实时 DOM 中提取 "立即沟通" 的 data-url（用于导航后备方案） */
export function greetLiveExtractScript(): string {
  return `
const cands = [...document.querySelectorAll('a,button')]
  .filter(el => /立即沟通|继续沟通/.test(el.textContent || ''));
for (const el of cands) {
  const du = el.getAttribute('data-url');
  if (du) {
    let u = du;
    if (u.startsWith('/')) u = location.origin + u;
    let rd = el.getAttribute('redirect-url');
    if (rd && rd.startsWith('/')) rd = location.origin + rd;
    return { found: true, dataUrl: u, redirect: rd };
  }
}
return { found: false };`;
}

/** 对 data-url 发起 XHR GET（真正触发沟通） */
export function greetFireScript(dataUrl: string): string {
  return `
const r = await fetch(${jstr(dataUrl)}, {
  headers: { 'x-requested-with': 'XMLHttpRequest' },
  credentials: 'include',
});
return { ok: r.status < 400, apiStatus: r.status };`;
}

// ---- 页面导航/状态 ----

/** 导航（会销毁 eval 上下文导致超时，调用方必须 catch 后改为轮询） */
export function navigateScript(url: string): string {
  return `
location.href = ${jstr(url)};
return true;`;
}

export function pageStateScript(): string {
  return `
return { href: location.href, ready: document.readyState, title: document.title };`;
}

// ---- 聊天页 DOM 操作 ----

export function chatListScript(): string {
  return `
const rows = [...document.querySelectorAll('.chat-content li')];
return rows.map((row, i) => {
  const titleEl = row.querySelector('.friend-name, [class*="geek-name"], [class*="boss-name"]');
  const previewEl = row.querySelector('.last-msg, [class*="preview"]');
  return {
    index: i,
    title: (titleEl ? titleEl.textContent : '')?.trim() || ('会话 ' + (i + 1)),
    preview: (previewEl ? previewEl.textContent : '')?.trim() || '',
    unread: !!row.querySelector('.unread, .badge'),
  };
});`;
}

export function chatOpenScript(index: number): string {
  return `
const rows = [...document.querySelectorAll('.chat-content li')];
const row = rows[${Number(index) | 0}];
if (!row) return { ok: false, error: '会话不存在，请刷新列表' };
const t = row.querySelector('.friend-content') || row;
['pointerdown','mousedown','mouseup','pointerup','click'].forEach(ty =>
  t.dispatchEvent(new MouseEvent(ty, { bubbles: true, cancelable: true, view: window })));
return { ok: true };`;
}

export function chatMessagesScript(): string {
  return `
const root = document.querySelector('.chat-conversation');
const position = (document.querySelector('.chat-position-content')?.textContent || '').trim();
if (!root) return { ok: false, error: '未找到聊天区域（可能未打开会话）', messages: [], position };
const items = [...root.querySelectorAll(
  '.message-item, .message-card, .chat-message, .msg-item, .dialog-item, [class*="message-item"], [class*="msg-item"]'
)];
const noise = /查看简历|发送了简历|已送达|对方已接收/;
const msgs = [];
for (const it of items) {
  const anc = it.closest('[class*="item-me"], [class*="item-myself"], [class*="item-friend"], [class*="item-boss"]');
  const cls = anc ? String(anc.className) : String(it.className || '');
  const from = /item-me|item-myself/.test(cls) ? 'me' : 'boss';
  const body = it.querySelector('.message-content, [class*="message-content"]') || it;
  const text = (body.textContent || '').trim();
  if (!text || noise.test(text) || text.length > 2000) continue;
  msgs.push({ from, text });
}
return { ok: true, messages: msgs.slice(-50), position };`;
}

export function chatSendScript(text: string): string {
  return `
const text = ${jstr(text)};
const inputs = [...document.querySelectorAll(
  '.chat-input[contenteditable], [contenteditable=true], [contenteditable=""], textarea, input[type=text]'
)].filter(el => !/boss-search-input|ipt-search/.test(String(el.className || '')));
const input = inputs.find(el => el.offsetParent !== null) || inputs[0];
if (!input) return { ok: false, error: '未找到聊天输入框，请先打开一个会话' };
input.focus();
if (input.isContentEditable) {
  input.innerText = text;
  input.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: text }));
} else {
  input.value = text;
  input.dispatchEvent(new Event('input', { bubbles: true }));
  input.dispatchEvent(new Event('change', { bubbles: true }));
}
let btn = document.querySelector('.btn-send');
if (!btn) {
  btn = [...document.querySelectorAll('button, a, div, span')].find(b => {
    const t = (b.textContent || '').trim();
    return /发送|Send/i.test(t) && t.length <= 4 && !b.disabled && b.offsetParent !== null;
  });
}
if (!btn) return { ok: false, error: '未找到发送按钮' };
['pointerdown','mousedown','mouseup','pointerup','click'].forEach(ty =>
  btn.dispatchEvent(new MouseEvent(ty, { bubbles: true, cancelable: true, view: window })));
const t0 = Date.now();
while (Date.now() - t0 < 3000) {
  await new Promise(r => setTimeout(r, 300));
  const root = document.querySelector('.chat-conversation');
  const mine = root ? [...root.querySelectorAll('[class*="item-me"], [class*="item-myself"]')] : [];
  const lastText = mine.slice(-3).map(it => (it.textContent || '')).join(' ');
  if (lastText.includes(text.slice(0, 10))) return { ok: true };
  const cur = input.isContentEditable ? input.innerText : input.value;
  if (!cur || !String(cur).trim()) return { ok: true };
}
return { ok: false, error: '已点击发送但未确认成功，请到 BOSS 窗口检查' };`;
}

// ---- 城市数据同步 ----

export function hotCityScript(): string {
  return `
const resp = await fetch('/wapi/zpgeek/search/job/hot/city.json', { credentials: 'include' });
return await resp.json();`;
}

export function cityGroupScript(): string {
  return `
const resp = await fetch('/wapi/zpCommon/data/cityGroup.json', { credentials: 'include' });
return await resp.json();`;
}
