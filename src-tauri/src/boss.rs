use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::collections::HashMap;
use std::sync::{Arc, Mutex};
use tauri::{AppHandle, Emitter, Listener, Manager, WebviewUrl, WebviewWindowBuilder};
use tokio::sync::{oneshot, watch};

/// State shared across commands.
pub struct BossState {
    pending: Arc<Mutex<HashMap<String, oneshot::Sender<Value>>>>,
    batch_cancel: Arc<Mutex<Option<watch::Sender<bool>>>>,
    batch_running_flag: Arc<Mutex<bool>>,
}

impl BossState {
    pub fn new() -> Self {
        Self {
            pending: Arc::new(Mutex::new(HashMap::new())),
            batch_cancel: Arc::new(Mutex::new(None)),
            batch_running_flag: Arc::new(Mutex::new(false)),
        }
    }
}

/// Listen once for `boss-api-result` events emitted by JS injected into the
/// BOSS webview, and resolve the matching pending oneshot by request id.
pub fn setup_result_listener(app: AppHandle) {
    let state = app.state::<BossState>();
    let pending = state.pending.clone();
    app.listen_any("boss-api-result", move |event| {
        let payload: Value = match serde_json::from_str(event.payload()) {
            Ok(v) => v,
            Err(_) => return,
        };
        if let Some(id) = payload.get("id").and_then(|v| v.as_str()) {
            let tx = {
                let mut map = pending.lock().unwrap();
                map.remove(id)
            };
            if let Some(tx) = tx {
                let _ = tx.send(payload);
            }
        }
    });
}

fn get_boss_webview(app: &AppHandle) -> Result<tauri::WebviewWindow, String> {
    app.get_webview_window("boss")
        .ok_or_else(|| "BOSS 登录窗口未打开，请先登录".to_string())
}

/// Classify errors that mean BOSS risk-control or lost login. These must
/// never be retried blindly — the batch aborts instead.
fn is_restricted_error(msg: &str) -> bool {
    const KEYS: [&str; 15] = [
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
    ];
    KEYS.iter().any(|k| msg.contains(k))
}

#[tauri::command]
pub fn open_boss_window(app: AppHandle, url: Option<String>) -> Result<(), String> {
    if let Some(w) = app.get_webview_window("boss") {
        w.show().map_err(|e| e.to_string())?;
        w.set_focus().map_err(|e| e.to_string())?;
        return Ok(());
    }
    let target = url.unwrap_or_else(|| "https://www.zhipin.com/web/geek/jobs".to_string());
    let parsed: tauri::Url = target.parse().map_err(|e| format!("invalid url: {e}"))?;
    WebviewWindowBuilder::new(&app, "boss", WebviewUrl::External(parsed))
        .title("BOSS直聘 - 登录")
        .inner_size(1200.0, 820.0)
        .build()
        .map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub fn close_boss_window(app: AppHandle) -> Result<(), String> {
    if let Some(w) = app.get_webview_window("boss") {
        w.close().map_err(|e| e.to_string())?;
    }
    Ok(())
}

#[tauri::command]
pub fn boss_window_open(app: AppHandle) -> bool {
    app.get_webview_window("boss").is_some()
}

/// Evaluate a JS expression inside the logged-in BOSS webview and await its
/// result. `script` must be a JS expression evaluating to a value or a
/// Promise. The result is returned via the `boss-api-result` event bridge.
#[tauri::command]
pub async fn boss_eval(
    app: AppHandle,
    state: tauri::State<'_, BossState>,
    script: String,
    timeout_ms: Option<u64>,
) -> Result<Value, String> {
    let webview = get_boss_webview(&app)?;
    let id = uuid::Uuid::new_v4().to_string();
    let (tx, rx) = oneshot::channel::<Value>();
    {
        let mut map = state.pending.lock().unwrap();
        map.insert(id.clone(), tx);
    }

    // Wrap user script: it may use `await` since we place it in an async IIFE.
    let wrapped = format!(
        r#"(async () => {{
  try {{
    const __result = await (async () => {{ {script} }})();
    window.__TAURI__.event.emit('boss-api-result', {{ id: {id:?}, ok: true, data: __result === undefined ? null : __result }});
  }} catch (e) {{
    window.__TAURI__.event.emit('boss-api-result', {{ id: {id:?}, ok: false, error: String((e && (e.message || e.error)) || e) }});
  }}
}})();"#,
        script = script,
        id = json!(id)
    );

    webview.eval(&wrapped).map_err(|e| {
        let mut map = state.pending.lock().unwrap();
        map.remove(&id);
        format!("eval 失败: {e}")
    })?;

    let timeout = std::time::Duration::from_millis(timeout_ms.unwrap_or(60_000));
    match tokio::time::timeout(timeout, rx).await {
        Ok(Ok(payload)) => {
            if payload.get("ok").and_then(|v| v.as_bool()).unwrap_or(false) {
                Ok(payload.get("data").cloned().unwrap_or(Value::Null))
            } else {
                Err(payload
                    .get("error")
                    .and_then(|v| v.as_str())
                    .unwrap_or("未知错误")
                    .to_string())
            }
        }
        Ok(Err(_)) => Err("结果通道被关闭".to_string()),
        Err(_) => Err("执行超时，请确认 BOSS 窗口已打开且已登录".to_string()),
    }
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
    let webview = get_boss_webview(&app)?;
    {
        let mut running = state.batch_running_flag.lock().unwrap();
        *running = true;
    }
    let (cancel_tx, mut cancel_rx) = watch::channel(false);
    {
        let mut slot = state.batch_cancel.lock().unwrap();
        *slot = Some(cancel_tx);
    }

    let pending = state.pending.clone();
    let batch_cancel = state.batch_cancel.clone();
    let running_flag = state.batch_running_flag.clone();
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
            // Execute one item via the eval bridge, retrying transient
            // failures with randomized backoff. Risk-control errors abort the
            // whole batch immediately.
            const MAX_RETRY: u32 = 2;
            let mut attempt: u32 = 0;
            let (ok, error, result) = loop {
                let id = uuid::Uuid::new_v4().to_string();
                let (tx, rx) = oneshot::channel::<Value>();
                {
                    let mut map = pending.lock().unwrap();
                    map.insert(id.clone(), tx);
                }
                let wrapped = format!(
                    r#"(async () => {{
  try {{
    const __result = await (async () => {{ {script} }})();
    window.__TAURI__.event.emit('boss-api-result', {{ id: {id:?}, ok: true, data: __result === undefined ? null : __result }});
  }} catch (e) {{
    window.__TAURI__.event.emit('boss-api-result', {{ id: {id:?}, ok: false, error: String((e && (e.message || e.error)) || e) }});
  }}
}})();"#,
                    script = item.script,
                    id = json!(id)
                );
                let outcome = if let Err(e) = webview.eval(&wrapped) {
                    let mut map = pending.lock().unwrap();
                    map.remove(&id);
                    (false, Some(format!("eval 失败: {e}")), None)
                } else {
                    let timeout = std::time::Duration::from_millis(60_000);
                    match tokio::time::timeout(timeout, rx).await {
                        Ok(Ok(payload)) => {
                            if payload.get("ok").and_then(|v| v.as_bool()).unwrap_or(false) {
                                (true, None, payload.get("data").cloned())
                            } else {
                                (
                                    false,
                                    Some(
                                        payload
                                            .get("error")
                                            .and_then(|v| v.as_str())
                                            .unwrap_or("未知错误")
                                            .to_string(),
                                    ),
                                    None,
                                )
                            }
                        }
                        Ok(Err(_)) => (false, Some("结果通道被关闭".to_string()), None),
                        Err(_) => (false, Some("执行超时".to_string()), None),
                    }
                };

                if outcome.0 {
                    break outcome;
                }
                let err_msg = outcome.1.clone().unwrap_or_default();
                // Risk-control / login-wall: do not retry, abort the batch.
                if is_restricted_error(&err_msg) {
                    abort_reason = Some(format!(
                        "检测到 BOSS 风控/登录限制（{}），为保护账号已中止批量任务。请在 BOSS 窗口完成验证或稍作等待后重试。",
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
