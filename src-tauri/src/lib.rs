// PL Paint shell (S332). The app is the web front end in ../src; Rust only does what a page cannot: write and read files in
// Documents\PL Paint. Raw bytes travel as the request body (a PNG as a JSON array of numbers would be four times the size).
use std::{fs, path::PathBuf};
use tauri::{ipc::{InvokeBody, Request}, Manager};

fn paint_dir(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    let dir = app.path().document_dir().map_err(|e| e.to_string())?.join("PL Paint");
    fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    Ok(dir)
}

/// Only a bare file name: no separators, no `..`, nothing that can leave the folder.
fn safe_name(name: &str) -> Result<&str, String> {
    if name.is_empty() || name.len() > 120 || name.contains(['/', '\\', ':']) || name.contains("..") {
        return Err(format!("refused file name: {name}"));
    }
    Ok(name)
}

#[tauri::command]
fn save_file(app: tauri::AppHandle, request: Request) -> Result<String, String> {
    let InvokeBody::Raw(bytes) = request.body() else { return Err("save_file wants raw bytes".into()) };
    let name = request.headers().get("x-name").and_then(|v| v.to_str().ok()).ok_or("missing x-name header")?;
    let path = paint_dir(&app)?.join(safe_name(name)?);
    let tmp = path.with_extension("tmp");
    fs::write(&tmp, bytes).map_err(|e| e.to_string())?;
    fs::rename(&tmp, &path).map_err(|e| e.to_string())?;   // never a half-written file: a crash mid-save keeps the last good one
    Ok(path.to_string_lossy().into_owned())
}

#[tauri::command]
fn read_file(app: tauri::AppHandle, name: String) -> Result<tauri::ipc::Response, String> {
    let path = paint_dir(&app)?.join(safe_name(&name)?);
    fs::read(&path).map(tauri::ipc::Response::new).map_err(|e| e.to_string())
}

#[tauri::command]
fn delete_file(app: tauri::AppHandle, name: String) -> Result<(), String> {
    let path = paint_dir(&app)?.join(safe_name(&name)?);
    if path.is_file() { fs::remove_file(&path).map_err(|e| e.to_string())?; }
    Ok(())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![save_file, read_file, delete_file])
        .run(tauri::generate_context!())
        .expect("error while running PL Paint");
}
