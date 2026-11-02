//! One window per document. A PDF opened while the app runs (file association, command line)
//! reaches the running instance (single-instance plugin) and goes to the window that already
//! shows it, else to a window without a document, else to a new window.

use std::collections::HashMap;
use std::path::Path;
use std::sync::atomic::{AtomicU32, Ordering};
use std::sync::Mutex;
use tauri::{AppHandle, Emitter, Manager, State, WebviewWindow, WebviewWindowBuilder, Window};

#[derive(Default)]
pub struct Windows {
    /// label -> PDF the window should open once its frontend asks (`launch_path`)
    pending: Mutex<HashMap<String, String>>,
    /// label -> PDF the window shows or is about to open
    open: Mutex<HashMap<String, String>>,
    next: AtomicU32,
}

impl Windows {
    /// Gives `path` to window `label`: it opens it on its next `launch_path` call.
    pub fn assign(&self, label: &str, path: String) {
        self.open.lock().unwrap().insert(label.to_owned(), path.clone());
        self.pending.lock().unwrap().insert(label.to_owned(), path);
    }

    pub fn forget(&self, label: &str) {
        self.open.lock().unwrap().remove(label);
        self.pending.lock().unwrap().remove(label);
    }

    /// The window (other than `except`) that shows `path`.
    fn showing(&self, path: &str, except: Option<&str>) -> Option<String> {
        let key = file_key(path);
        let open = self.open.lock().unwrap();
        open.iter()
            .find(|(label, p)| Some(label.as_str()) != except && file_key(p) == key)
            .map(|(label, _)| label.clone())
    }
}

/// Comparable form of a path: Windows paths are case-insensitive and may differ in spelling.
fn file_key(path: &str) -> String {
    std::fs::canonicalize(path)
        .map(|p| p.to_string_lossy().into_owned())
        .unwrap_or_else(|_| path.to_owned())
        .to_lowercase()
}

/// The first argument naming an existing .pdf file, resolved against `cwd`.
pub fn pdf_arg(args: impl IntoIterator<Item = String>, cwd: &Path) -> Option<String> {
    args.into_iter()
        .map(|a| cwd.join(a))
        .find(|p| p.extension().is_some_and(|e| e.eq_ignore_ascii_case("pdf")) && p.is_file())
        .map(|p| p.to_string_lossy().into_owned())
}

fn focus(window: &WebviewWindow) {
    let _ = window.unminimize();
    let _ = window.set_focus();
}

/// A second launch of the app: `args` are its command line (program first), `cwd` its folder.
pub fn on_second_instance(app: &AppHandle, args: Vec<String>, cwd: String) {
    let windows = app.state::<Windows>();
    let Some(path) = pdf_arg(args.into_iter().skip(1), Path::new(&cwd)) else {
        if let Some(w) = app.webview_windows().values().next() {
            focus(w);
        }
        return;
    };
    if let Some(w) = windows.showing(&path, None).and_then(|l| app.get_webview_window(&l)) {
        focus(&w);
        return;
    }
    let idle = {
        let open = windows.open.lock().unwrap();
        app.webview_windows().into_iter().find(|(label, _)| !open.contains_key(label))
    };
    if let Some((label, w)) = idle {
        windows.assign(&label, path);
        let _ = app.emit_to(label.as_str(), "open-request", ());
        focus(&w);
        return;
    }
    let label = format!("doc-{}", windows.next.fetch_add(1, Ordering::Relaxed) + 1);
    windows.assign(&label, path);
    let Some(mut config) = app.config().app.windows.first().cloned() else { return };
    config.label = label;
    let app = app.clone();
    // building a webview window on the event loop thread deadlocks on Windows
    std::thread::spawn(move || {
        if let Err(e) = WebviewWindowBuilder::from_config(&app, &config).and_then(|b| b.build()) {
            eprintln!("could not open a window: {e}");
            app.state::<Windows>().forget(&config.label);
        }
    });
}

/// The PDF this window was asked to open (at launch or later), once.
#[tauri::command]
pub fn launch_path(window: Window, windows: State<Windows>) -> Option<String> {
    windows.pending.lock().unwrap().remove(window.label())
}

/// The document this window shows, so the same file is not opened in two windows.
#[tauri::command]
pub fn set_open_path(window: Window, windows: State<Windows>, path: Option<String>) {
    let mut open = windows.open.lock().unwrap();
    match path {
        Some(p) => open.insert(window.label().to_owned(), p),
        None => open.remove(window.label()),
    };
}

/// Brings forward another window showing `path`; false if there is none.
#[tauri::command]
pub fn focus_window_showing(app: AppHandle, window: Window, windows: State<Windows>, path: String) -> bool {
    match windows.showing(&path, Some(window.label())).and_then(|l| app.get_webview_window(&l)) {
        Some(w) => {
            focus(&w);
            true
        }
        None => false,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn finds_pdf_argument_relative_to_cwd() {
        let dir = std::env::temp_dir().join(format!("typenote-test-args-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        std::fs::write(dir.join("a.PDF"), b"%PDF").unwrap();
        let args = ["--flag", "missing.pdf", "a.PDF"].map(String::from);
        assert_eq!(pdf_arg(args, &dir), Some(dir.join("a.PDF").to_string_lossy().into_owned()));
        let abs = dir.join("a.PDF").to_string_lossy().into_owned();
        assert_eq!(pdf_arg([abs.clone()], Path::new("C:\\elsewhere")), Some(abs));
        assert_eq!(pdf_arg(["notes.txt".to_owned()], &dir), None);
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn matches_open_files_regardless_of_case() {
        let dir = std::env::temp_dir().join(format!("typenote-test-open-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let file = dir.join("Doc.pdf");
        std::fs::write(&file, b"%PDF").unwrap();
        let w = Windows::default();
        w.assign("main", file.to_string_lossy().into_owned());
        let upper = file.to_string_lossy().to_uppercase();
        assert_eq!(w.showing(&upper, None), Some("main".to_owned()));
        assert_eq!(w.showing(&upper, Some("main")), None);
        w.forget("main");
        assert_eq!(w.showing(&upper, None), None);
        let _ = std::fs::remove_dir_all(&dir);
    }
}
