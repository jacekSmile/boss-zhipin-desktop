import type { ViewKey } from "../types";

const NAV: { key: ViewKey; label: string; icon: string }[] = [
  { key: "search", label: "职位搜索", icon: "⌕" },
  { key: "batch", label: "批量投递", icon: "⇶" },
  { key: "chat", label: "消息沟通", icon: "✉" },
  { key: "stats", label: "数据统计", icon: "◔" },
  { key: "resumes", label: "简历管理", icon: "▤" },
  { key: "history", label: "投递记录", icon: "☰" },
  { key: "settings", label: "设置", icon: "⚙" },
];

export default function Sidebar(props: {
  view: ViewKey;
  onNavigate: (v: ViewKey) => void;
  queueCount: number;
}) {
  return (
    <aside className="sidebar">
      <div className="sidebar-logo">
        <div className="logo-mark">聘</div>
        <div>
          <div className="logo-title">求职助手</div>
          <div className="logo-sub">BOSS直聘桌面版</div>
        </div>
      </div>
      <nav className="sidebar-nav">
        {NAV.map((n) => (
          <button
            key={n.key}
            className={`nav-item ${props.view === n.key ? "active" : ""}`}
            onClick={() => props.onNavigate(n.key)}
          >
            <span className="nav-icon">{n.icon}</span>
            <span>{n.label}</span>
            {n.key === "batch" && props.queueCount > 0 && (
              <span className="nav-badge">{props.queueCount}</span>
            )}
          </button>
        ))}
      </nav>
      <div className="sidebar-footer">
        <span className="dot-tip" />
        数据仅保存在本机
      </div>
    </aside>
  );
}
