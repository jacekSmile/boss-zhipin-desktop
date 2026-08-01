//! 内置浏览器 + Chrome DevTools Protocol (CDP) 引擎。
//!
//! 通过启动随应用分发的 Chrome for Testing（或应急回退到系统 Chrome/Edge），
//! 以真实浏览器内核访问 zhipin.com，彻底避免 WebView 兼容性问题。
//! 启动参数尽量抹平自动化特征，使服务端视角与正常用户基本一致。

use futures_util::{SinkExt, StreamExt};
use serde_json::{json, Value};
use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Mutex as StdMutex};
use tauri::{AppHandle, Manager};
use tokio::sync::{oneshot, Mutex as TokioMutex};

const CDP_PORT: u16 = 19527;
pub const BOSS_HOME: &str = "https://www.zhipin.com/web/geek/jobs";

type WsStream =
    tokio_tungstenite::WebSocketStream<tokio_tungstenite::MaybeTlsStream<tokio::net::TcpStream>>;
type WsSink = futures_util::stream::SplitSink<WsStream, tokio_tungstenite::tungstenite::Message>;
type WsSource = futures_util::stream::SplitStream<WsStream>;

struct Shared {
    child: StdMutex<Option<std::process::Child>>,
    sink: TokioMutex<Option<WsSink>>,
    session: StdMutex<Option<String>>,
    pending: StdMutex<HashMap<u64, oneshot::Sender<Value>>>,
    next_id: AtomicU64,
    profile_dir: PathBuf,
}

#[derive(Clone)]
pub struct CdpState {
    shared: Arc<Shared>,
}

impl CdpState {
    pub fn new(app: &AppHandle) -> Self {
        let dir = app
            .path()
            .app_data_dir()
            .unwrap_or_else(|_| std::env::temp_dir())
            .join("browser-profile");
        let _ = std::fs::create_dir_all(&dir);
        Self {
            shared: Arc::new(Shared {
                child: StdMutex::new(None),
                sink: TokioMutex::new(None),
                session: StdMutex::new(None),
                pending: StdMutex::new(HashMap::new()),
                next_id: AtomicU64::new(1),
                profile_dir: dir,
            }),
        }
    }
}

// ---------------- 浏览器发现与启动 ----------------

/// 随应用分发的内置浏览器（打包时放入 resource_dir/browser/）。
fn bundled_browser(app: &AppHandle) -> Option<PathBuf> {
    let mut roots: Vec<PathBuf> = Vec::new();
    if let Ok(r) = app.path().resource_dir() {
        roots.push(r);
    }
    if let Ok(exe) = std::env::current_exe() {
        if let Some(d) = exe.parent() {
            roots.push(d.to_path_buf());
        }
    }
    #[cfg(debug_assertions)]
    roots.push(PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../vendor"));

    #[cfg(target_os = "windows")]
    const REL: [&str; 1] = ["browser/chrome-win64/chrome.exe"];
    #[cfg(target_os = "macos")]
    const REL: [&str; 2] = [
        "browser/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing",
        "browser/chrome-mac-x64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing",
    ];
    #[cfg(target_os = "linux")]
    const REL: [&str; 1] = ["browser/chrome-linux64/chrome"];

    for root in &roots {
        for rel in REL {
            let p = root.join(rel);
            if p.exists() {
                return Some(p);
            }
        }
    }
    None
}

/// 应急回退：系统中已安装的 Chrome/Edge/Chromium。
fn system_browser() -> Option<PathBuf> {
    #[cfg(target_os = "windows")]
    let cands: Vec<PathBuf> = {
        let pf = std::env::var("ProgramFiles").unwrap_or_else(|_| "C:\\Program Files".into());
        let pfx = std::env::var("ProgramFiles(x86)")
            .unwrap_or_else(|_| "C:\\Program Files (x86)".into());
        let local = std::env::var("LOCALAPPDATA").unwrap_or_default();
        vec![
            format!("{pf}\\Google\\Chrome\\Application\\chrome.exe").into(),
            format!("{pfx}\\Google\\Chrome\\Application\\chrome.exe").into(),
            format!("{local}\\Google\\Chrome\\Application\\chrome.exe").into(),
            format!("{pf}\\Microsoft\\Edge\\Application\\msedge.exe").into(),
            format!("{pfx}\\Microsoft\\Edge\\Application\\msedge.exe").into(),
        ]
    };
    #[cfg(target_os = "macos")]
    let cands: Vec<PathBuf> = vec![
        "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome".into(),
        "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge".into(),
        "/Applications/Chromium.app/Contents/MacOS/Chromium".into(),
    ];
    #[cfg(target_os = "linux")]
    let cands: Vec<PathBuf> = vec![
        "/usr/bin/google-chrome".into(),
        "/usr/bin/google-chrome-stable".into(),
        "/usr/bin/chromium".into(),
        "/usr/bin/chromium-browser".into(),
        "/usr/bin/microsoft-edge".into(),
        "/snap/bin/chromium".into(),
    ];
    cands.into_iter().find(|p| p.exists())
}

fn find_browser(app: &AppHandle) -> Option<PathBuf> {
    bundled_browser(app).or_else(system_browser)
}

async fn cdp_alive() -> bool {
    http_json(&format!("http://127.0.0.1:{CDP_PORT}/json/version"), 2)
        .await
        .is_ok()
}

async fn http_json(url: &str, timeout_secs: u64) -> Result<Value, String> {
    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(timeout_secs))
        .build()
        .map_err(|e| e.to_string())?;
    client
        .get(url)
        .send()
        .await
        .map_err(|e| e.to_string())?
        .json::<Value>()
        .await
        .map_err(|e| e.to_string())
}

async fn ensure_browser(app: &AppHandle, st: &Arc<Shared>, url: &str) -> Result<(), String> {
    if cdp_alive().await {
        return Ok(());
    }
    // 若旧进程句柄还在但 CDP 不通，先清理
    {
        let mut guard = st.child.lock().unwrap();
        if let Some(mut c) = guard.take() {
            let _ = c.kill();
        }
    }
    let exe = find_browser(app).ok_or_else(|| {
        "未找到内置浏览器，也未检测到系统 Chrome/Edge。请重新安装应用或安装 Chrome。".to_string()
    })?;
    let args = vec![
        format!("--remote-debugging-port={CDP_PORT}"),
        "--remote-allow-origins=*".to_string(),
        format!("--user-data-dir={}", st.profile_dir.display()),
        "--no-first-run".to_string(),
        "--no-default-browser-check".to_string(),
        "--disable-session-crashed-bubble".to_string(),
        "--hide-crash-restore-bubble".to_string(),
        // 关键：抹掉 navigator.webdriver 等自动化特征
        "--disable-blink-features=AutomationControlled".to_string(),
        "--disable-features=TranslateUI".to_string(),
        "--lang=zh-CN".to_string(),
        "--new-window".to_string(),
        url.to_string(),
    ];
    let child = std::process::Command::new(&exe)
        .args(&args)
        .stdout(std::process::Stdio::null())
        .stderr(std::process::Stdio::null())
        .spawn()
        .map_err(|e| format!("浏览器启动失败: {e}"))?;
    *st.child.lock().unwrap() = Some(child);

    for _ in 0..60 {
        if cdp_alive().await {
            return Ok(());
        }
        tokio::time::sleep(std::time::Duration::from_millis(500)).await;
    }
    Err("浏览器启动超时，请重试".to_string())
}

// ---------------- CDP 会话 ----------------

async fn send_command(
    st: &Arc<Shared>,
    session: Option<&str>,
    method: &str,
    params: Value,
) -> Result<Value, String> {
    let id = st.next_id.fetch_add(1, Ordering::SeqCst);
    let mut msg = json!({ "id": id, "method": method, "params": params });
    if let Some(s) = session {
        msg["sessionId"] = json!(s);
    }
    let (tx, rx) = oneshot::channel();
    st.pending.lock().unwrap().insert(id, tx);
    {
        let mut guard = st.sink.lock().await;
        let sink = guard.as_mut().ok_or_else(|| "CDP 未连接".to_string())?;
        if let Err(e) = sink
            .send(tokio_tungstenite::tungstenite::Message::Text(
                msg.to_string().into(),
            ))
            .await
        {
            st.pending.lock().unwrap().remove(&id);
            return Err(format!("CDP 发送失败: {e}"));
        }
    }
    let resp = match tokio::time::timeout(std::time::Duration::from_secs(30), rx).await {
        Ok(Ok(v)) => v,
        Ok(Err(_)) => return Err("CDP 通道关闭".to_string()),
        Err(_) => {
            st.pending.lock().unwrap().remove(&id);
            return Err("CDP 响应超时".to_string());
        }
    };
    if let Some(err) = resp.get("error") {
        let m = err
            .get("message")
            .and_then(|v| v.as_str())
            .unwrap_or("未知 CDP 错误");
        return Err(m.to_string());
    }
    Ok(resp.get("result").cloned().unwrap_or(Value::Null))
}

fn spawn_reader(st: Arc<Shared>, mut stream: WsSource) {
    tokio::spawn(async move {
        while let Some(msg) = stream.next().await {
            match msg {
                Ok(tokio_tungstenite::tungstenite::Message::Text(txt)) => {
                    if let Ok(v) = serde_json::from_str::<Value>(&txt) {
                        if let Some(id) = v.get("id").and_then(|i| i.as_u64()) {
                            let tx = st.pending.lock().unwrap().remove(&id);
                            if let Some(tx) = tx {
                                let _ = tx.send(v);
                            }
                        }
                    }
                }
                Ok(_) => {}
                Err(_) => break,
            }
        }
        // 连接断开：清理状态，下次使用时重连
        {
            let mut guard = st.sink.lock().await;
            *guard = None;
        }
        *st.session.lock().unwrap() = None;
        // 唤醒所有等待者
        let mut map = st.pending.lock().unwrap();
        map.clear();
    });
}

async fn connect_ws(st: &Arc<Shared>) -> Result<(), String> {
    {
        let guard = st.sink.lock().await;
        if guard.is_some() {
            return Ok(());
        }
    }
    let ver = http_json(&format!("http://127.0.0.1:{CDP_PORT}/json/version"), 5).await?;
    let ws_url = ver
        .get("webSocketDebuggerUrl")
        .and_then(|v| v.as_str())
        .ok_or_else(|| "CDP 地址获取失败".to_string())?;
    let (ws, _) = tokio_tungstenite::connect_async(ws_url)
        .await
        .map_err(|e| format!("CDP 连接失败: {e}"))?;
    let (sink, stream) = ws.split();
    *st.sink.lock().await = Some(sink);
    spawn_reader(st.clone(), stream);
    Ok(())
}

fn pick_boss_target(targets: &Value) -> Option<String> {
    targets
        .get("targetInfos")
        .and_then(|v| v.as_array())
        .and_then(|arr| {
            arr.iter().find(|t| {
                t.get("type").and_then(|v| v.as_str()) == Some("page")
                    && t.get("url")
                        .and_then(|v| v.as_str())
                        .map(|u| u.contains("zhipin.com"))
                        .unwrap_or(false)
            })
        })
        .and_then(|t| t.get("targetId").and_then(|v| v.as_str()))
        .map(|s| s.to_string())
}

async fn ensure_session(st: &Arc<Shared>) -> Result<String, String> {
    if let Some(s) = st.session.lock().unwrap().clone() {
        return Ok(s);
    }
    connect_ws(st).await?;
    let targets = send_command(st, None, "Target.getTargets", json!({})).await?;
    let target_id = match pick_boss_target(&targets) {
        Some(t) => t,
        None => {
            let r = send_command(
                st,
                None,
                "Target.createTarget",
                json!({ "url": BOSS_HOME }),
            )
            .await?;
            r.get("targetId")
                .and_then(|v| v.as_str())
                .ok_or_else(|| "创建标签页失败".to_string())?
                .to_string()
        }
    };
    let r = send_command(
        st,
        None,
        "Target.attachToTarget",
        json!({ "targetId": target_id, "flatten": true }),
    )
    .await?;
    let sid = r
        .get("sessionId")
        .and_then(|v| v.as_str())
        .ok_or_else(|| "附加到标签页失败".to_string())?
        .to_string();
    *st.session.lock().unwrap() = Some(sid.clone());
    Ok(sid)
}

fn reset_conn(st: &Arc<Shared>) {
    *st.session.lock().unwrap() = None;
    // sink 置空会触发 ensure_session 重连；旧 reader 会因写端关闭而退出
    if let Ok(mut guard) = st.sink.try_lock() {
        *guard = None;
    }
}

// ---------------- 对外接口 ----------------

/// 在内置浏览器中执行 JS（async 函数体，须以 return 结尾）。
pub async fn eval(
    app: &AppHandle,
    state: &CdpState,
    script: &str,
    _timeout_ms: Option<u64>,
) -> Result<Value, String> {
    let st = &state.shared;
    ensure_browser(app, st, BOSS_HOME).await?;

    let mut last_err = String::new();
    for _ in 0..2 {
        match ensure_session(st).await {
            Ok(sid) => {
                let expr = format!("(async () => {{ {script} }})()");
                match send_command(
                    st,
                    Some(&sid),
                    "Runtime.evaluate",
                    json!({
                        "expression": expr,
                        "awaitPromise": true,
                        "returnByValue": true,
                        "userGesture": true
                    }),
                )
                .await
                {
                    Ok(res) => {
                        if let Some(exc) = res.get("exceptionDetails") {
                            let text =
                                exc.get("text").and_then(|t| t.as_str()).unwrap_or("JS 错误");
                            let desc = exc
                                .pointer("/exception/description")
                                .and_then(|d| d.as_str())
                                .unwrap_or("");
                            let line = desc.lines().next().unwrap_or("");
                            return Err(format!("{text}: {line}"));
                        }
                        return Ok(res.pointer("/result/value").cloned().unwrap_or(Value::Null));
                    }
                    Err(e) => last_err = e,
                }
            }
            Err(e) => last_err = e,
        }
        reset_conn(st);
        tokio::time::sleep(std::time::Duration::from_millis(500)).await;
    }
    Err(last_err)
}

/// 打开（或聚焦）内置浏览器并导航到指定页面。
pub async fn open(app: &AppHandle, state: &CdpState, url: Option<String>) -> Result<(), String> {
    let target = url.unwrap_or_else(|| BOSS_HOME.to_string());
    let st = &state.shared;
    ensure_browser(app, st, &target).await?;
    let sid = ensure_session(st).await?;
    // 聚焦 BOSS 标签页
    let targets = send_command(st, None, "Target.getTargets", json!({})).await?;
    if let Some(tid) = pick_boss_target(&targets) {
        let _ = send_command(st, None, "Target.activateTarget", json!({ "targetId": tid })).await;
    }
    // 如需跳转指定页面
    if target != BOSS_HOME {
        let _ = send_command(
            st,
            Some(&sid),
            "Page.navigate",
            json!({ "url": target }),
        )
        .await;
    }
    Ok(())
}

/// 关闭内置浏览器。
pub fn close(state: &CdpState) {
    let mut guard = state.shared.child.lock().unwrap();
    if let Some(mut c) = guard.take() {
        let _ = c.kill();
    }
    *state.shared.session.lock().unwrap() = None;
}

/// 内置浏览器是否存活。
pub async fn is_open(_state: &CdpState) -> bool {
    cdp_alive().await
}

/// 应用退出时清理浏览器进程。
pub fn shutdown(state: &CdpState) {
    close(state);
}
