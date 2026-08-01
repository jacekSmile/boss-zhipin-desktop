import { useCallback, useEffect, useRef, useState } from "react";
import { useStore } from "../store";
import ProgressBar from "../components/ProgressBar";
import Modal from "../components/Modal";
import { greetFetchScript } from "../api/bossJs";
import {
  appendHistory,
  batchRunning,
  cancelBatch,
  loadHistory,
  onBatchProgress,
  openBossWindow,
  startBatch,
} from "../api/tauri";
import { isRiskText, isToday } from "../utils";
import type { BatchProgressPayload, HistoryRecord, Job } from "../types";
import type { UnlistenFn } from "@tauri-apps/api/event";

interface LogEntry {
  label: string;
  ok: boolean;
  error: string | null;
  time: string;
}

export default function Batch() {
  const {
    queue, removeFromQueue, clearQueue, settings, updateSettings, toast,
    bumpHistory, historyVersion,
  } = useStore();
  const [running, setRunning] = useState(false);
  const [current, setCurrent] = useState(0);
  const [total, setTotal] = useState(0);
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [startedAt, setStartedAt] = useState<number | null>(null);
  const [summary, setSummary] = useState<{ ok: number; fail: number } | null>(null);
  const [retryJobs, setRetryJobs] = useState<Job[]>([]);
  const [riskOpen, setRiskOpen] = useState(false);
  const [todayCount, setTodayCount] = useState(0);
  const resultsRef = useRef<HistoryRecord[]>([]);
  const logBoxRef = useRef<HTMLDivElement>(null);
  const queueRef = useRef(queue);
  queueRef.current = queue;
  // 本轮快照与执行记录（用于收集失败/剩余项）
  const batchJobsRef = useRef<Job[]>([]);
  const executedRef = useRef<Map<string, { ok: boolean; error: string | null }>>(new Map());
  const doneErrorRef = useRef<string | null>(null);

  const extractError = (result: unknown): string | null => {
    if (result && typeof result === "object") {
      const r = result as { ok?: boolean; error?: string };
      if (r.ok === false) return r.error || "发起沟通失败";
      if (r.ok === true) return null;
    }
    return null;
  };

  const refreshToday = useCallback(async () => {
    try {
      const recs = await loadHistory();
      setTodayCount(recs.filter((r) => r.ok && isToday(r.time)).length);
    } catch {
      /* 静默 */
    }
  }, []);

  useEffect(() => {
    void refreshToday();
  }, [refreshToday, historyVersion]);

  useEffect(() => {
    let unlisten: UnlistenFn | null = null;
    void onBatchProgress((p: BatchProgressPayload) => {
      setCurrent(p.current);
      setTotal(p.total);
      if (p.item_id) {
        const job = batchJobsRef.current.find((j) => j.encryptJobId === p.item_id)
          ?? queueRef.current.find((j) => j.encryptJobId === p.item_id);
        const errMsg = p.error
          ? p.error
          : !p.ok
            ? extractError(p.result)
            : null;
        const itemOk = p.ok && !errMsg;
        executedRef.current.set(p.item_id, { ok: itemOk, error: errMsg });
        setLogs((l) => [
          ...l,
          {
            label: p.label,
            ok: itemOk,
            error: errMsg,
            time: new Date().toLocaleTimeString("zh-CN", { hour12: false }),
          },
        ]);
        resultsRef.current.push({
          time: new Date().toISOString(),
          jobName: job?.jobName || p.label,
          brandName: job?.brandName || "",
          encryptJobId: p.item_id,
          ok: itemOk,
          error: errMsg,
        });
      }
      if (p.done) {
        setRunning(false);
        if (p.error) doneErrorRef.current = p.error;
        const recs = resultsRef.current;
        const okN = recs.filter((r) => r.ok).length;
        setSummary({ ok: okN, fail: recs.length - okN });
        if (recs.length > 0) {
          appendHistory(recs)
            .then(bumpHistory)
            .catch((e) => toast(`写入投递记录失败：${String(e)}`, "error"));
        }
        // 收集失败项 + 未执行的剩余项
        const snapshot = batchJobsRef.current;
        const executed = executedRef.current;
        const failed = snapshot.filter((j) => {
          const r = executed.get(j.encryptJobId);
          return r && !r.ok;
        });
        const remaining = snapshot.filter((j) => !executed.has(j.encryptJobId));
        setRetryJobs([...failed, ...remaining]);
        // 风控检测：done 事件携带原因，或任一错误文本命中风控特征
        const riskHit =
          isRiskText(doneErrorRef.current) ||
          [...executed.values()].some((r) => isRiskText(r.error)) ||
          (p.error ? isRiskText(p.error) : false);
        if (riskHit && (failed.length > 0 || remaining.length > 0)) {
          setRiskOpen(true);
        }
        toast(`批量投递结束：成功 ${okN}，失败 ${recs.length - okN}`, "info");
      }
    }).then((u) => (unlisten = u));
    void batchRunning().then(setRunning).catch(() => undefined);
    return () => {
      unlisten?.();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    logBoxRef.current?.scrollTo({ top: logBoxRef.current.scrollHeight });
  }, [logs]);

  const start = async (jobsToRun?: Job[]) => {
    const source = jobsToRun ?? queue;
    if (source.length === 0) {
      toast("队列为空，请先在「职位搜索」中加入职位", "warning");
      return;
    }
    const minMs = Math.max(1, settings.minDelaySec) * 1000;
    const maxMs = Math.max(minMs, settings.maxDelaySec * 1000);
    const items = source.map((j) => ({
      id: j.encryptJobId,
      label: `${j.jobName} @ ${j.brandName}`,
      script: greetFetchScript(j),
    }));
    try {
      resultsRef.current = [];
      executedRef.current = new Map();
      doneErrorRef.current = null;
      batchJobsRef.current = source;
      setLogs([]);
      setSummary(null);
      setRetryJobs([]);
      setRiskOpen(false);
      setCurrent(0);
      setTotal(items.length);
      setStartedAt(Date.now());
      setRunning(true);
      await startBatch(items, minMs, maxMs);
      toast(`批量投递已开始（${items.length} 项）`, "info");
    } catch (e) {
      setRunning(false);
      toast(`启动失败：${String(e)}`, "error");
    }
  };

  const cancel = async () => {
    try {
      await cancelBatch();
      toast("已请求取消，当前项执行完后停止", "warning");
    } catch (e) {
      toast(`取消失败：${String(e)}`, "error");
    }
  };

  const etaText = () => {
    if (!running || !startedAt || current === 0 || total === 0) return "";
    const avg = (Date.now() - startedAt) / current;
    const remain = Math.round(((total - current) * avg) / 1000);
    return `预计剩余 ${remain >= 60 ? `${Math.floor(remain / 60)}分${remain % 60}秒` : `${remain}秒`}`;
  };

  return (
    <div className="view batch-view">
      <div className={`today-bar ${todayCount >= 80 ? "today-warn" : ""}`}>
        <span>
          今日已投递 <b>{todayCount}</b> 条
        </span>
        {todayCount >= 80 && (
          <span className="today-warn-text">
            BOSS 对每日主动沟通次数有限制，今日投递量已偏高，建议控制节奏、明日继续。
          </span>
        )}
      </div>

      <div className="card">
        <div className="card-head">
          <div className="card-title">投递队列（{queue.length}）</div>
          <div className="toolbar-actions">
            <button className="btn btn-ghost btn-sm" disabled={queue.length === 0 || running} onClick={clearQueue}>
              清空队列
            </button>
          </div>
        </div>
        {queue.length === 0 ? (
          <div className="empty-block">
            <div className="empty-icon">⇶</div>
            <div>队列为空</div>
            <div className="empty-sub">到「职位搜索」勾选职位后点击「批量加入队列」（队列会自动保存在本机）</div>
          </div>
        ) : (
          <table className="table">
            <thead>
              <tr>
                <th>职位</th>
                <th>公司</th>
                <th>薪资</th>
                <th>城市</th>
                <th>操作</th>
              </tr>
            </thead>
            <tbody>
              {queue.map((j) => (
                <tr key={j.encryptJobId}>
                  <td>{j.jobName}</td>
                  <td>{j.brandName}</td>
                  <td className="salary-cell">{j.salaryDesc || "—"}</td>
                  <td>{j.cityName}</td>
                  <td>
                    <button
                      className="btn btn-ghost btn-sm"
                      disabled={running}
                      onClick={() => removeFromQueue(j.encryptJobId)}
                    >
                      移除
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <div className="card">
        <div className="card-title">打招呼话术模板</div>
        <textarea
          className="input textarea"
          rows={3}
          value={settings.template}
          onChange={(e) => updateSettings({ template: e.target.value })}
          placeholder="支持变量：{公司} {职位} {自我介绍}"
        />
        <div className="form-hint">
          支持变量 {"{公司}"}、{"{职位}"}、{"{自我介绍}"}（在「简历管理」中填写）。
          <b>批量模式只发起沟通</b>（触发「立即沟通」），不逐条发送话术——HR 回复后请到「消息沟通」继续聊。单次打招呼会尝试发送话术。
        </div>
      </div>

      <div className="card">
        <div className="card-title">投递节奏</div>
        <div className="delay-row">
          <span>随机间隔</span>
          <input
            className="input input-num"
            type="number"
            min={1}
            value={settings.minDelaySec}
            onChange={(e) => updateSettings({ minDelaySec: Number(e.target.value) || 1 })}
          />
          <span>—</span>
          <input
            className="input input-num"
            type="number"
            min={1}
            value={settings.maxDelaySec}
            onChange={(e) => updateSettings({ maxDelaySec: Number(e.target.value) || 1 })}
          />
          <span>秒</span>
          <span className="form-hint">建议不小于 8 秒，间隔过密容易触发风控（code 31/37）</span>
        </div>
        <div className="batch-controls">
          {!running ? (
            <button className="btn btn-primary btn-lg" onClick={() => void start()}>
              开始批量投递（{queue.length} 个职位）
            </button>
          ) : (
            <button className="btn btn-danger btn-lg" onClick={() => void cancel()}>
              取消投递
            </button>
          )}
        </div>
        {(running || summary) && (
          <ProgressBar current={current} total={total} etaText={etaText()} />
        )}
        {summary && (
          <div className="batch-summary">
            本轮结果：<span className="text-success">成功 {summary.ok}</span>，
            <span className="text-error">失败 {summary.fail}</span>
            （已写入「投递记录」）
          </div>
        )}
      </div>

      {logs.length > 0 && (
        <div className="card">
          <div className="card-head">
            <div className="card-title">实时日志</div>
            {!running && retryJobs.length > 0 && (
              <button
                className="btn btn-primary retry-btn"
                onClick={() => void start(retryJobs)}
              >
                重新投递失败/剩余 {retryJobs.length} 项
              </button>
            )}
          </div>
          {!running && retryJobs.length > 0 && (
            <div className="retry-hint">
              有 {retryJobs.length} 个职位未投递成功（失败或本轮未执行到），可点击右上角按钮继续投递。
            </div>
          )}
          <div className="log-box" ref={logBoxRef}>
            {logs.map((l, i) => (
              <div key={i} className={`log-line ${l.ok ? "log-ok" : "log-fail"}`}>
                <span className="log-time">{l.time}</span>
                <span className="log-status">{l.ok ? "成功" : "失败"}</span>
                <span className="log-label">{l.label}</span>
                {l.error && <span className="log-error">{l.error}</span>}
              </div>
            ))}
            {running && <div className="log-line log-running">正在处理下一项…</div>}
          </div>
        </div>
      )}

      {riskOpen && (
        <Modal title="检测到风控 / 人机验证" onClose={() => setRiskOpen(false)}>
          <div className="risk-modal-text">
            BOSS 触发了人机验证或访问风控（如滑块、安全校验、登录失效），程序无法自动处理。
            请在 BOSS 窗口中手动完成验证或重新登录，然后再继续投递。
          </div>
          <div className="risk-modal-text risk-modal-sub">
            建议：处理后等待 1-2 分钟再恢复；适当增大投递间隔可降低再次触发的概率。
          </div>
          <div className="modal-actions">
            <button className="btn btn-ghost" onClick={() => setRiskOpen(false)}>
              稍后处理
            </button>
            <button
              className="btn btn-ghost"
              onClick={() => {
                void openBossWindow().catch((e) => toast(`打开窗口失败：${String(e)}`, "error"));
              }}
            >
              打开 BOSS 窗口手动处理
            </button>
            <button
              className="btn btn-primary"
              disabled={retryJobs.length === 0}
              onClick={() => {
                setRiskOpen(false);
                void start(retryJobs);
              }}
            >
              我已解决，继续投递（{retryJobs.length} 项）
            </button>
          </div>
        </Modal>
      )}
    </div>
  );
}
