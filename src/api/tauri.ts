// Tauri invoke 封装层
import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import type {
  BatchProgressPayload,
  HistoryRecord,
  ResumeInfo,
} from "../types";

/** 打开/聚焦 BOSS 登录窗口 */
export function openBossWindow(url?: string): Promise<void> {
  return invoke("open_boss_window", url ? { url } : {});
}

export function closeBossWindow(): Promise<void> {
  return invoke("close_boss_window");
}

export function bossWindowOpen(): Promise<boolean> {
  return invoke("boss_window_open");
}

/**
 * 在 BOSS webview 内执行 JS（async 函数体，须以 return 结尾）。
 * 注意：触发页面跳转的脚本会因上下文销毁而超时，调用方需 catch。
 */
export function bossEval<T = unknown>(
  script: string,
  timeoutMs?: number
): Promise<T> {
  return invoke<T>("boss_eval", { script, timeoutMs });
}

export interface BatchItemInput {
  id: string;
  label: string;
  script: string;
}

export function startBatch(
  items: BatchItemInput[],
  minDelayMs: number,
  maxDelayMs: number
): Promise<void> {
  return invoke("start_batch", { items, minDelayMs, maxDelayMs });
}

export function cancelBatch(): Promise<void> {
  return invoke("cancel_batch");
}

export function batchRunning(): Promise<boolean> {
  return invoke("batch_running");
}

export function onBatchProgress(
  handler: (p: BatchProgressPayload) => void
): Promise<UnlistenFn> {
  return listen<BatchProgressPayload>("batch-progress", (e) => handler(e.payload));
}

// ---- 存储 ----

export function listResumes(): Promise<ResumeInfo[]> {
  return invoke("list_resumes");
}

export function saveResume(name: string, dataBase64: string): Promise<void> {
  return invoke("save_resume", { name, dataBase64 });
}

export function deleteResume(name: string): Promise<void> {
  return invoke("delete_resume", { name });
}

export function readResumeBase64(name: string): Promise<string> {
  return invoke("read_resume_base64", { name });
}

export function loadHistory(): Promise<HistoryRecord[]> {
  return invoke<HistoryRecord[]>("load_history").then((v) =>
    Array.isArray(v) ? v : []
  );
}

export function appendHistory(records: HistoryRecord[]): Promise<void> {
  return invoke("append_history", { records });
}

export function clearHistory(): Promise<void> {
  return invoke("clear_history");
}

/** 打开外部链接（优先用 opener 插件的全局注入，回退 window.open） */
export async function openExternal(url: string): Promise<void> {
  const opener = window.__TAURI__?.opener;
  if (opener?.openUrl) {
    await opener.openUrl(url);
    return;
  }
  window.open(url, "_blank");
}
