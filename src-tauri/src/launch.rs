//! PDFs to open: from the command line at launch, and from later launches (.pdf file
//! association, command line), which the single-instance plugin hands to the running app.
//! They all open as tabs in the one window; the frontend picks them up with `launch_paths`.

use std::path::Path;
use std::sync::Mutex;
use tauri::{AppHandle, Emitter, Manager, State};

#[derive(Default)]
pub struct Pending(Mutex<Vec<String>>);

impl Pending {
    pub fn add(&self, paths: Vec<String>) {
        self.0.lock().unwrap().extend(paths);
    }
}

/// The arguments naming existing .pdf files, resolved against `cwd`.
pub fn pdf_args(args: impl IntoIterator<Item = String>, cwd: &Path) -> Vec<String> {
    args.into_iter()
        .map(|a| cwd.join(a))
        .filter(|p| p.extension().is_some_and(|e| e.eq_ignore_ascii_case("pdf")) && p.is_file())
        .map(|p| p.to_string_lossy().into_owned())
        .collect()
}

/// A second launch of the app: `args` are its command line (program first), `cwd` its folder.
pub fn on_second_instance(app: &AppHandle, args: Vec<String>, cwd: String) {
    let paths = pdf_args(args.into_iter().skip(1), Path::new(&cwd));
    if !paths.is_empty() {
        app.state::<Pending>().add(paths);
        let _ = app.emit_to("main", "open-request", ());
    }
    if let Some(w) = app.get_webview_window("main") {
        let _ = w.unminimize();
        let _ = w.set_focus();
    }
}

/// PDFs waiting to be opened, each handed out once.
#[tauri::command]
pub fn launch_paths(pending: State<Pending>) -> Vec<String> {
    std::mem::take(&mut *pending.0.lock().unwrap())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn finds_pdf_arguments_relative_to_cwd() {
        let dir = std::env::temp_dir().join(format!("typenote-test-args-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        std::fs::write(dir.join("a.PDF"), b"%PDF").unwrap();
        std::fs::write(dir.join("b.pdf"), b"%PDF").unwrap();
        let args = ["--flag", "missing.pdf", "a.PDF", "notes.txt", "b.pdf"].map(String::from);
        let found = pdf_args(args, &dir);
        assert_eq!(found, ["a.PDF", "b.pdf"].map(|n| dir.join(n).to_string_lossy().into_owned()));
        let abs = dir.join("b.pdf").to_string_lossy().into_owned();
        assert_eq!(pdf_args([abs.clone()], Path::new("C:\\elsewhere")), [abs]);
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn hands_out_pending_paths_once() {
        let pending = Pending::default();
        pending.add(vec!["a.pdf".into()]);
        pending.add(vec!["b.pdf".into()]);
        assert_eq!(std::mem::take(&mut *pending.0.lock().unwrap()), ["a.pdf", "b.pdf"]);
        assert!(pending.0.lock().unwrap().is_empty());
    }
}
