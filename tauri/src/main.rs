#![cfg_attr(
    all(not(debug_assertions), target_os = "windows"),
    windows_subsystem = "windows"
)]

// Import necessary Tauri and Rust standard library components
use tauri::{
    AppHandle, Manager, SystemTray, SystemTrayEvent, SystemTrayMenu, Wry,
    GlobalShortcutManager, CustomMenuItem, SystemTrayMenuItem
};
use std::sync::Mutex;
use std::process::{Command, Stdio}; // Use standard library Command for sync checks
use std::path::PathBuf;
use tokio::process::Command as TokioCommand; // Use tokio's Command for async execution
use tokio::io::{BufReader, AsyncBufReadExt}; // For reading stdout/stderr async

// --- Application State (Optional) ---
// You can store shared state here if needed across commands or plugins.
struct AppState {
    backend_url: Mutex<String>, // Example state
    // Add other state fields as required
}

// --- Helper Functions ---

// Helper function to find a suitable Python executable
fn find_python() -> String {
    // Define potential Python executable names based on OS
    let candidates = if cfg!(target_os = "windows") {
        // On Windows, 'py' launcher is often preferred, then python.exe
        vec!["py.exe", "python.exe", "python3.exe"]
    } else {
        // On Unix-like systems, 'python3' is standard, fallback to 'python'
        vec!["python3", "python"]
    };

    // Check each candidate by trying to run `python --version`
    for candidate in candidates {
        if Command::new(candidate).arg("--version").stdout(Stdio::null()).stderr(Stdio::null()).status().is_ok() {
            println!("Found Python executable: {}", candidate);
            return candidate.to_string();
        }
    }

    // Fallback if no executable is found in PATH
    eprintln!("Warning: Could not automatically find a Python executable. Defaulting to 'python'. Please ensure Python is installed and in your system's PATH.");
    "python".to_string()
}

// Helper function to resolve the path to agent scripts robustly
fn resolve_script_path(app_handle: &AppHandle<Wry>, script_name: &str) -> Result<PathBuf, String> {
    // 1. Check Tauri's Resource directory (ideal for bundled applications)
     match app_handle.path().resolve(script_name, tauri::path::BaseDirectory::Resource) {
         Ok(path) if path.exists() => {
              println!("Found script in Resource dir: {:?}", path);
              return Ok(path);
          }
         Ok(path) => {
             println!("Checked Resource dir, script not found at: {:?}", path);
             // Continue checking other locations
         }
         Err(e) => {
              eprintln!("Error resolving Resource directory path for {}: {}", script_name, e);
              // Continue checking other locations
         }
    }

     // 2. Check directory alongside the main executable (common for dev or simple builds)
     if let Ok(exe_path) = std::env::current_exe() {
          if let Some(exe_dir) = exe_path.parent() {
               let path = exe_dir.join(script_name);
               if path.exists() {
                    println!("Found script alongside executable: {:?}", path);
                    return Ok(path);
               } else {
                    println!("Checked alongside executable, script not found at: {:?}", path);
               }
          }
     } else {
          eprintln!("Could not determine executable path.");
     }

     // 3. Check relative to the Current Working Directory (less reliable, useful for dev)
     let cwd_path = PathBuf::from(script_name);
     if cwd_path.exists() {
          println!("Warning: Found script in Current Working Directory (CWD): {:?}", cwd_path);
          return Ok(cwd_path); // Use CWD path if found
     } else {
          println!("Checked CWD, script not found at: {:?}", cwd_path.canonicalize().unwrap_or_else(|_| cwd_path.clone()));
     }


     // If not found in any standard location, return an error
     Err(format!("Script '{}' not found. Checked Resource dir, alongside executable, and CWD.", script_name))
}


// --- Tauri Command Definition ---

/// Asynchronously executes the Python workspace snap agent.
#[tauri::command]
async fn trigger_workspace_snap(
    app_handle: tauri::AppHandle<Wry>, // Handle to the Tauri application instance
    config_path: String,             // Path to the workspace_layout.json
    project_path: Option<String>     // Optional path for ${PROJECT_PATH} substitution
) -> Result<(), String> { // Returns Ok(()) on success, Err(String) on failure

    // Find the Python executable
    let python_executable = find_python();
    println!("Using Python executable: {}", python_executable);

    // Resolve the path to the agent script
    let script_path = resolve_script_path(&app_handle, "workspace_snap_agent.py")?;
    println!("Using Workspace Snap script path: {:?}", script_path);


    // --- Build the command using Tokio's async Command ---
    let mut cmd = TokioCommand::new(&python_executable);
    cmd.arg(&script_path); // Pass the resolved script path
    cmd.arg("--config");
    cmd.arg(config_path); // Pass the config path received from JS

    // Add project path argument if provided
    if let Some(p_path) = project_path {
        cmd.arg("--project-path");
        cmd.arg(p_path);
    }

    // Configure standard output and standard error to be piped
    cmd.stdout(Stdio::piped());
    cmd.stderr(Stdio::piped());


    // --- Spawn the command asynchronously ---
    println!("Spawning Workspace Snap (async): {:?}", cmd);
    let command_str = format!("{:?}", cmd); // Store command string for logging clarity

    match cmd.spawn() {
        Ok(mut child) => {
            // Get the process ID (if available) for logging
            let pid = child.id().map(|id| id.to_string()).unwrap_or_else(|| "N/A".to_string());
            println!("Workspace Snap Agent spawned with PID: {}", pid);

            // Emit an event to the frontend indicating the process has started
            app_handle.emit("workspace-snap-started", format!("Agent PID: {}", pid)).unwrap_or_else(|e| {
                eprintln!("Failed to emit workspace-snap-started event: {}", e);
            });


            // --- Asynchronously handle stdout and stderr ---
            // Take ownership of the stdout/stderr handles
            let stdout = child.stdout.take().expect("Internal error: Failed to capture stdout from spawned process");
            let stderr = child.stderr.take().expect("Internal error: Failed to capture stderr from spawned process");

            // Create buffered readers for efficient async reading
            let stdout_reader = BufReader::new(stdout);
            let stderr_reader = BufReader::new(stderr);

            // Spawn a Tokio task to read stdout lines asynchronously
            let app_handle_stdout = app_handle.clone(); // Clone handle for the task
            tokio::spawn(async move {
                let mut lines = stdout_reader.lines();
                // Read lines one by one until EOF or error
                while let Ok(Some(line)) = lines.next_line().await {
                    println!("[Snap Agent STDOUT] {}", line);
                    // Optionally emit stdout lines to frontend for detailed logging in dev tools
                    // let _ = app_handle_stdout.emit("workspace-snap-stdout", line);
                }
            });

            // Spawn a Tokio task to read stderr lines asynchronously
            let app_handle_stderr = app_handle.clone(); // Clone handle for the task
            tokio::spawn(async move {
                let mut lines = stderr_reader.lines();
                // Read lines one by one until EOF or error
                while let Ok(Some(line)) = lines.next_line().await {
                    // Log stderr as errors in the Rust console
                    eprintln!("[Snap Agent STDERR] {}", line);
                    // Emit stderr lines to the frontend to display potential errors to the user
                    let _ = app_handle_stderr.emit("workspace-snap-stderr", line);
                }
            });


             // --- Spawn a Tokio task to wait for the process completion ---
            let app_handle_status = app_handle.clone(); // Clone handle for the task
            tokio::spawn(async move {
                match child.wait().await { // Asynchronously wait for the child process to exit
                    Ok(status) => {
                        println!("Workspace Snap Agent finished with status: {}", status);
                        // Emit success or error event based on exit status
                        if status.success() {
                             let _ = app_handle_status.emit("workspace-snap-success", format!("Agent exited successfully (Status: {})", status));
                        } else {
                             let error_msg = format!("Agent exited with non-zero status: {}", status);
                             eprintln!("{}", error_msg);
                             let _ = app_handle_status.emit("workspace-snap-error", error_msg);
                        }
                    }
                    Err(e) => {
                         // Error occurred while waiting for the process (e.g., couldn't get status)
                         let error_msg = format!("Failed to wait for Workspace Snap Agent process ({:?}): {}", command_str, e);
                         eprintln!("{}", error_msg);
                         let _ = app_handle_status.emit("workspace-snap-error", error_msg);
                    }
                }
            });

            // Return Ok immediately after spawning the process and setting up handlers
            // The frontend will receive events about the process status later.
            Ok(())
        }
        Err(e) => {
            // Error occurred during the .spawn() call itself
            let error_msg = format!("Failed to spawn Workspace Snap Agent command '{:?}': {}", command_str, e);
            eprintln!("{}", error_msg);
            // Return the error message to the calling JavaScript code
            Err(error_msg)
        }
    }
}


// --- Tauri Main Application Setup ---
fn main() {
    // Define system tray menu items
    let quit_item = CustomMenuItem::new("quit".to_string(), "Quit Projects Hub").accelerator("CmdOrCtrl+Q");
    let hide_item = CustomMenuItem::new("hide".to_string(), "Hide Window");
    let show_item = CustomMenuItem::new("show".to_string(), "Show Window");

    // Build the system tray menu
    let tray_menu = SystemTrayMenu::new()
        .add_item(show_item)
        .add_item(hide_item)
        .add_native_item(SystemTrayMenuItem::Separator) // Platform-native separator
        .add_item(quit_item);

    // Create the system tray instance
    let system_tray = SystemTray::new().with_menu(tray_menu);

    // Build the Tauri application
    tauri::Builder::default()
        // Add managed state if needed
        .manage(AppState {
            backend_url: Mutex::new("http://localhost:8000".to_string()), // Example state
        })
        // Add the system tray
        .system_tray(system_tray)
        // Define handler for system tray events
        .on_system_tray_event(|app_handle, event| match event {
            // Handle left click on tray icon (show/focus window)
            SystemTrayEvent::LeftClick { .. } => {
                 if let Some(window) = app_handle.get_window("main") {
                    let _ = window.show();
                    let _ = window.unminimize(); // Ensure not minimized
                    let _ = window.set_focus();
                 }
            }
            // Handle clicks on specific menu items
             SystemTrayEvent::MenuItemClick { id, .. } => {
                match id.as_str() {
                    "quit" => {
                        println!("Quit requested from tray menu.");
                        app_handle.exit(0); // Exit the entire application
                    }
                    "hide" => {
                         println!("Hide requested from tray menu.");
                         if let Some(window) = app_handle.get_window("main") {
                            window.hide().unwrap_or_else(|e| eprintln!("Error hiding window: {}", e));
                        }
                    }
                     "show" => {
                          println!("Show requested from tray menu.");
                         if let Some(window) = app_handle.get_window("main") {
                            window.show().unwrap_or_else(|e| eprintln!("Error showing window: {}", e));
                            window.unminimize().unwrap_or_else(|e| eprintln!("Error unminimizing window: {}", e));
                            window.set_focus().unwrap_or_else(|e| eprintln!("Error focusing window: {}", e));
                         }
                    }
                    _ => {} // Ignore other menu item IDs
                }
            }
            _ => {} // Ignore other tray events
        })
        // Define handler for window events
        .on_window_event(|event| match event.event() {
            // Override the default close behavior (hide instead of quit)
            tauri::WindowEvent::CloseRequested { api, .. } => {
                println!("Window close requested, hiding instead.");
                event.window().hide().unwrap_or_else(|e| {
                    eprintln!("Error hiding window on close request: {}", e);
                });
                api.prevent_close(); // Prevent the window from actually closing
            }
            // Optional: Log focus changes for debugging
            tauri::WindowEvent::Focused(focused) => {
                // println!("Window focus changed: {}", focused);
            }
            _ => {} // Ignore other window events
        })
        // Setup hook - runs once when the application is initializing
        .setup(|app| {
            // Ensure the main window is visible on initial startup
             if let Some(window) = app.get_window("main") {
                 println!("Showing main window on setup.");
                 let _ = window.show();
                 let _ = window.set_focus();
             } else {
                 eprintln!("Critical Error: Could not get main window handle during setup.");
             }

            // --- Optional: Register Global Shortcuts ---
            // Requires enabling the "global-shortcut" feature in tauri.conf.json allowlist
            /*
            #[cfg(feature = "global-shortcut")]
            {
                let handle = app.handle();
                let shortcut_manager = handle.global_shortcut_manager();

                // Register CmdOrCtrl+Shift+P to trigger command palette in frontend
                match shortcut_manager.register("CmdOrCtrl+Shift+P", move || {
                    println!("Global shortcut CmdOrCtrl+Shift+P triggered");
                    // Emit an event that the frontend can listen for to open kbar
                    if let Err(e) = handle.emit_all("trigger-command-palette", ()) {
                        eprintln!("Failed to emit trigger-command-palette event: {}", e);
                    }
                }) {
                    Ok(_) => println!("Global shortcut 'CmdOrCtrl+Shift+P' registered."),
                    Err(e) => eprintln!("Failed to register global shortcut 'CmdOrCtrl+Shift+P': {}", e),
                }

                 // Register other shortcuts as needed
            }
            */

            Ok(()) // Indicate successful setup
        })
        // Register backend functions callable from the frontend
        .invoke_handler(tauri::generate_handler![
            trigger_workspace_snap // Register the command
            // Add other commands here (e.g., toggle_focus_agent, get_settings, etc.)
        ])
        // Use build() + run() for applications utilizing the async runtime (like ours does for TokioCommand)
        .build(tauri::generate_context!())
        .expect("Error during Tauri application build")
        // Run the event loop
        .run(|_app_handle, event| match event {
             // Optional: Handle specific run events if needed
             tauri::RunEvent::ExitRequested { api, .. } => {
                  println!("Tauri RunEvent::ExitRequested received.");
                  // If you need to perform cleanup before exit, do it here.
                  // By default, the app will exit. Call api.prevent_exit() to stop it.
                  // api.prevent_exit();
             }
             tauri::RunEvent::Ready => {
                 println!("Tauri application is ready.");
             }
             _ => {} // Ignore other run events
        });
}