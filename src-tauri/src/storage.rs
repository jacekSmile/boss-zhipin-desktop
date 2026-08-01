use serde::{Deserialize, Serialize};
use std::fs;
use std::path::PathBuf;
use tauri::Manager;

fn app_data_dir(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    let dir = app
        .path()
        .app_data_dir()
        .map_err(|e| e.to_string())?;
    fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    Ok(dir)
}

fn resumes_dir(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    let dir = app_data_dir(app)?.join("resumes");
    fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    Ok(dir)
}

fn history_path(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    Ok(app_data_dir(app)?.join("delivery_history.json"))
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ResumeInfo {
    pub name: String,
    pub size: u64,
    pub modified_ms: u64,
    pub ext: String,
}

#[tauri::command]
pub fn list_resumes(app: tauri::AppHandle) -> Result<Vec<ResumeInfo>, String> {
    let dir = resumes_dir(&app)?;
    let mut out = Vec::new();
    let entries = fs::read_dir(&dir).map_err(|e| e.to_string())?;
    for entry in entries.flatten() {
        let path = entry.path();
        if !path.is_file() {
            continue;
        }
        let meta = entry.metadata().map_err(|e| e.to_string())?;
        let modified_ms = meta
            .modified()
            .ok()
            .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
            .map(|d| d.as_millis() as u64)
            .unwrap_or(0);
        let name = entry.file_name().to_string_lossy().to_string();
        let ext = path
            .extension()
            .map(|e| e.to_string_lossy().to_lowercase())
            .unwrap_or_default();
        out.push(ResumeInfo {
            name,
            size: meta.len(),
            modified_ms,
            ext,
        });
    }
    out.sort_by(|a, b| b.modified_ms.cmp(&a.modified_ms));
    Ok(out)
}

#[tauri::command]
pub fn save_resume(app: tauri::AppHandle, name: String, data_base64: String) -> Result<(), String> {
    use base64::Engine;
    // Sanitize file name: strip path separators.
    let safe: String = name
        .chars()
        .filter(|c| !matches!(c, '/' | '\\' | ':' | '*' | '?' | '"' | '<' | '>' | '|'))
        .collect();
    if safe.is_empty() {
        return Err("文件名无效".to_string());
    }
    let bytes = base64::engine::general_purpose::STANDARD
        .decode(data_base64)
        .map_err(|e| format!("base64 解码失败: {e}"))?;
    let path = resumes_dir(&app)?.join(&safe);
    fs::write(&path, bytes).map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub fn delete_resume(app: tauri::AppHandle, name: String) -> Result<(), String> {
    let path = resumes_dir(&app)?.join(&name);
    if path.exists() {
        fs::remove_file(&path).map_err(|e| e.to_string())?;
    }
    Ok(())
}

#[tauri::command]
pub fn read_resume_base64(app: tauri::AppHandle, name: String) -> Result<String, String> {
    use base64::Engine;
    let path = resumes_dir(&app)?.join(&name);
    let bytes = fs::read(&path).map_err(|e| e.to_string())?;
    Ok(base64::engine::general_purpose::STANDARD.encode(bytes))
}

#[tauri::command]
pub fn load_history(app: tauri::AppHandle) -> Result<serde_json::Value, String> {
    let path = history_path(&app)?;
    if !path.exists() {
        return Ok(serde_json::json!([]));
    }
    let text = fs::read_to_string(&path).map_err(|e| e.to_string())?;
    serde_json::from_str(&text).map_err(|e| format!("历史记录解析失败: {e}"))
}

#[tauri::command]
pub fn append_history(app: tauri::AppHandle, records: Vec<serde_json::Value>) -> Result<(), String> {
    let path = history_path(&app)?;
    let mut all: Vec<serde_json::Value> = if path.exists() {
        let text = fs::read_to_string(&path).map_err(|e| e.to_string())?;
        serde_json::from_str(&text).unwrap_or_default()
    } else {
        Vec::new()
    };
    all.extend(records);
    // Cap history at 5000 records.
    if all.len() > 5000 {
        let excess = all.len() - 5000;
        all.drain(0..excess);
    }
    let text = serde_json::to_string_pretty(&all).map_err(|e| e.to_string())?;
    fs::write(&path, text).map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub fn clear_history(app: tauri::AppHandle) -> Result<(), String> {
    let path = history_path(&app)?;
    fs::write(&path, "[]").map_err(|e| e.to_string())?;
    Ok(())
}
