use crate::cdp::{self, CdpState};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::sync::{Arc, Mutex};
use tauri::{AppHandle, Emitter};
use tokio::sync::watch;

/// State shared across commands.
pub struct BossState {
    batch_cancel: Arc<Mutex<Option<watch::Sender<bool>>>>,
    batch_running_flag: Arc<Mutex<bool>>,
}

impl BossState {
    pub fn new() -> Self {
        Self {
            batch_cancel: Arc::new(Mutex::new(None)),
            batch_running_flag: Arc::new(Mutex::new(false)),
        }
    }
}

/// Classify errors that mean BOSS risk-control or lost login. These must
/// never be retried blindly — the batch aborts instead.
fn is_restricted_error(msg: &str) -> bool {
    const KEYS: [&str; 19] = [
        "code 31",
        "code 37",
        "code: 31",
        "code: 37",
        "环境存在异常",
        "访问频繁",
        "操作太频繁",
        "安全校验",
        "滑块",
        "验证码",
        "安全验证",
        "访问异常",
        "环境异常",
        "登录查看完整内容",
        "未登录",
        "访问受限",
        "IP 存在异常",
        "违规访问",
        "暂时无法访问",
    ];
    KEYS.iter().any(|k| msg.contains(k))
}

#[tauri::command]
pub async fn open_boss_window(
    app: AppHandle,
    cdp: tauri::State<'_, CdpState>,
    url: Option<String>,
) -> Result<(), String> {
    // 打开并把窗口移回屏幕（供人工操作场景）
    cdp::open(&app, &cdp, url).await?;
    let _ = cdp::show_window(&cdp).await;
    Ok(())
}

/// 获取 BOSS 登录二维码（data URL），浏览器保持隐藏
#[tauri::command]
pub async fn get_login_qr(app: AppHandle, cdp: tauri::State<'_, CdpState>) -> Result<String, String> {
    cdp::get_login_qr(&app, &cdp).await
}

/// 把隐藏的浏览器窗口移回屏幕
#[tauri::command]
pub async fn show_browser(cdp: tauri::State<'_, CdpState>) -> Result<(), String> {
    cdp::show_window(&cdp).await
}

/// 把浏览器窗口移出屏幕隐藏
#[tauri::command]
pub async fn hide_browser(cdp: tauri::State<'_, CdpState>) -> Result<(), String> {
    cdp::hide_window(&cdp).await
}

#[tauri::command]
pub fn close_boss_window(cdp: tauri::State<'_, CdpState>) -> Result<(), String> {
    cdp::close(&cdp);
    Ok(())
}

#[tauri::command]
pub async fn boss_window_open(cdp: tauri::State<'_, CdpState>) -> Result<bool, String> {
    Ok(cdp::is_open(&cdp).await)
}

/// Evaluate a JS expression inside the BOSS tab of the built-in browser and
/// await its result. `script` must be a JS function body ending with `return`.
#[tauri::command]
pub async fn boss_eval(
    app: AppHandle,
    cdp: tauri::State<'_, CdpState>,
    script: String,
    timeout_ms: Option<u64>,
) -> Result<Value, String> {
    cdp::eval(&app, &cdp, &script, timeout_ms).await
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BatchItem {
    pub id: String,
    pub label: String,
    pub script: String,
}

#[derive(Debug, Clone, Serialize)]
pub struct BatchProgress {
    pub current: usize,
    pub total: usize,
    pub item_id: String,
    pub label: String,
    pub ok: bool,
    pub error: Option<String>,
    pub result: Option<Value>,
    pub done: bool,
}

#[tauri::command]
pub async fn start_batch(
    app: AppHandle,
    state: tauri::State<'_, BossState>,
    cdp_state: tauri::State<'_, CdpState>,
    items: Vec<BatchItem>,
    min_delay_ms: u64,
    max_delay_ms: u64,
) -> Result<(), String> {
    {
        let running = state.batch_running_flag.lock().unwrap();
        if *running {
            return Err("已有批量任务正在执行".to_string());
        }
    }
    if items.is_empty() {
        return Err("批量任务为空".to_string());
    }
    if items.len() > 300 {
        return Err("单次批量任务过多（上限 300 条），请分批执行以保护账号".to_string());
    }
    if !cdp::is_open(&cdp_state).await {
        return Err("内置浏览器未启动，请先打开登录窗口并登录".to_string());
    }
    {
        let mut running = state.batch_running_flag.lock().unwrap();
        *running = true;
    }
    let (cancel_tx, mut cancel_rx) = watch::channel(false);
    {
        let mut slot = state.batch_cancel.lock().unwrap();
        *slot = Some(cancel_tx);
    }

    let batch_cancel = state.batch_cancel.clone();
    let running_flag = state.batch_running_flag.clone();
    let cdp = cdp_state.inner().clone();
    let total = items.len();
    // Floor of 1s between items regardless of user input — account safety.
    let min_d = min_delay_ms.min(max_delay_ms).max(1_000);
    let max_d = max_delay_ms.max(min_delay_ms).max(1_000);

    tauri::async_runtime::spawn(async move {
        let emit_progress = |p: BatchProgress| {
            let _ = app.emit("batch-progress", p);
        };
        let mut abort_reason: Option<String> = None;

        'outer: for (idx, item) in items.iter().enumerate() {
            if *cancel_rx.borrow() {
                break;
            }
            // Execute one item via CDP, retrying transient failures with
            // randomized backoff. Risk-control errors abort the whole batch.
            const MAX_RETRY: u32 = 2;
            let mut attempt: u32 = 0;
            let (ok, error, result) = loop {
                let outcome = match cdp::eval(&app, &cdp, &item.script, Some(60_000)).await {
                    Ok(v) => (true, None, Some(v)),
                    Err(e) => (false, Some(e), None),
                };

                if outcome.0 {
                    break outcome;
                }
                let err_msg = outcome.1.clone().unwrap_or_default();
                // Risk-control / login-wall: do not retry, abort the batch.
                if is_restricted_error(&err_msg) {
                    abort_reason = Some(format!(
                        "检测到 BOSS 风控/登录限制（{}），为保护账号已中止批量任务。请在浏览器窗口完成验证或稍作等待后重试。",
                        err_msg
                    ));
                    emit_progress(BatchProgress {
                        current: idx + 1,
                        total,
                        item_id: item.id.clone(),
                        label: item.label.clone(),
                        ok: false,
                        error: Some(err_msg),
                        result: None,
                        done: false,
                    });
                    break 'outer;
                }
                attempt += 1;
                if attempt > MAX_RETRY || *cancel_rx.borrow() {
                    break outcome;
                }
                // Transient failure: randomized backoff before retry.
                let backoff = rand::random_range(5_000..=12_000u64);
                let sleep = tokio::time::sleep(std::time::Duration::from_millis(backoff));
                tokio::pin!(sleep);
                tokio::select! {
                    _ = &mut sleep => {},
                    changed = cancel_rx.changed() => {
                        if changed.is_ok() && *cancel_rx.borrow() {
                            break outcome;
                        }
                    }
                }
            };

            emit_progress(BatchProgress {
                current: idx + 1,
                total,
                item_id: item.id.clone(),
                label: item.label.clone(),
                ok,
                error,
                result,
                done: false,
            });

            // Randomized delay between items to avoid rate-limiting.
            if idx + 1 < total && !*cancel_rx.borrow() {
                let delay = if max_d > min_d {
                    rand::random_range(min_d..=max_d)
                } else {
                    min_d
                };
                let sleep = tokio::time::sleep(std::time::Duration::from_millis(delay));
                tokio::pin!(sleep);
                tokio::select! {
                    _ = &mut sleep => {},
                    changed = cancel_rx.changed() => {
                        if changed.is_ok() && *cancel_rx.borrow() {
                            break;
                        }
                    }
                }
            }
        }

        emit_progress(BatchProgress {
            current: total,
            total,
            item_id: String::new(),
            label: String::new(),
            ok: abort_reason.is_none(),
            error: abort_reason,
            result: None,
            done: true,
        });
        {
            let mut running = running_flag.lock().unwrap();
            *running = false;
        }
        {
            let mut slot = batch_cancel.lock().unwrap();
            *slot = None;
        }
    });

    Ok(())
}

#[tauri::command]
pub fn cancel_batch(state: tauri::State<'_, BossState>) -> Result<(), String> {
    let mut slot = state.batch_cancel.lock().unwrap();
    if let Some(tx) = slot.take() {
        let _ = tx.send(true);
        Ok(())
    } else {
        Err("没有正在执行的批量任务".to_string())
    }
}

#[tauri::command]
pub fn batch_running(state: tauri::State<'_, BossState>) -> bool {
    *state.batch_running_flag.lock().unwrap()
}
