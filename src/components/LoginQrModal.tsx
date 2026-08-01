// 应用内扫码登录弹窗：内置浏览器离屏运行，用户无需看到浏览器窗口
import { useCallback, useEffect, useRef, useState } from "react";
import Modal from "./Modal";
import { useStore } from "../store";
import { getLoginQr, hideBrowser, openBossWindow } from "../api/tauri";
import { checkLogin } from "../api/boss";

const REFRESH_SECONDS = 100;
/** 轮询超过该秒数仍未成功时，提示用户可能已在手机上扫码 */
const CONFIRM_HINT_SECONDS = 10;

export default function LoginQrModal(props: { onClose: () => void }) {
  const { toast, setLogin, setBossOpen } = useStore();
  const [qr, setQr] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [countdown, setCountdown] = useState(REFRESH_SECONDS);
  const [elapsed, setElapsed] = useState(0);
  const [success, setSuccess] = useState(false);
  const [browserShown, setBrowserShown] = useState(false);
  const closedRef = useRef(false);
  const onCloseRef = useRef(props.onClose);
  onCloseRef.current = props.onClose;

  const loadQr = useCallback(async () => {
    setLoading(true);
    setError(null);
    setQr(null);
    setCountdown(REFRESH_SECONDS);
    try {
      const url = await getLoginQr();
      if (closedRef.current) return;
      setQr(url);
    } catch (e) {
      if (!closedRef.current) {
        setError(e instanceof Error ? e.message : String(e));
      }
    } finally {
      if (!closedRef.current) setLoading(false);
    }
  }, []);

  // 首次加载
  useEffect(() => {
    closedRef.current = false;
    void loadQr();
    return () => {
      closedRef.current = true;
    };
  }, [loadQr]);

  // 倒计时 + 已等待时长
  useEffect(() => {
    if (success) return;
    const t = setInterval(() => {
      setCountdown((c) => Math.max(0, c - 1));
      setElapsed((e) => e + 1);
    }, 1000);
    return () => clearInterval(t);
  }, [success]);

  // 倒计时归零自动刷新二维码
  useEffect(() => {
    if (countdown === 0 && !success && !closedRef.current) void loadQr();
  }, [countdown, success, loadQr]);

  // 每 3 秒探测一次登录状态
  useEffect(() => {
    if (success) return;
    const t = setInterval(() => {
      void checkLogin()
        .then((s) => {
          if (closedRef.current || s !== "logged-in") return;
          setSuccess(true);
          setLogin("logged-in");
          setBossOpen(true);
          toast("登录成功，已开始同步状态", "success");
          setTimeout(() => {
            if (!closedRef.current) onCloseRef.current();
          }, 1200);
        })
        .catch(() => undefined);
    }, 3000);
    return () => clearInterval(t);
  }, [success, setLogin, setBossOpen, toast]);

  const statusText = success
    ? "登录成功"
    : elapsed >= CONFIRM_HINT_SECONDS
      ? "已扫描？请在手机上确认（正在检测登录状态…）"
      : "请使用 BOSS直聘 App 扫码";

  const showInBrowser = async () => {
    try {
      await openBossWindow();
      setBrowserShown(true);
      toast("浏览器窗口已显示，可在其中人工操作", "info");
    } catch (e) {
      toast(`打开浏览器窗口失败：${String(e)}`, "error");
    }
  };

  const hideInBrowser = async () => {
    try {
      await hideBrowser();
      setBrowserShown(false);
      toast("浏览器窗口已隐藏（仍在后台保持登录）", "info");
    } catch (e) {
      toast(`隐藏窗口失败：${String(e)}`, "error");
    }
  };

  return (
    <Modal title="扫码登录 BOSS直聘" onClose={props.onClose}>
      <div className="qr-body">
        {loading && (
          <div className="qr-skeleton">
            <div className="qr-spinner" />
            <div className="qr-skeleton-text">正在获取登录二维码…</div>
          </div>
        )}
        {!loading && error && (
          <div className="qr-skeleton">
            <div className="qr-error-text">{error}</div>
            <button className="btn btn-primary btn-sm" onClick={() => void loadQr()}>
              重试
            </button>
          </div>
        )}
        {!loading && qr && (
          <div className="qr-card">
            <img className="qr-image" src={qr} alt="BOSS直聘登录二维码" width={240} height={240} />
          </div>
        )}
        <div className={`qr-status ${success ? "qr-status-success" : ""}`}>
          {success && <span className="qr-success-icon">✓</span>}
          {statusText}
        </div>
        {!success && (
          <div className="qr-actions">
            <button className="btn btn-ghost btn-sm" disabled={loading} onClick={() => void loadQr()}>
              刷新二维码
            </button>
            <span className="qr-countdown">{countdown} 秒后自动刷新</span>
          </div>
        )}
        {!success && (
          <div className="qr-secondary">
            <button className="link-btn" onClick={() => void showInBrowser()}>
              在浏览器窗口中打开（自动流程失败时人工操作）
            </button>
            {browserShown && (
              <button className="link-btn qr-hide-link" onClick={() => void hideInBrowser()}>
                隐藏浏览器窗口
              </button>
            )}
          </div>
        )}
      </div>
    </Modal>
  );
}
