import { useCallback, useEffect, useMemo, useState } from "react";
import { useStore } from "../store";
import { clearHistory, loadHistory } from "../api/tauri";
import { downloadBlob, formatTime } from "../utils";
import type { HistoryRecord } from "../types";

export default function History() {
  const { toast } = useStore();
  const [records, setRecords] = useState<HistoryRecord[]>([]);
  const [loading, setLoading] = useState(false);
  const [filter, setFilter] = useState<"all" | "ok" | "fail">("all");

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      setRecords(await loadHistory());
    } catch (e) {
      toast(`读取投递记录失败：${String(e)}`, "error");
    } finally {
      setLoading(false);
    }
  }, [toast]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const filtered = useMemo(() => {
    const list = [...records].reverse(); // 最新在前
    if (filter === "ok") return list.filter((r) => r.ok);
    if (filter === "fail") return list.filter((r) => !r.ok);
    return list;
  }, [records, filter]);

  const okCount = records.filter((r) => r.ok).length;

  const onClear = async () => {
    if (!window.confirm("确定清空全部投递记录吗？该操作不可恢复。")) return;
    try {
      await clearHistory();
      setRecords([]);
      toast("投递记录已清空", "info");
    } catch (e) {
      toast(`清空失败：${String(e)}`, "error");
    }
  };

  const onExport = () => {
    const blob = new Blob([JSON.stringify(records, null, 2)], {
      type: "application/json",
    });
    downloadBlob(blob, `投递记录_${new Date().toISOString().slice(0, 10)}.json`);
  };

  return (
    <div className="view history-view">
      <div className="card">
        <div className="card-head">
          <div className="card-title">
            投递记录（共 {records.length} 条 · 成功 {okCount} · 失败 {records.length - okCount}）
          </div>
          <div className="toolbar-actions">
            <div className="seg">
              {(["all", "ok", "fail"] as const).map((f) => (
                <button
                  key={f}
                  className={`seg-item ${filter === f ? "active" : ""}`}
                  onClick={() => setFilter(f)}
                >
                  {f === "all" ? "全部" : f === "ok" ? "成功" : "失败"}
                </button>
              ))}
            </div>
            <button className="btn btn-ghost btn-sm" disabled={records.length === 0} onClick={onExport}>
              导出 JSON
            </button>
            <button className="btn btn-ghost btn-sm" disabled={records.length === 0} onClick={() => void onClear()}>
              清空记录
            </button>
            <button className="btn btn-ghost btn-sm" onClick={() => void refresh()}>
              刷新
            </button>
          </div>
        </div>
        {loading ? (
          <div className="loading-block">读取中…</div>
        ) : filtered.length === 0 ? (
          <div className="empty-block">
            <div className="empty-icon">☰</div>
            <div>暂无投递记录</div>
            <div className="empty-sub">批量投递结束后会自动写入记录</div>
          </div>
        ) : (
          <table className="table">
            <thead>
              <tr>
                <th>时间</th>
                <th>职位</th>
                <th>公司</th>
                <th>结果</th>
                <th>原因</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((r, i) => (
                <tr key={`${r.encryptJobId}-${i}`}>
                  <td className="time-cell">{r.time ? formatTime(Date.parse(r.time) || 0) : "—"}</td>
                  <td>{r.jobName}</td>
                  <td>{r.brandName}</td>
                  <td>
                    <span className={`badge ${r.ok ? "badge-green" : "badge-red"}`}>
                      {r.ok ? "成功" : "失败"}
                    </span>
                  </td>
                  <td className="error-cell">{r.error || "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
