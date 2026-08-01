import { useCallback, useEffect, useMemo, useState } from "react";
import { useStore } from "../store";
import CitySelect from "../components/CitySelect";
import JobCard from "../components/JobCard";
import Modal from "../components/Modal";
import { BossError, fetchJobDetail, greetJob, searchJobs } from "../api/boss";
import { loadHistory, openBossWindow, openExternal } from "../api/tauri";
import { renderTemplate } from "../utils";
import { jobDetailUrl } from "../api/bossJs";
import {
  DEGREE_OPTIONS,
  EXPERIENCE_OPTIONS,
  INDUSTRY_OPTIONS,
  SALARY_OPTIONS,
  SCALE_OPTIONS,
  STAGE_OPTIONS,
} from "../constants";
import type { Job, SearchFilters } from "../types";

const MAX_PAGE = 10;
const HIDE_DELIVERED_KEY = "bz_hide_delivered";

export default function Search() {
  const {
    jobs, setJobs, lastFilters, setLastFilters, selected, selectAll,
    clearSelection, addToQueue, addSessionJobs, details, cacheDetail,
    settings, toast, setLogin, historyVersion,
  } = useStore();

  const [filters, setFilters] = useState<SearchFilters>(
    lastFilters ?? {
      query: "",
      city: "100010000",
      cityName: "全国",
      salary: "",
      experience: "",
      degree: "",
      scale: "",
      stage: "",
      industry: "",
    }
  );
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<{ kind: string; msg: string } | null>(null);
  const [activeJob, setActiveJob] = useState<Job | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState<string | null>(null);
  const [greetingId, setGreetingId] = useState<string | null>(null);
  const [greetModal, setGreetModal] = useState<Job | null>(null);
  const [greetMsg, setGreetMsg] = useState("");
  const [delivered, setDelivered] = useState<Set<string>>(new Set());
  const [hideDelivered, setHideDelivered] = useState<boolean>(() => {
    try {
      return localStorage.getItem(HIDE_DELIVERED_KEY) === "1";
    } catch {
      return false;
    }
  });

  // 已投递标记：进入页面加载一次，批次完成（historyVersion 变化）后刷新
  useEffect(() => {
    let cancelled = false;
    loadHistory()
      .then((recs) => {
        if (cancelled) return;
        setDelivered(
          new Set(recs.filter((r) => r.ok && r.encryptJobId).map((r) => r.encryptJobId))
        );
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [historyVersion]);

  const toggleHideDelivered = (v: boolean) => {
    setHideDelivered(v);
    try {
      localStorage.setItem(HIDE_DELIVERED_KEY, v ? "1" : "0");
    } catch {
      /* ignore */
    }
  };

  // 应用「隐藏已投递」后的展示列表
  const displayJobs = useMemo(
    () => (hideDelivered ? jobs.filter((j) => !delivered.has(j.encryptJobId)) : jobs),
    [jobs, hideDelivered, delivered]
  );

  const doSearch = useCallback(
    async (f: SearchFilters, p: number) => {
      setLoading(true);
      setError(null);
      try {
        const list = await searchJobs(f, p, settings.pageSize);
        setJobs(list);
        setPage(p);
        setLastFilters(f);
        addSessionJobs(list);
        if (list.length === 0 && p === 1) toast("没有搜索到职位，试试放宽筛选条件", "info");
      } catch (e) {
        if (e instanceof BossError) {
          setError({ kind: e.kind, msg: e.message });
          if (e.kind === "login") setLogin("not-logged-in");
          if (e.kind === "risk") setLogin("risk");
        } else {
          setError({ kind: "generic", msg: String(e) });
        }
        setJobs([]);
      } finally {
        setLoading(false);
      }
    },
    [settings.pageSize, setJobs, setLastFilters, addSessionJobs, toast, setLogin]
  );

  const openJob = useCallback(
    (job: Job) => {
      setActiveJob(job);
      setDetailError(null);
      if (details.has(job.encryptJobId)) return;
      setDetailLoading(true);
      fetchJobDetail(job)
        .then((d) => cacheDetail(job.encryptJobId, d))
        .catch((e) => setDetailError(e instanceof Error ? e.message : String(e)))
        .finally(() => setDetailLoading(false));
    },
    [details, cacheDetail]
  );

  const doGreet = useCallback(
    async (job: Job, customMsg?: string) => {
      setGreetingId(job.encryptJobId);
      try {
        const tpl = (customMsg ?? settings.template).trim();
        const text = tpl
          ? renderTemplate(tpl, {
              公司: job.brandName,
              职位: job.jobName,
              自我介绍: settings.selfIntro,
            })
          : "";
        const r = await greetJob(job, text || undefined);
        if (r.templateSent) toast(`${job.jobName}：已发起沟通并发送话术`, "success");
        else toast(`${job.jobName}：${r.message}`, "success");
      } catch (e) {
        toast(`${job.jobName}：${e instanceof Error ? e.message : String(e)}`, "error");
      } finally {
        setGreetingId(null);
      }
    },
    [settings.template, settings.selfIntro, toast]
  );

  const allSelected =
    displayJobs.length > 0 && displayJobs.every((j) => selected.has(j.encryptJobId));
  const activeDetail = activeJob ? details.get(activeJob.encryptJobId) : undefined;
  const selectedJobs = useMemo(
    () => jobs.filter((j) => selected.has(j.encryptJobId)),
    [jobs, selected]
  );

  const select = (
    label: string,
    key: keyof SearchFilters,
    options: { value: string; label: string }[]
  ) => (
    <select
      className="input filter-select"
      title={label}
      value={filters[key] as string}
      onChange={(e) => setFilters({ ...filters, [key]: e.target.value })}
    >
      {options.map((o, i) => (
        <option key={`${o.value}-${i}`} value={o.value}>
          {o.label}
        </option>
      ))}
    </select>
  );

  return (
    <div className="view search-view">
      <div className="filter-bar">
        <div className="filter-row">
          <input
            className="input filter-keyword"
            placeholder="搜索职位、公司或技能关键词，如：前端开发"
            value={filters.query}
            onChange={(e) => setFilters({ ...filters, query: e.target.value })}
            onKeyDown={(e) => e.key === "Enter" && void doSearch(filters, 1)}
          />
          <CitySelect
            value={filters.cityName}
            onChange={(name, code) => setFilters({ ...filters, cityName: name, city: code })}
          />
          <button
            className="btn btn-primary btn-search"
            disabled={loading}
            onClick={() => void doSearch(filters, 1)}
          >
            {loading ? "搜索中…" : "搜 索"}
          </button>
        </div>
        <div className="filter-row filter-row-selects">
          {select("薪资", "salary", SALARY_OPTIONS)}
          {select("经验", "experience", EXPERIENCE_OPTIONS)}
          {select("学历", "degree", DEGREE_OPTIONS)}
          {select("公司规模", "scale", SCALE_OPTIONS)}
          {select("融资阶段", "stage", STAGE_OPTIONS)}
          {select("行业", "industry", INDUSTRY_OPTIONS)}
          <label className="hide-delivered-toggle" title="基于投递记录中的成功记录">
            <input
              type="checkbox"
              checked={hideDelivered}
              onChange={(e) => toggleHideDelivered(e.target.checked)}
            />
            隐藏已投递
          </label>
        </div>
      </div>

      {error && (
        <div className={`alert ${error.kind === "risk" ? "alert-warning" : "alert-error"}`}>
          <div>{error.msg}</div>
          {error.kind === "login" && <div className="alert-hint">提示：点击顶栏「打开登录窗口」，扫码登录后再搜索。</div>}
          {error.kind === "risk" && (
            <>
              <div className="alert-hint">
                BOSS 触发了人机验证/风控，程序无法自动处理。请到 BOSS 窗口手动完成滑块/安全验证，等待 5-10 分钟后再操作；适当增大批量间隔、避免频繁翻页。
              </div>
              <div className="alert-hint">
                <button
                  className="btn btn-ghost btn-sm"
                  onClick={() => void openBossWindow().catch((e) => toast(`打开窗口失败：${String(e)}`, "error"))}
                >
                  打开 BOSS 窗口手动处理
                </button>
              </div>
            </>
          )}
        </div>
      )}

      <div className="search-body">
        <div className="job-list-pane">
          <div className="list-toolbar">
            <label className="select-all">
              <input
                type="checkbox"
                checked={allSelected}
                onChange={() => selectAll(displayJobs.map((j) => j.encryptJobId))}
              />
              全选本页（已选 {selected.size}）
            </label>
            <div className="toolbar-actions">
              <button
                className="btn btn-ghost btn-sm"
                disabled={selectedJobs.length === 0}
                onClick={() => {
                  addToQueue(selectedJobs);
                  clearSelection();
                  toast(`已加入 ${selectedJobs.length} 个职位到投递队列`, "success");
                }}
              >
                批量加入队列
              </button>
              {selected.size > 0 && (
                <button className="btn btn-ghost btn-sm" onClick={clearSelection}>
                  清空选择
                </button>
              )}
            </div>
          </div>

          {loading && <div className="loading-block">正在搜索职位…</div>}
          {!loading && jobs.length === 0 && !error && (
            <div className="empty-block">
              <div className="empty-icon">⌕</div>
              <div>输入关键词，点击「搜索」开始寻找机会</div>
              <div className="empty-sub">搜索结果会自动累积到「数据统计」中</div>
            </div>
          )}
          {!loading && jobs.length > 0 && displayJobs.length === 0 && (
            <div className="empty-block">
              <div className="empty-icon">✓</div>
              <div>本页职位均已投递</div>
              <div className="empty-sub">关闭筛选栏的「隐藏已投递」可再次查看</div>
            </div>
          )}
          {!loading &&
            displayJobs.map((j) => (
              <JobCard
                key={j.encryptJobId}
                job={j}
                active={activeJob?.encryptJobId === j.encryptJobId}
                delivered={delivered.has(j.encryptJobId)}
                onOpen={openJob}
                onGreet={(job) => {
                  setGreetMsg(
                    renderTemplate(settings.template, {
                      公司: job.brandName,
                      职位: job.jobName,
                      自我介绍: settings.selfIntro,
                    })
                  );
                  setGreetModal(job);
                }}
                greeting={greetingId === j.encryptJobId}
              />
            ))}

          {jobs.length > 0 && (
            <div className="pagination">
              <button
                className="btn btn-ghost btn-sm"
                disabled={page <= 1 || loading}
                onClick={() => void doSearch(filters, page - 1)}
              >
                上一页
              </button>
              {Array.from({ length: MAX_PAGE }, (_, i) => i + 1).map((p) => (
                <button
                  key={p}
                  className={`page-num ${p === page ? "active" : ""}`}
                  disabled={loading}
                  onClick={() => void doSearch(filters, p)}
                >
                  {p}
                </button>
              ))}
              <button
                className="btn btn-ghost btn-sm"
                disabled={page >= MAX_PAGE || loading}
                onClick={() => void doSearch(filters, page + 1)}
              >
                下一页
              </button>
            </div>
          )}
        </div>

        <div className="detail-pane">
          {!activeJob && (
            <div className="empty-block">
              <div className="empty-icon">☰</div>
              <div>点击左侧职位卡片查看详情</div>
            </div>
          )}
          {activeJob && (
            <>
              <div className="detail-head">
                <div className="detail-title">{activeJob.jobName}</div>
                <div className="detail-salary">{activeJob.salaryDesc || "薪资面议"}</div>
                <div className="detail-company">{activeJob.brandName}</div>
                <div className="detail-links">
                  <button
                    className="link-btn"
                    onClick={() => void openExternal(jobDetailUrl(activeJob))}
                  >
                    详情页 ↗
                  </button>
                  {activeJob.encryptBrandId && (
                    <button
                      className="link-btn"
                      onClick={() =>
                        void openExternal(
                          `https://www.zhipin.com/gongsi/${activeJob.encryptBrandId}.html`
                        )
                      }
                    >
                      公司页 ↗
                    </button>
                  )}
                </div>
              </div>
              <div className="detail-body">
                {detailLoading && <div className="loading-block">正在加载职位描述…</div>}
                {detailError && <div className="alert alert-error">{detailError}</div>}
                {activeDetail && (
                  <>
                    {activeDetail.skills.length > 0 && (
                      <div className="job-tags detail-skills">
                        {activeDetail.skills.map((s, i) => (
                          <span key={`${s}-${i}`} className="tag tag-accent">
                            {s}
                          </span>
                        ))}
                      </div>
                    )}
                    <div className="jd-text">{activeDetail.jd}</div>
                  </>
                )}
                {!detailLoading && !detailError && !activeDetail && (
                  <div className="empty-sub">暂无详情</div>
                )}
              </div>
            </>
          )}
        </div>
      </div>

      {greetModal && (
        <Modal title={`打招呼 · ${greetModal.jobName} @ ${greetModal.brandName}`} onClose={() => setGreetModal(null)}>
          <div className="form-label">打招呼话术（留空则只发起沟通）</div>
          <textarea
            className="input textarea"
            rows={4}
            value={greetMsg}
            onChange={(e) => setGreetMsg(e.target.value)}
            placeholder="输入想对 HR 说的话…"
          />
          <div className="modal-actions">
            <button className="btn btn-ghost" onClick={() => setGreetModal(null)}>
              取消
            </button>
            <button
              className="btn btn-ghost"
              disabled={greetingId !== null}
              onClick={() => {
                const job = greetModal;
                setGreetModal(null);
                void doGreet(job, "");
              }}
            >
              仅发起沟通
            </button>
            <button
              className="btn btn-primary"
              disabled={greetingId !== null}
              onClick={() => {
                const job = greetModal;
                setGreetModal(null);
                void doGreet(job, greetMsg);
              }}
            >
              {greetingId ? "发送中…" : "发起沟通并发送话术"}
            </button>
          </div>
        </Modal>
      )}
    </div>
  );
}
