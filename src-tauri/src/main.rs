// Backend: file I/O, dialogs, settings, file association and windows. All PDF work happens
// in the frontend's MuPDF worker.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod files;
mod settings;
mod windows;

use tauri::Manager;

fn main() {
    tauri::Builder::default()
        // first, so a second launch hands its file over before anything else starts
        .plugin(tauri_plugin_single_instance::init(windows::on_second_instance))
        .plugin(tauri_plugin_dialog::init())
        .manage(windows::Windows::default())
        .setup(|app| {
            let cwd = std::env::current_dir().unwrap_or_default();
            if let Some(path) = windows::pdf_arg(std::env::args().skip(1), &cwd) {
                app.state::<windows::Windows>().assign("main", path);
            }
            Ok(())
        })
        .on_window_event(|window, event| {
            if let tauri::WindowEvent::Destroyed = event {
                window.state::<windows::Windows>().forget(window.label());
            }
        })
        .invoke_handler(tauri::generate_handler![
            files::read_pdf,
            files::write_pdf,
            files::file_stamp,
            windows::launch_path,
            windows::set_open_path,
            windows::focus_window_showing,
            settings::recent_files,
            settings::add_recent_file,
            settings::remove_recent_file,
        ])
        .run(tauri::generate_context!())
        .expect("error while running typenote");
}
