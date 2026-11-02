use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};
use tauri::{AppHandle, Manager};

const RECENT_MAX: usize = 10;

/// settings.json in the app config dir. Unknown keys are kept so later phases can add fields.
#[derive(Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
struct Settings {
    #[serde(default)]
    recent_files: Vec<String>,
    #[serde(flatten)]
    extra: serde_json::Map<String, serde_json::Value>,
}

fn settings_path(app: &AppHandle) -> Result<PathBuf, String> {
    let dir = app.path().app_config_dir().map_err(|e| e.to_string())?;
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    Ok(dir.join("settings.json"))
}

fn load(path: &Path) -> Settings {
    std::fs::read(path)
        .ok()
        .and_then(|b| serde_json::from_slice(&b).ok())
        .unwrap_or_default()
}

fn store(path: &Path, settings: &Settings) -> Result<(), String> {
    let json = serde_json::to_vec_pretty(settings).map_err(|e| e.to_string())?;
    let tmp = path.with_extension("json.tmp");
    std::fs::write(&tmp, json).map_err(|e| e.to_string())?;
    std::fs::rename(&tmp, path).map_err(|e| e.to_string())
}

fn same_path(a: &str, b: &str) -> bool {
    a.eq_ignore_ascii_case(b)
}

/// Recent files that still exist, most recent first.
#[tauri::command]
pub fn recent_files(app: AppHandle) -> Result<Vec<String>, String> {
    let settings = load(&settings_path(&app)?);
    Ok(settings
        .recent_files
        .into_iter()
        .filter(|p| Path::new(p).is_file())
        .collect())
}

#[tauri::command]
pub fn add_recent_file(app: AppHandle, path: String) -> Result<Vec<String>, String> {
    let file = settings_path(&app)?;
    let mut settings = load(&file);
    settings.recent_files.retain(|p| !same_path(p, &path));
    settings.recent_files.insert(0, path);
    settings.recent_files.truncate(RECENT_MAX);
    store(&file, &settings)?;
    Ok(settings.recent_files)
}

#[tauri::command]
pub fn remove_recent_file(app: AppHandle, path: String) -> Result<Vec<String>, String> {
    let file = settings_path(&app)?;
    let mut settings = load(&file);
    settings.recent_files.retain(|p| !same_path(p, &path));
    store(&file, &settings)?;
    Ok(settings.recent_files)
}
