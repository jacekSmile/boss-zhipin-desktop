import { useStore } from "../store";
import {
  bossWindowOpen,
  closeBossWindow,
  openBossWindow,
} from "../api/tauri";
import { checkLogin } from "../api/boss";
import { useState } from "react";
import LoginQrModal from "./LoginQrModal";

const LOGIN_TEXT: Record<string, { text: string; cls: string }> = {
  unknown: { text: "状态未知", cls: "badge-gray" },
  "no-window": { text: "浏览器未启动", cls: "badge-gray" },
  "logged-in": { text: "已登录", cls: "badge-green" },
  "not-logged-in": { text: "未登录", cls: "badge-red" },
  risk: { text: "触发风控", cls: "badge-yellow" },
};

export default function StatusBar() {
  const { login, setLogin, bossOpen, setBossOpen, toast } = useStore();
  const [busy, setBusy] = useState(false);
  const [qrOpen, setQrOpen] = useState(false);

  const refresh = async (silent = false) => {
    setBusy(true);
    try {
      const open = await bossWindowOpen();
      setBossOpen(open);
      const state = await checkLogin();
      setLogin(state);
      if (!silent) {
        if (state === "logged-in") toast("已检测到登录状态", "success");
        else if (state === "not-logged-in")
          toast("未登录：请点击「扫码登录」", "warning");
        else if (state === "risk")
          toast("检测到风控限制，请显示浏览器窗口完成验证", "warning");
        else if (state === "no-window") toast("内置浏览器未启动", "info");
        else toast("暂时无法确定登录状态", "info");
      }
    } catch (e) {
      if (!silent) toast(`检测失败：${String(e)}`, "error");
    } finally {
      setBusy(false);
    }
  };

  const showBrowserWindow = async () => {
    try {
      await openBossWindow();
      setBossOpen(true);
      toast("浏览器窗口已显示，可人工处理验证/登录", "info");
      setTimeout(() => void refresh(true), 3000);
    } catch (e) {
      toast(`显示浏览器窗口失败：${String(e)}`, "error");
    }
  };

  const closeWindow = async () => {
    try {
      await closeBossWindow();
      setBossOpen(false);
      setLogin("no-window");
      toast("内置浏览器已关闭", "info");
    } catch (e) {
      toast(`关闭失败：${String(e)}`, "error");
    }
  };

  const b = LOGIN_TEXT[login] ?? LOGIN_TEXT.unknown;

  return (
    <header className="statusbar">
      <div className="status-left">
        <span className={`badge ${b.cls}`}>
          <span className="badge-dot" />
          {b.text}
        </span>
        <span className={`badge ${bossOpen ? "badge-teal" : "badge-gray"}`}>
          <span className="badge-dot" />
          内置浏览器{bossOpen ? "运行中" : "未启动"}
        </span>
      </div>
      <div className="status-right">
        <button className="btn btn-ghost" disabled={busy} onClick={() => void refresh()}>
          {busy ? "检测中…" : "检查登录状态"}
        </button>
        <button className="btn btn-primary" onClick={() => setQrOpen(true)}>
          扫码登录
        </button>
        <button
          className="btn btn-ghost btn-sm"
          title="显示内置浏览器窗口（人工处理验证码等场景）"
          onClick={() => void showBrowserWindow()}
        >
          浏览器
        </button>
        <button
          className="btn btn-ghost btn-sm"
          disabled={!bossOpen}
          title="关闭内置浏览器"
          onClick={() => void closeWindow()}
        >
          关闭
        </button>
      </div>
      {qrOpen && (
        <LoginQrModal
          onClose={() => {
            setQrOpen(false);
            void refresh(true);
          }}
        />
      )}
    </header>
  );
}
