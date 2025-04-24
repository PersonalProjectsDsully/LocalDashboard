#!/usr/bin/env python3
"""
Workspace Snap Agent

This script arranges application windows according to a workspace layout configuration.
It uses win32gui and screeninfo to manage window positions and sizes.
Sends logs to the backend API.
"""

import json
import os
import sys
import time
import logging
import argparse
import requests
from typing import Dict, List, Optional, Tuple
import datetime # Added
import subprocess # To launch apps

try:
    import win32gui
    import win32con
    import win32process
    import win32api # For fallback monitor info
    from screeninfo import get_monitors
except ImportError:
    print("Required packages not found. Please install with:")
    print("pip install pywin32 screeninfo requests")
    sys.exit(1)

# Configure logging
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
    handlers=[
        logging.FileHandler("workspace_snap.log"), # Consider rotating file handler
        logging.StreamHandler()
    ]
)
logger = logging.getLogger("workspace_snap")

class WorkspaceSnapAgent:
    def __init__(self, config_path: str, api_url: Optional[str] = "http://localhost:8000"):
        self.config_path = config_path
        self.api_url = api_url
        self.config = self._load_config()
        self.monitors = self._get_monitors_safe()
        self.managed_hwnds = set() # Keep track of windows we manage in this run

        if not self.monitors:
             logger.error("Could not detect any monitors. Exiting.")
             sys.exit(1)

        logger.info(f"Initialized WorkspaceSnapAgent with {len(self.monitors)} monitors")
        if self.config:
            logger.info(f"Loaded workspace '{self.config.get('name', 'Unnamed')}' from {config_path}")
        else:
             logger.error("Workspace config is empty or invalid. Exiting.")
             sys.exit(1)

    def _get_monitors_safe(self):
         """Safely get monitors, handle potential screeninfo errors."""
         try:
             monitors = get_monitors()
             if not monitors: raise Exception("screeninfo returned empty list")
             # Sort monitors by left coordinate, then top, to make index predictable
             monitors.sort(key=lambda m: (m.x, m.y))
             logger.debug(f"Detected monitors: {[(i, m) for i, m in enumerate(monitors)]}")
             return monitors
         except Exception as e:
              logger.error(f"Error getting monitor info via screeninfo: {e}")
              try:
                  # Fallback using EnumDisplayMonitors might be more reliable
                  monitors_fallback = []
                  for hmonitor, _, _ in win32api.EnumDisplayMonitors():
                      info = win32api.GetMonitorInfo(hmonitor)
                      # Create a mock monitor object matching screeninfo structure
                      class MockMonitor:
                          x = info['Monitor'][0]
                          y = info['Monitor'][1]
                          width = info['Monitor'][2] - info['Monitor'][0]
                          height = info['Monitor'][3] - info['Monitor'][1]
                          is_primary = info.get('Flags') == win32con.MONITORINFOF_PRIMARY
                          name = None # Not easily available here
                          def __repr__(self): return f"MockMonitor(x={self.x}, y={self.y}, width={self.width}, height={self.height}, primary={self.is_primary})"

                      monitors_fallback.append(MockMonitor())

                  if monitors_fallback:
                       logger.warning(f"Falling back to EnumDisplayMonitors. Detected {len(monitors_fallback)} monitors.")
                       monitors_fallback.sort(key=lambda m: (m.x, m.y))
                       logger.debug(f"Fallback monitors: {[(i, m) for i, m in enumerate(monitors_fallback)]}")
                       return monitors_fallback
                  else:
                       raise Exception("EnumDisplayMonitors also failed.")

              except Exception as e2:
                   logger.error(f"Fallback monitor detection failed: {e2}")
                   return []


    def _load_config(self) -> Optional[Dict]:
        """Load and validate the workspace configuration."""
        if not os.path.exists(self.config_path):
            logger.error(f"Config file not found: {self.config_path}")
            return None
        try:
            with open(self.config_path, "r", encoding='utf-8') as f:
                config = json.load(f)

            # --- Validation ---
            if not isinstance(config, dict):
                logger.error("Invalid config format: Root must be a dictionary.")
                return None
            if "apps" not in config or not isinstance(config["apps"], list):
                 logger.error("Invalid config format: Missing or invalid 'apps' list.")
                 return None

            for i, app in enumerate(config["apps"]):
                if not isinstance(app, dict) or "name" not in app or "path" not in app:
                    logger.error(f"Invalid app entry at index {i}: Missing 'name' or 'path'. {app}")
                    return None
                if "position" in app and not isinstance(app["position"], dict):
                     logger.error(f"Invalid app entry for '{app['name']}': 'position' must be a dictionary.")
                     return None
                if "args" in app and not isinstance(app["args"], list):
                     logger.error(f"Invalid app entry for '{app['name']}': 'args' must be a list.")
                     return None

            return config
        except json.JSONDecodeError as e:
            logger.error(f"Error decoding JSON config {self.config_path}: {e}")
            return None
        except Exception as e:
            logger.error(f"Error loading config {self.config_path}: {e}")
            return None

    def _find_window_handles(self, app_name_part: str, exe_path: Optional[str] = None, class_name: Optional[str] = None) -> List[int]:
        """Find window handles loosely matching the app name part or class name."""
        hwnds = []
        target_pid = None # PID matching is complex, skipping for now

        def callback(hwnd, windows_list):
            # Check if window is visible, has a title, and is not a tool window (optional)
            if win32gui.IsWindowVisible(hwnd) and win32gui.GetWindowTextLength(hwnd) > 0:
                 # ex_style = win32gui.GetWindowLong(hwnd, win32con.GWL_EXSTYLE)
                 # if not (ex_style & win32con.WS_EX_TOOLWINDOW): # Skip tool windows
                    match = False
                    window_title = win32gui.GetWindowText(hwnd)
                    if app_name_part and app_name_part.lower() in window_title.lower():
                        match = True

                    if not match and class_name:
                         try:
                            current_class = win32gui.GetClassName(hwnd)
                            if class_name.lower() == current_class.lower():
                                match = True
                         except Exception: pass # GetClassName can fail

                    if match:
                        windows_list.append(hwnd)
            return True

        win32gui.EnumWindows(callback, hwnds)
        logger.debug(f"Found {len(hwnds)} potential windows for '{app_name_part or class_name}': {hwnds}")
        return hwnds


    def _position_window(self, hwnd: int, position: Dict, app_name: str) -> bool:
        """Position a window according to the specified coordinates and size."""
        if not hwnd or not win32gui.IsWindow(hwnd):
             logger.warning(f"[{app_name}] Invalid or closed window handle provided: {hwnd}")
             return False
        try:
            monitor_idx = position.get("monitor", 0)
            if not isinstance(monitor_idx, int) or monitor_idx < 0 or monitor_idx >= len(self.monitors):
                logger.warning(f"[{app_name}] Invalid monitor index {monitor_idx}, using primary monitor (index 0)")
                monitor_idx = 0

            monitor = self.monitors[monitor_idx]

            # Calculate absolute position relative to virtual screen
            mon_x, mon_y = monitor.x, monitor.y
            mon_w, mon_h = monitor.width, monitor.height

            # Allow percentage-based positioning/sizing relative to monitor
            x_val = position.get("x", 0)
            y_val = position.get("y", 0)
            w_val = position.get("width", "80%") # Default to 80% width
            h_val = position.get("height", "80%") # Default to 80% height

            x = mon_x + (int(x_val[:-1]) * mon_w // 100 if isinstance(x_val, str) and x_val.endswith('%') else int(x_val))
            y = mon_y + (int(y_val[:-1]) * mon_h // 100 if isinstance(y_val, str) and y_val.endswith('%') else int(y_val))
            width = int(w_val[:-1]) * mon_w // 100 if isinstance(w_val, str) and w_val.endswith('%') else int(w_val)
            height = int(h_val[:-1]) * mon_h // 100 if isinstance(h_val, str) and h_val.endswith('%') else int(h_val)

            # Basic sanity check on dimensions
            width = max(100, width)
            height = max(100, height)


            # --- Prepare window ---
            # Restore if minimized/maximized
            placement = win32gui.GetWindowPlacement(hwnd)
            if placement[1] == win32con.SW_SHOWMINIMIZED or placement[1] == win32con.SW_SHOWMAXIMIZED:
                 win32gui.ShowWindow(hwnd, win32con.SW_RESTORE)
                 time.sleep(0.2) # More delay after restore


            # --- Set Position ---
            # MoveWindow might be more reliable than SetWindowPos for simple moves/resizes
            win32gui.MoveWindow(hwnd, x, y, width, height, True) # True = repaint
            time.sleep(0.1) # Pause after move


            # --- Bring to Front (best effort) ---
            try:
                # Different methods, sometimes one works better than others
                win32gui.SetWindowPos(hwnd, win32con.HWND_TOPMOST, 0, 0, 0, 0, win32con.SWP_NOMOVE | win32con.SWP_NOSIZE)
                time.sleep(0.05)
                win32gui.SetWindowPos(hwnd, win32con.HWND_NOTOPMOST, 0, 0, 0, 0, win32con.SWP_NOMOVE | win32con.SWP_NOSIZE)
                time.sleep(0.05)
                win32gui.SetForegroundWindow(hwnd)
            except Exception as e:
                 logger.warning(f"[{app_name}] Could not bring window {hwnd} reliably to foreground: {e}")


            logger.info(f"Positioned '{app_name}' ({hwnd}) to M{monitor_idx} @ ({x},{y}) {width}x{height}")
            self.managed_hwnds.add(hwnd) # Mark as managed
            return True
        except Exception as e:
            logger.error(f"Error positioning window for '{app_name}' ({hwnd}): {e}", exc_info=True)
            return False

    def _launch_app(self, app_config: Dict) -> Optional[int]:
        """Launch an application if not already running, return main window handle."""
        app_name = app_config.get("name")
        path = app_config.get("path")
        class_name = app_config.get("class_name") # Optional class name for finding window

        if not app_name and not class_name:
            logger.warning(f"Skipping app due to missing 'name' or 'class_name': {app_config}")
            return None
        if not path and not class_name: # Need path if launching, can find by class if already running
             logger.warning(f"Skipping app '{app_name}' due to missing 'path' (required for launching).")
             return None

        search_term = app_name or class_name # Prefer name for logging

        # 1. Check if already running and find handle
        existing_hwnds = self._find_window_handles(app_name, path, class_name)
        if existing_hwnds:
             main_hwnd = existing_hwnds[0] # Assume first is best candidate
             logger.info(f"App '{search_term}' seems to be running. Using existing window ({main_hwnd}).")
             try: # Restore and bring to front
                 win32gui.ShowWindow(main_hwnd, win32con.SW_RESTORE)
                 time.sleep(0.1)
                 win32gui.SetForegroundWindow(main_hwnd)
             except Exception: pass # Best effort
             return main_hwnd

        # 2. If not running, try to launch it (requires path)
        if not path:
             logger.warning(f"App '{search_term}' not found running, and no 'path' provided to launch.")
             return None

        try:
            full_path = os.path.abspath(path)
            if not os.path.exists(full_path):
                 logger.error(f"Application path does not exist: {full_path}")
                 self._log_activity(f"Error: Path not found for {app_name} ({full_path})")
                 return None

            args = app_config.get("args", [])
            processed_args = []
            for arg in args:
                if isinstance(arg, str):
                    project_path_env = os.environ.get("PROJECT_PATH", "")
                    if "${PROJECT_PATH}" in arg:
                        if project_path_env:
                            arg = arg.replace("${PROJECT_PATH}", project_path_env)
                        else:
                            logger.warning(f"[{app_name}] PROJECT_PATH variable used but not set in environment for arg: {arg}")
                            # Keep placeholder or remove arg? Keeping placeholder.
                processed_args.append(str(arg))

            logger.info(f"Launching '{app_name}': \"{full_path}\" {' '.join(processed_args)}")
            self._log_activity(f"Launching {app_name}...")

            # Use subprocess.Popen for better control
            cmd_list = [full_path] + processed_args
            # Run detached in a new console/session if possible
            process = subprocess.Popen(cmd_list, creationflags=subprocess.CREATE_NEW_CONSOLE, close_fds=True)
            logger.debug(f"Launched '{app_name}' with PID: {process.pid}")


            # Wait for the application window to appear
            wait_time = app_config.get("launch_wait", 3) # Configurable wait time
            max_wait = time.time() + wait_time
            hwnd = None
            while time.time() < max_wait:
                time.sleep(0.5) # Check every 500ms
                new_hwnds = self._find_window_handles(app_name, path, class_name)
                if new_hwnds:
                    hwnd = new_hwnds[0] # Found it
                    logger.info(f"Launched '{app_name}' successfully. Found window handle: {hwnd}")
                    break
            else: # Loop finished without break
                logger.warning(f"Launched '{app_name}' but could not find its window handle within {wait_time}s.")
                self._log_activity(f"Warning: Launched {app_name} but couldn't find window.")
                return None

            return hwnd

        except FileNotFoundError:
             logger.error(f"Error launching '{app_name}': Executable not found at '{full_path}'")
             self._log_activity(f"Error: Executable not found for {app_name}")
             return None
        except Exception as e:
            logger.error(f"Error launching application '{app_name}': {e}", exc_info=True)
            self._log_activity(f"Error launching {app_name}: {e}")
            return None

    def _minimize_other_windows(self):
        """Minimize all visible, non-managed windows."""
        minimized_count = 0
        try:
            def callback(hwnd, managed_hwnds):
                nonlocal minimized_count
                # Basic checks: Visible, Has title, Not managed by us, Not Desktop/Shell
                if hwnd not in managed_hwnds and win32gui.IsWindowVisible(hwnd) and win32gui.GetWindowTextLength(hwnd) > 0:
                    # Additional checks to avoid minimizing important things
                    try:
                        style = win32gui.GetWindowLong(hwnd, win32con.GWL_STYLE)
                        ex_style = win32gui.GetWindowLong(hwnd, win32con.GWL_EXSTYLE)
                        class_name = win32gui.GetClassName(hwnd)
                        title = win32gui.GetWindowText(hwnd)

                        # Skip Taskbar, Desktop, Start Menu, Tool windows, windows without captions/borders?
                        if class_name in ["Shell_TrayWnd", "Progman", "WorkerW"] or (ex_style & win32con.WS_EX_TOOLWINDOW):
                            return True
                        # if not (style & win32con.WS_CAPTION): # Skip windows without captions? Might hide too much.
                        #    return True

                        # Check if it's already minimized
                        if not win32gui.IsIconic(hwnd):
                             logger.debug(f"Minimizing: '{title}' ({hwnd}, Class: {class_name})")
                             win32gui.ShowWindow(hwnd, win32con.SW_MINIMIZE)
                             minimized_count += 1
                             time.sleep(0.05) # Small delay between minimizing actions
                    except Exception as e_inner:
                         logger.warning(f"Could not get info or minimize window {hwnd}: {e_inner}")
                return True

            logger.info(f"Minimizing windows NOT in managed set: {self.managed_hwnds}")
            win32gui.EnumWindows(callback, self.managed_hwnds)

        except Exception as e:
            logger.error(f"Error during EnumWindows for minimizing: {e}")

        finally:
            logger.info(f"Minimized {minimized_count} other window(s).")
            if minimized_count > 0:
                self._log_activity(f"Minimized {minimized_count} other window(s)")


    def _log_activity(self, message: str):
        """Log activity to the backend API, if configured."""
        if not self.api_url:
            logger.info(f"[Log Skipped - No API URL] {message}")
            return
        try:
            payload = {
                "type": "workspace", # Source agent
                "message": message,
                "timestamp": datetime.datetime.now(datetime.timezone.utc).isoformat() # Use UTC ISO format
            }
            response = requests.post(f"{self.api_url}/log", json=payload, timeout=5)
            response.raise_for_status() # Raise HTTPError for bad responses (4xx or 5xx)
            logger.info(f"Logged activity via API: {message}")
        except requests.exceptions.Timeout:
             logger.error(f"API Error logging activity: Timeout contacting {self.api_url}. Message: '{message}'")
        except requests.exceptions.ConnectionError:
             logger.error(f"API Error logging activity: Connection refused or failed for {self.api_url}. Message: '{message}'")
        except requests.exceptions.RequestException as e:
            logger.error(f"API Error logging activity: {e}. Message: '{message}'")
        except Exception as e:
             logger.error(f"Unexpected error during API logging: {e}")


    def arrange_workspace(self):
        """Main function to arrange windows according to the loaded config."""
        if not self.config:
             logger.error("Cannot arrange workspace, config is invalid or missing.")
             return

        workspace_name = self.config.get('name', 'Unnamed Workspace')
        logger.info(f"Arranging workspace: {workspace_name}")
        self._log_activity(f"Starting workspace: {workspace_name}")
        start_time = time.time()
        self.managed_hwnds.clear() # Reset managed windows for this run
        all_successful = True

        # 1. Launch and position all configured apps
        for app_config in self.config.get("apps", []):
            hwnd = self._launch_app(app_config)
            if hwnd:
                time.sleep(0.2) # Small pause before positioning might help
                pos_success = self._position_window(hwnd, app_config.get("position", {}), app_config.get('name', 'Unknown'))
                if not pos_success:
                    self._log_activity(f"Failed to position '{app_config.get('name', 'Unknown App')}'")
                    all_successful = False
            else:
                # _launch_app logs the error/warning
                all_successful = False
                time.sleep(0.1) # Pause even if launch failed

        # 2. Minimize other windows if configured
        if self.config.get("minimize_others", False):
            self._minimize_other_windows()

        # 3. Optional: Bring managed windows back to top in specified order? (Complex)

        end_time = time.time()
        duration = end_time - start_time
        status_msg = "completed successfully" if all_successful else "completed with errors"
        self._log_activity(f"Workspace '{workspace_name}' arrangement {status_msg} in {duration:.2f}s")
        logger.info(f"Workspace '{workspace_name}' arrangement {status_msg} in {duration:.2f} seconds")

def main():
    parser = argparse.ArgumentParser(
        description="Workspace Snap Agent: Arranges application windows based on a JSON layout.",
        formatter_class=argparse.ArgumentDefaultsHelpFormatter
    )
    parser.add_argument(
        "--config", "-c",
        required=True, # Make config path required
        help="Path to the workspace layout JSON configuration file."
    )
    parser.add_argument(
        "--api", "-a",
        default="http://localhost:8000",
        help="Backend API URL for logging."
    )
    parser.add_argument(
        "--project-path", "-p",
        help="Project path to substitute for ${PROJECT_PATH} in app arguments."
    )
    parser.add_argument(
         "--no-api-log",
         action="store_true",
         help="Disable sending logs to the backend API."
    )

    args = parser.parse_args()

    # Set PROJECT_PATH environment variable if provided
    if args.project_path:
        abs_project_path = os.path.abspath(args.project_path)
        if os.path.isdir(abs_project_path):
             os.environ["PROJECT_PATH"] = abs_project_path
             logger.info(f"Set PROJECT_PATH environment variable to: {abs_project_path}")
        else:
             logger.warning(f"Provided --project-path is not a valid directory: {args.project_path}")
             # Exit? Or proceed without substitution? Proceeding for now.

    api_url = None if args.no_api_log else args.api
    if api_url:
        logger.info(f"Logging to API enabled: {api_url}")
    else:
        logger.info("API logging is disabled via --no-api-log.")

    config_file_path = os.path.abspath(args.config)

    agent = WorkspaceSnapAgent(config_path=config_file_path, api_url=api_url)
    agent.arrange_workspace()

if __name__ == "__main__":
    main()