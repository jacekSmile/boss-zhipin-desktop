import { useEffect, useState } from "react";
import { StoreProvider, useStore } from "./store";
import Sidebar from "./components/Sidebar";
import StatusBar from "./components/StatusBar";
import ToastHost from "./components/Toast";
import Search from "./views/Search";
import Batch from "./views/Batch";
import Chat from "./views/Chat";
import Stats from "./views/Stats";
import Resumes from "./views/Resumes";
import History from "./views/History";
import Settings from "./views/Settings";
import { bossWindowOpen } from "./api/tauri";
import { checkLogin } from "./api/boss";
import type { ViewKey } from "./types";

const TITLES: Record<ViewKey, string> = {
  search: "职位搜索",
  batch: "批量投递",
  chat: "消息沟通",
  stats: "数据统计",
  resumes: "简历管理",
  history: "投递记录",
  settings: "设置",
};

function Shell() {
  const [view, setView] = useState<ViewKey>("search");
  const { queue, setBossOpen, setLogin } = useStore();

  // 启动时静默探测一次窗口与登录状态
  useEffect(() => {
    void (async () => {
      try {
        const open = await bossWindowOpen();
        setBossOpen(open);
        if (open) setLogin(await checkLogin());
        else setLogin("no-window");
      } catch {
        /* 静默 */
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="app-shell">
      <Sidebar view={view} onNavigate={setView} queueCount={queue.length} />
      <div className="main-col">
        <StatusBar />
        <div className="view-header">
          <h1 className="view-title">{TITLES[view]}</h1>
        </div>
        <main className="main-content">
          {view === "search" && <Search />}
          {view === "batch" && <Batch />}
          {view === "chat" && <Chat />}
          {view === "stats" && <Stats />}
          {view === "resumes" && <Resumes />}
          {view === "history" && <History />}
          {view === "settings" && <Settings />}
        </main>
      </div>
      <ToastHost />
    </div>
  );
}

export default function App() {
  return (
    <StoreProvider>
      <Shell />
    </StoreProvider>
  );
}
