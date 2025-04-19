#![cfg_attr(
    all(not(debug_assertions), target_os = "windows"),
    windows_subsystem = "windows"
)]

use tauri::{Manager, SystemTray, SystemTrayEvent, SystemTrayMenu};
use std::sync::Mutex;

// Define application state
struct AppState {
    backend_url: Mutex<String>,
}

// Initialize the application
fn main() {
    // Create system tray menu
    let tray_menu = SystemTrayMenu::new();
    let system_tray = SystemTray::new().with_menu(tray_menu);

    tauri::Builder::default()
        .manage(AppState {
            backend_url: Mutex::new("http://localhost:8000".to_string()),
        })
        .system_tray(system_tray)
        .on_system_tray_event(|app, event| match event {
            SystemTrayEvent::LeftClick { .. } => {
                let window = app.get_window("main").unwrap();
                window.show().unwrap();
                window.set_focus().unwrap();
            }
            _ => {}
        })
        .on_window_event(|event| match event.event() {
            tauri::WindowEvent::CloseRequested { api, .. } => {
                event.window().hide().unwrap();
                api.prevent_close();
            }
            _ => {}
        })
        .setup(|app| {
            // Register global hotkeys
            let window = app.get_window("main").unwrap();
            
            // Setup any additional initialization here
            
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            // Register command handlers here
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
