import { useState } from "react";
import { useStore } from "../store";
import { syncCities } from "../api/boss";

export default function Settings() {
  const { settings, updateSettings, toast } = useStore();
  const [syncing, setSyncing] = useState(false);
  const [syncResult, setSyncResult] = useState<string | null>(null);

  const doSync = async () => {
    setSyncing(true);
    setSyncResult(null);
    try {
      const r = await syncCities();
      setSyncResult(
        `同步成功：热门城市 ${r.hot.length} 个，全部城市 ${r.all.length} 个。（本应用内置 376 个城市代码，已覆盖常见城市）`
      );
      toast("城市数据同步成功", "success");
    } catch (e) {
      setSyncResult(`同步失败：${e instanceof Error ? e.message : String(e)}`);
      toast("城市同步失败，请确认已打开并登录 BOSS 窗口", "error");
    } finally {
      setSyncing(false);
    }
  };

  return (
    <div className="view settings-view">
      <div className="card">
        <div className="card-title">默认设置</div>
        <div className="form-grid">
          <div className="form-item">
            <div className="form-label">批量投递默认间隔（秒）</div>
            <div className="delay-row">
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
            </div>
          </div>
          <div className="form-item">
            <div className="form-label">搜索每页数量（pageSize）</div>
            <input
              className="input input-num"
              type="number"
              min={10}
              max={50}
              value={settings.pageSize}
              onChange={(e) =>
                updateSettings({ pageSize: Math.min(50, Math.max(10, Number(e.target.value) || 30)) })
              }
            />
          </div>
        </div>
        <div className="form-item">
          <div className="form-label">默认打招呼话术模板</div>
          <textarea
            className="input textarea"
            rows={3}
            value={settings.template}
            onChange={(e) => updateSettings({ template: e.target.value })}
          />
          <div className="form-hint">支持变量 {"{公司}"}、{"{职位}"}、{"{自我介绍}"}</div>
        </div>
      </div>

      <div className="card">
        <div className="card-title">城市数据</div>
        <div className="form-hint">
          应用内置 376 个城市的代码映射。点击同步可从 BOSS 接口校验热门城市与全量城市分组（需已登录 BOSS 窗口）。
        </div>
        <div className="delay-row">
          <button className="btn btn-primary btn-sm" disabled={syncing} onClick={() => void doSync()}>
            {syncing ? "同步中…" : "同步城市数据"}
          </button>
        </div>
        {syncResult && <div className="sync-result">{syncResult}</div>}
      </div>

      <div className="card risk-card">
        <div className="card-title">风控说明（重要）</div>
        <ul className="risk-list">
          <li>
            BOSS直聘对频繁操作有风控限制：接口返回 <code>code 31 / 37</code>，或提示
            「环境存在异常 / 访问频繁 / 操作太频繁 / 安全校验 / 滑块 / 验证」时，即已被限制。
          </li>
          <li>触发风控后：立即停止搜索与投递，显示内置浏览器窗口手动完成滑块/安全验证，等待 5–10 分钟再操作。</li>
          <li>建议批量投递间隔设置为 8 秒以上，单次批量不要超过 30 个职位；避免短时间连续翻页搜索。</li>
          <li>所有请求都通过你本人登录的 BOSS 窗口发出，请合理控制频率，珍惜账号。</li>
        </ul>
      </div>

      <div className="card">
        <div className="card-title">关于</div>
        <div className="about-text">
          BOSS直聘求职助手 · 桌面版 v0.1.0
          <br />
          基于 Tauri v2 + React 构建。内置 Chrome for Testing 浏览器离屏（隐藏）运行，
          登录、搜索、打招呼、聊天等操作均通过它在本机会话中完成；登录态持久保存在应用数据目录，
          简历、投递记录等数据仅保存在本机，不上传任何服务器。
        </div>
      </div>
    </div>
  );
}
