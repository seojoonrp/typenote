use std::path::PathBuf;
use tauri::ipc::Response;

/// Reads a PDF and returns the raw bytes over binary IPC (an ArrayBuffer on the JS side).
#[tauri::command]
pub async fn read_pdf(path: String) -> Result<Response, String> {
    let bytes = tauri::async_runtime::spawn_blocking(move || std::fs::read(&path))
        .await
        .map_err(|e| e.to_string())?
        .map_err(|e| e.to_string())?;
    Ok(Response::new(bytes))
}

/// The PDF passed on the command line (e.g. opened through the .pdf file association).
#[tauri::command]
pub fn launch_path() -> Option<String> {
    std::env::args_os()
        .skip(1)
        .map(PathBuf::from)
        .find(|p| p.extension().is_some_and(|e| e.eq_ignore_ascii_case("pdf")) && p.is_file())
        .map(|p| p.to_string_lossy().into_owned())
}
