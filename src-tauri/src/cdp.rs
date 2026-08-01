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
        // 默认离屏隐藏运行（仍是有头模式，指纹与正常用户一致）；
        // 需要人工操作时由程序把窗口移回屏幕
        "--window-position=-32000,-32000".to_string(),
        "--window-size=1280,860".to_string(),
        // 必须有 --new-window，否则 URL 参数不生效（只开空白页）
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

const LOGIN_URL: &str = "https://www.zhipin.com/web/user/?ka=header-login";

/// 把离屏隐藏的浏览器窗口移回屏幕（供人工处理验证码/登录等场景）。
pub async fn show_window(state: &CdpState) -> Result<(), String> {
    let st = &state.shared;
    let sid = ensure_session(st).await?;
    let win = send_command(st, Some(&sid), "Browser.getWindowForTarget", json!({})).await?;
    let wid = win
        .get("windowId")
        .and_then(|v| v.as_i64())
        .ok_or_else(|| "获取窗口句柄失败".to_string())?;
    send_command(
        st,
        None,
        "Browser.setWindowBounds",
        json!({ "windowId": wid, "bounds": { "windowState": "normal", "left": 80, "top": 60, "width": 1280, "height": 860 } }),
    )
    .await?;
    Ok(())
}

/// 把浏览器窗口重新移出屏幕隐藏。
pub async fn hide_window(state: &CdpState) -> Result<(), String> {
    let st = &state.shared;
    let sid = ensure_session(st).await?;
    let win = send_command(st, Some(&sid), "Browser.getWindowForTarget", json!({})).await?;
    let wid = win
        .get("windowId")
        .and_then(|v| v.as_i64())
        .ok_or_else(|| "获取窗口句柄失败".to_string())?;
    send_command(
        st,
        None,
        "Browser.setWindowBounds",
        json!({ "windowId": wid, "bounds": { "windowState": "normal", "left": -32000, "top": -32000, "width": 1280, "height": 860 } }),
    )
    .await?;
    Ok(())
}

/// 获取 BOSS 登录二维码（data URL），供应用内展示扫码。
/// 浏览器保持离屏隐藏，用户无需看到浏览器窗口。
pub async fn get_login_qr(app: &AppHandle, state: &CdpState) -> Result<String, String> {
    let st = &state.shared;
    ensure_browser(app, st, LOGIN_URL).await?;
    let sid = ensure_session(st).await?;

    // 若当前不在登录相关页面，导航过去
    let cur = send_command(
        st,
        Some(&sid),
        "Runtime.evaluate",
        json!({ "expression": "location.href", "returnByValue": true }),
    )
    .await?;
    let href = cur
        .pointer("/result/value")
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .to_string();
    if !href.contains("/web/user") && !href.contains("login") {
        let _ = send_command(st, Some(&sid), "Page.navigate", json!({ "url": LOGIN_URL })).await;
    }

    // 轮询等待二维码出现（页面渲染 + 风控页刷新都需要时间）
    const PROBE: &str = r#"
// 1) 若存在「APP扫码登录」切换入口（默认停在验证码登录），先点击
const tip = Array.from(document.querySelectorAll('*')).find(e => e.children.length === 0 && /APP扫码登录|扫码登录/.test((e.textContent || '').trim()));
if (tip) { ['pointerdown','mousedown','mouseup','pointerup','click'].forEach(t => tip.dispatchEvent(new MouseEvent(t, { bubbles: true, cancelable: true, view: window }))); }
await new Promise(r => setTimeout(r, 1200));
// 2) 优先二维码容器内的 img（BOSS 登录页结构 .qr-code-box/.qr-img-box）
const inBox = document.querySelector('.qr-code-box img, .qr-img-box img, [class*="qrcode"] img, [class*="qr-code"] img');
if (inBox && (inBox.currentSrc || inBox.src)) return { kind: 'img', src: inBox.currentSrc || inBox.src };
// 3) 可见的 blob: 图片，取最大（排除 APP 下载码等隐藏元素）
const blobs = Array.from(document.querySelectorAll('img')).filter(i => (i.currentSrc || i.src || '').startsWith('blob:') && i.naturalWidth > 80 && i.offsetParent);
if (blobs.length) { blobs.sort((a, b) => b.naturalWidth - a.naturalWidth); return { kind: 'img', src: blobs[0].currentSrc || blobs[0].src }; }
// 4) http(s) 且带 qr 字样的 img
const httpQr = Array.from(document.querySelectorAll('img')).find(i => /^https?:/.test(i.currentSrc || i.src || '') && /qr|code/i.test(i.currentSrc || i.src || '') && i.naturalWidth > 80);
if (httpQr) return { kind: 'img', src: httpQr.currentSrc || httpQr.src };
// 5) canvas 兜底
const canvas = Array.from(document.querySelectorAll('canvas')).find(c => c.width > 80 && c.height > 80);
if (canvas) { try { return { kind: 'canvas', dataUrl: canvas.toDataURL('image/png') }; } catch (e) {} }
return null;
"#;
    for _ in 0..30 {
        let r = send_command(
            st,
            Some(&sid),
            "Runtime.evaluate",
            json!({
                "expression": format!("(async () => {{ {PROBE} }})()"),
                "awaitPromise": true,
                "returnByValue": true
            }),
        )
        .await?;
        let v = r.pointer("/result/value").cloned().unwrap_or(Value::Null);
        if !v.is_null() {
            let kind = v.get("kind").and_then(|x| x.as_str()).unwrap_or("");
            if kind == "canvas" {
                if let Some(d) = v.get("dataUrl").and_then(|x| x.as_str()) {
                    return Ok(d.to_string());
                }
            } else {
                let src = v.get("src").and_then(|x| x.as_str()).unwrap_or("");
                if src.starts_with("data:") {
                    return Ok(src.to_string());
                }
                if src.starts_with("http") || src.starts_with("blob:") {
                    // 优先在页面上下文内取图（blob: 只能页面内取；http 带 cookie/referer）
                    let js = format!(
                        r#"const r = await fetch({src:?}, {{ credentials: 'include' }});
if (!r.ok) throw new Error('img http ' + r.status);
const buf = await r.arrayBuffer();
const u = new Uint8Array(buf);
let s = '';
for (let i = 0; i < u.length; i += 8192) s += String.fromCharCode.apply(null, Array.from(u.subarray(i, i + 8192)));
return btoa(s);"#,
                        src = json!(src)
                    );
                    if let Ok(b64_res) = send_command(
                        st,
                        Some(&sid),
                        "Runtime.evaluate",
                        json!({
                            "expression": format!("(async () => {{ {js} }})()"),
                            "awaitPromise": true,
                            "returnByValue": true
                        }),
                    )
                    .await
                    {
                        if let Some(b64) = b64_res.pointer("/result/value").and_then(|x| x.as_str()) {
                            return Ok(format!("data:image/png;base64,{b64}"));
                        }
                    }
                    // Rust 侧兜底（仅 http(s) 可外部下载）
                    if src.starts_with("http") {
                        use base64::Engine;
                        let client = reqwest::Client::builder()
                            .timeout(std::time::Duration::from_secs(10))
                            .user_agent("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/151.0.0.0 Safari/537.36")
                            .build()
                            .map_err(|e| e.to_string())?;
                        if let Ok(resp) = client.get(src).send().await {
                            if let Ok(bytes) = resp.bytes().await {
                                let b64 = base64::engine::general_purpose::STANDARD.encode(bytes);
                                return Ok(format!("data:image/png;base64,{b64}"));
                            }
                        }
                    }
                }
            }
        }
        tokio::time::sleep(std::time::Duration::from_millis(800)).await;
    }
    Err("等待二维码加载超时，请点击刷新重试".to_string())
}
