// Backend: file I/O, dialogs, settings and files to open. All PDF work happens in the
// frontend's MuPDF workers.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod files;
mod launch;
mod settings;

use tauri::Manager;

fn main() {
    let mut context = tauri::generate_context!();
    // The dev build is a separate app (own single-instance lock, settings and WebView2 data),
    // so running it never hands files to, or shares a recent list with, an installed copy.
    #[cfg(debug_assertions)]
    context.config_mut().identifier.push_str(".dev");

    tauri::Builder::default()
        // first, so a second launch hands its files over before anything else starts
        .plugin(tauri_plugin_single_instance::init(launch::on_second_instance))
        .plugin(tauri_plugin_dialog::init())
        .manage(launch::Pending::default())
        .setup(|app| {
            let cwd = std::env::current_dir().unwrap_or_default();
            app.state::<launch::Pending>().add(launch::pdf_args(std::env::args().skip(1), &cwd));
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            files::read_pdf,
            files::write_pdf,
            files::file_stamp,
            launch::launch_paths,
            settings::recent_files,
            settings::add_recent_file,
            settings::remove_recent_file,
        ])
        .run(context)
        .expect("error while running typenote");
}
