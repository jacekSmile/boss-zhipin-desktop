import { useStore } from "../store";
import type { ToastType } from "../types";

const ICONS: Record<ToastType, string> = {
  info: "ℹ",
  success: "✓",
  error: "✕",
  warning: "⚠",
};

export default function ToastHost() {
  const { toasts, dismissToast } = useStore();
  return (
    <div className="toast-host">
      {toasts.map((t) => (
        <div key={t.id} className={`toast toast-${t.type}`} onClick={() => dismissToast(t.id)}>
          <span className="toast-icon">{ICONS[t.type]}</span>
          <span className="toast-msg">{t.message}</span>
        </div>
      ))}
    </div>
  );
}
