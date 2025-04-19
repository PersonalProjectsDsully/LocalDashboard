#!/usr/bin/env python3
"""
Workspace Snap Agent

This script arranges windows according to a workspace layout configuration.
It uses pywinauto, win32gui, and screeninfo to manage window positions and sizes.
"""

import json
import os
import sys
import time
import logging
import argparse
import requests
from typing import Dict, List, Optional, Tuple

try:
    import win32gui
    import win32con
    import win32process
    from screeninfo import get_monitors
    import pywinauto
except ImportError:
    print("Required packages not found. Please install with:")
    print("pip install pywinauto pywin32 screeninfo requests")
    sys.exit(1)

# Configure logging
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s - %(name)s - %(levelname)s - %(message)s",
    handlers=[
        logging.FileHandler("workspace_snap.log"),
        logging.StreamHandler()
    ]
)
logger = logging.getLogger("workspace_snap")

class WorkspaceSnapAgent:
    def __init__(self, config_path: str, api_url: str = "http://localhost:8000"):
        self.config_path = config_path
        self.api_url = api_url
        self.config = self._load_config()
        self.monitors = get_monitors()
        logger.info(f"Initialized WorkspaceSnapAgent with {len(self.monitors)} monitors")
        logger.info(f"Loaded workspace '{self.config['name']}'")

    def _load_config(self) -> Dict:
        """Load the workspace configuration from the specified path."""
        try:
            with open(self.config_path, "r") as f:
                config = json.load(f)
            return config
        except Exception as e:
            logger.error(f"Error loading config: {e}")
            sys.exit(1)

    def _get_window_handle(self, app_name: str) -> Optional[int]:
        """Find the window handle for the specified application."""
        def callback(hwnd, windows):
            if win32gui.IsWindowVisible(hwnd) and win32gui.GetWindowText(hwnd):
                windows.append((hwnd, win32gui.GetWindowText(hwnd)))
            return True

        windows = []
        win32gui.EnumWindows(callback, windows)
        
        for hwnd, title in windows:
            if app_name.lower() in title.lower():
                return hwnd
        return None

    def _position_window(self, hwnd: int, position: Dict) -> bool:
        """Position a window according to the specified coordinates and size."""
        try:
            monitor_idx = position.get("monitor", 0)
            if monitor_idx >= len(self.monitors):
                logger.warning(f"Monitor index {monitor_idx} out of range, using primary monitor")
                monitor_idx = 0
            
            monitor = self.monitors[monitor_idx]
            
            # Calculate absolute position based on monitor
            x = monitor.x + position.get("x", 0)
            y = monitor.y + position.get("y", 0)
            width = position.get("width", 800)
            height = position.get("height", 600)
            
            # Set window position and size
            win32gui.SetWindowPos(
                hwnd,
                win32con.HWND_TOP,
                x, y, width, height,
                win32con.SWP_SHOWWINDOW
            )
            
            # Bring window to front
            win32gui.SetForegroundWindow(hwnd)
            
            logger.info(f"Positioned window at ({x}, {y}) with size {width}x{height}")
            return True
        except Exception as e:
            logger.error(f"Error positioning window: {e}")
            return False

    def _launch_app(self, app_config: Dict) -> Optional[int]:
        """Launch an application with the specified parameters."""
        try:
            path = app_config["path"]
            args = app_config.get("args", [])
            
            # Replace variables in args
            processed_args = []
            for arg in args:
                if isinstance(arg, str):
                    # Replace variables like ${PROJECT_PATH}
                    if "${PROJECT_PATH}" in arg:
                        arg = arg.replace("${PROJECT_PATH}", os.environ.get("PROJECT_PATH", ""))
                processed_args.append(arg)
            
            # Launch the application
            cmd = f'"{path}" {" ".join(processed_args)}'
            logger.info(f"Launching: {cmd}")
            
            os.system(cmd)
            
            # Wait for the application to start
            time.sleep(2)
            
            # Find the window handle
            hwnd = self._get_window_handle(app_config["name"])
            if hwnd:
                logger.info(f"Found window handle for {app_config['name']}: {hwnd}")
                return hwnd
            else:
                logger.warning(f"Could not find window handle for {app_config['name']}")
                return None
        except Exception as e:
            logger.error(f"Error launching application: {e}")
            return None

    def _minimize_other_windows(self):
        """Minimize all windows not in the workspace configuration."""
        def callback(hwnd, app_names):
            if win32gui.IsWindowVisible(hwnd) and win32gui.GetWindowText(hwnd):
                title = win32gui.GetWindowText(hwnd)
                if not any(app_name.lower() in title.lower() for app_name in app_names):
                    win32gui.ShowWindow(hwnd, win32con.SW_MINIMIZE)
            return True

        app_names = [app["name"] for app in self.config["apps"]]
        win32gui.EnumWindows(callback, app_names)
        logger.info("Minimized other windows")

    def _log_activity(self, message: str):
        """Log activity to the backend API."""
        try:
            response = requests.post(
                f"{self.api_url}/log",
                json={
                    "type": "workspace",
                    "message": message,
                    "timestamp": time.strftime("%Y-%m-%dT%H:%M:%S%z")
                }
            )
            if response.status_code == 200:
                logger.info(f"Logged activity: {message}")
            else:
                logger.warning(f"Failed to log activity: {response.status_code}")
        except Exception as e:
            logger.error(f"Error logging activity: {e}")

    def arrange_workspace(self):
        """Arrange all windows according to the workspace configuration."""
        logger.info(f"Arranging workspace: {self.config['name']}")
        self._log_activity(f"Starting workspace arrangement: {self.config['name']}")
        
        # Launch and position each application
        for app_config in self.config["apps"]:
            hwnd = self._launch_app(app_config)
            if hwnd:
                success = self._position_window(hwnd, app_config["position"])
                if success:
                    self._log_activity(f"Positioned {app_config['name']}")
                else:
                    self._log_activity(f"Failed to position {app_config['name']}")
            else:
                self._log_activity(f"Failed to launch {app_config['name']}")
        
        # Minimize other windows if configured
        if self.config.get("minimize_others", False):
            self._minimize_other_windows()
            self._log_activity("Minimized other windows")
        
        self._log_activity(f"Completed workspace arrangement: {self.config['name']}")
        logger.info("Workspace arrangement completed")

def main():
    parser = argparse.ArgumentParser(description="Workspace Snap Agent")
    parser.add_argument("--config", "-c", default="workspace_layout.json", help="Path to workspace configuration file")
    parser.add_argument("--api", "-a", default="http://localhost:8000", help="Backend API URL")
    parser.add_argument("--project-path", "-p", help="Project path to use for variable substitution")
    
    args = parser.parse_args()
    
    # Set PROJECT_PATH environment variable if provided
    if args.project_path:
        os.environ["PROJECT_PATH"] = args.project_path
    
    agent = WorkspaceSnapAgent(args.config, args.api)
    agent.arrange_workspace()

if __name__ == "__main__":
    main()
