// Backend: file I/O, dialogs, settings and file association only. All PDF work happens
// in the frontend's MuPDF worker.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod files;
mod settings;

fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .invoke_handler(tauri::generate_handler![
            files::read_pdf,
            files::launch_path,
            settings::recent_files,
            settings::add_recent_file,
            settings::remove_recent_file,
        ])
        .run(tauri::generate_context!())
        .expect("error while running typenote");
}
