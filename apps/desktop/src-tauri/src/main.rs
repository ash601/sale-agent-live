// what: Tauri bootstrap for always-on-top transparent window
// input: none (configured window attributes)
// return: app run loop
#![cfg_attr(not(debug_assertions), windows_subsystem = "macos")]

use tauri::{Manager};

fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_window_state::Builder::default().build())
        .setup(|app| {
            let window = app.get_window("main").unwrap();
            window.set_always_on_top(true).ok();
            #[cfg(target_os = "macos")]
            {
                use tauri::TitleBarStyle;
                window.set_title_bar_style(TitleBarStyle::Overlay, Default::default()).ok();
                window.set_transparent_titlebar(true).ok();
            }
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}


