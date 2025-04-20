#!/usr/bin/env python3
"""
Focus Monitor Agent (Window Title Tracking Version)

This script tracks the title and executable of the currently focused window
to generate focus activity logs and daily summaries. Does NOT take screenshots.
Periodically checks backend for desired active state.
"""

import os
import sys
import time
import json
import logging
import argparse
import datetime
from typing import Dict, List, Optional, Set
from pathlib import Path
import asyncio
import requests

try:
    import win32gui
    import win32process
    import win32api
    import win32con # For constants if needed later
except ImportError:
    print("Required packages not found. Please install with:")
    print("pip install pywin32 requests") # Removed mss, pytesseract, pillow
    sys.exit(1)

# Configure logging
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
    handlers=[
        logging.FileHandler("focus_monitor.log", encoding='utf-8'),
        logging.StreamHandler()
    ]
)
logger = logging.getLogger("focus_monitor")

# --- Configuration (Copied for backend calculation consistency) ---
PRODUCTIVE_EXES = {"code.exe", "pycharm", "idea", "webstorm", "goland", "clion",
                   "word", "excel", "powerpnt", "outlook",
                   "chrome.exe", "firefox.exe", "msedge.exe", "safari",
                   "cmd.exe", "powershell.exe", "terminal", "wt.exe",
                   "explorer.exe", "photoshop", "illustrator", "figma", "xd",
                   "blender", "unity", "docker", "virtualbox", "vmware",
                   "gitkraken", "postman", "obsidian"}
DISTRACTION_EXES = {"steam.exe", "epicgameslauncher", "origin.exe", "gog galaxy",
                     "spotify.exe", "discord.exe", "slack.exe",
                     "netflix", "hulu", "disneyplus",
                     "whatsapp", "telegram", "signal"}
DISTRACTION_TITLE_KEYWORDS = {"youtube", "facebook", "twitter", "reddit", "netflix",
                              "hulu", "twitch", "instagram", "9gag", "game", "play",
                              "tiktok", "pinterest"}
MEETING_EXES = {"teams.exe", "zoom.exe", "webex", "skype.exe", "slack.exe"}
MEETING_TITLE_KEYWORDS = {"meet", "meeting", "call", "webinar", "huddle",
                           "zoom meeting", "microsoft teams meeting", "google meet"}

class FocusMonitorAgent:
    def __init__(self, output_dir: str, api_url: Optional[str] = None):
        self.output_dir = Path(output_dir)
        self.api_url = api_url
        self.active = True # Internal current state
        self.desired_active_state = True # State requested by backend
        self.last_window_info: Optional[Dict] = None
        self.window_start_time: float = time.time()
        self.today: str = self._get_current_utc_date()

        self.focus_logs_dir = self.output_dir / "focus_logs"
        self.focus_logs_dir.mkdir(parents=True, exist_ok=True)

        logger.info(f"Initialized FocusMonitorAgent (Window Tracking). Output: {self.focus_logs_dir}, API: {self.api_url or 'Disabled'}")

    def _get_current_utc_date(self) -> str:
         return datetime.datetime.now(datetime.timezone.utc).strftime("%Y-%m-%d")

    async def check_backend_status(self):
        """Periodically check the desired active state from the backend."""
        while True:
            if not self.api_url:
                self.desired_active_state = True # Default to active if no API
                await asyncio.sleep(60)
                continue
            try:
                response = requests.get(f"{self.api_url}/focus/status", timeout=3)
                response.raise_for_status()
                new_desired_state = response.json().get("active", True)
                if self.desired_active_state != new_desired_state:
                     logger.info(f"Backend desired state changed to: {new_desired_state}")
                     self.desired_active_state = new_desired_state
            except requests.exceptions.RequestException as e:
                logger.warning(f"Could not reach backend ({self.api_url}) to check focus status: {e}")
            except Exception as e:
                 logger.error(f"Error checking backend status: {e}")
            await asyncio.sleep(15) # Check every 15 seconds

    def toggle_active(self):
        """Toggle the internal active state if it differs from desired state."""
        if self.active == self.desired_active_state: return

        new_state = self.desired_active_state
        logger.info(f"Focus Monitor internal state changing to: {new_state}")

        if not new_state: # Pausing
             if self.last_window_info:
                 duration = int(time.time() - self.window_start_time)
                 if duration > 0: self._log_window_activity(self.last_window_info, duration)
             self.last_window_info = None
             self.window_start_time = time.time()
        else: # Resuming
             self.window_start_time = time.time() # Reset start time

        self.active = new_state

    def _get_focused_window_details(self) -> Optional[Dict]:
        """Get details (hwnd, pid, exe, title, timestamp) for the currently focused window."""
        try:
            hwnd = win32gui.GetForegroundWindow()
            if not hwnd: return None

            title = win32gui.GetWindowText(hwnd)
            tid, pid = win32process.GetWindowThreadProcessId(hwnd)

            if not title or pid == 0 or title in ["Program Manager", "Windows Default Lock Screen", "Windows Input Experience"]:
                 return None # Filter out uninteresting windows

            exe = "Unknown"
            try:
                # PROCESS_QUERY_LIMITED_INFORMATION is safer if available
                handle = win32api.OpenProcess(win32con.PROCESS_QUERY_LIMITED_INFORMATION | win32con.PROCESS_VM_READ, False, pid)
                if handle:
                    try: exe = win32process.GetModuleFileNameEx(handle, 0)
                    finally: win32api.CloseHandle(handle)
            except Exception: pass # Ignore permission errors

            return {
                "hwnd": hwnd, "pid": pid, "exe": exe, "title": title,
                "timestamp": datetime.datetime.now(datetime.timezone.utc).isoformat()
            }
        except Exception as e:
            if "pywintypes.error" in str(type(e)) and e.args[0] in [0, 1400]: # Handle window closing during check
                 logger.debug(f"Window likely closed during info retrieval: {e}")
                 return None
            logger.error(f"Error getting focused window details: {e}", exc_info=False)
            return None

    def _log_window_activity(self, window_info: Dict, duration: int):
        """Log focused window activity to JSONL file."""
        if duration <= 0: return
        try:
            log_file = self.focus_logs_dir / f"focus_log_{self.today}.jsonl"
            log_entry = {
                "timestamp": window_info["timestamp"], "exe": window_info["exe"],
                "title": window_info["title"], "duration": duration
            }
            with open(log_file, "a", encoding="utf-8") as f:
                f.write(json.dumps(log_entry) + "\n")
            app_name = os.path.basename(log_entry['exe']) if log_entry['exe'] != "Unknown" else "Unknown"
            title_snip = log_entry['title'][:60].replace('\n', ' ') + ('...' if len(log_entry['title']) > 60 else '')
            logger.info(f"Logged: {app_name} - '{title_snip}' ({duration}s)")
        except Exception as e:
            logger.error(f"Error writing to log file {log_file}: {e}")

    def _generate_daily_summary(self):
        """Generate a daily summary (without screenshots/keywords) when agent stops."""
        # This function remains largely the same calculation-wise,
        # but we *only* call it on clean shutdown/day change for the *previous* day.
        # The backend handles on-demand calculation for the *current* day.
        current_summary_day = self.today
        logger.info(f"Generating final daily summary file for {current_summary_day}...")
        summary_file = self.focus_logs_dir / f"daily_summary_{current_summary_day}.json"
        log_file = self.focus_logs_dir / f"focus_log_{current_summary_day}.jsonl"

        if not log_file.exists():
            logger.warning(f"No focus log file found for {current_summary_day}. Cannot generate final summary file.")
            return # Do not create an empty file

        summary = { # Structure without screenshots/keywords
            "date": current_summary_day, "totalTime": 0, "appBreakdown": [],
            "focusScore": 0, "distractionEvents": 0, "meetingTime": 0,
            "productiveApps": [], "distractionApps": []
        }
        try:
            log_entries = []
            total_time = 0
            app_time: Dict[str, float] = {}
            app_titles: Dict[str, Set[str]] = {}
            # --- Process Log File ---
            with open(log_file, "r", encoding="utf-8") as f:
                for line_num, line in enumerate(f, 1):
                    try:
                        entry = json.loads(line.strip())
                        if not isinstance(entry, dict) or not all(k in entry for k in ["exe", "title", "duration", "timestamp"]): continue
                        duration = entry.get("duration", 0)
                        if duration <= 0: continue
                        log_entries.append(entry)
                        total_time += duration
                        exe = entry["exe"] or "Unknown"; title = entry["title"] or ""
                        app_time[exe] = app_time.get(exe, 0) + duration
                        if exe not in app_titles: app_titles[exe] = set()
                        if len(app_titles[exe]) < 50: app_titles[exe].add(title)
                    except Exception as e: logger.error(f"Err processing line {line_num}: {e}")

            summary["totalTime"] = round(total_time)
            summary["distractionEvents"] = len(log_entries)

            # App breakdown
            app_breakdown_list = []
            for exe, time_spent in app_time.items():
                 app_name = os.path.basename(exe).replace('.exe', '') if exe != "Unknown" else "Unknown"
                 percentage = (time_spent / total_time * 100) if total_time > 0 else 0
                 app_breakdown_list.append({
                     "appName": app_name, "exePath": exe, "timeSpent": round(time_spent),
                     "percentage": round(percentage, 2), "windowTitles": sorted(list(app_titles.get(exe, set())))
                 })
            app_breakdown_list.sort(key=lambda x: x["timeSpent"], reverse=True)
            summary["appBreakdown"] = app_breakdown_list

            # Metrics
            title_list_map = {app['exePath']: app['windowTitles'] for app in app_breakdown_list}
            summary["meetingTime"] = round(sum(e["duration"] for e in log_entries if self._is_meeting_app(e["exe"], e["title"])))
            productive_apps_set = {app["appName"] for app in app_breakdown_list if self._is_productive_app(app["exePath"], title_list_map.get(app["exePath"], []))}
            distraction_apps_set = {app["appName"] for app in app_breakdown_list if self._is_distraction_app(app["exePath"], title_list_map.get(app["exePath"], []))}
            summary["productiveApps"] = sorted(list(productive_apps_set))
            summary["distractionApps"] = sorted(list(distraction_apps_set))
            summary["focusScore"] = self._calculate_focus_score(summary["productiveApps"], summary["distractionApps"], summary["appBreakdown"], summary["totalTime"])

            # Write final summary file
            with open(summary_file, "w", encoding="utf-8") as f:
                json.dump(summary, f, indent=2)
            logger.info(f"Generated final daily summary file for {current_summary_day}.")

        except Exception as e:
            logger.error(f"Error generating final daily summary file for {current_summary_day}: {e}", exc_info=True)

    # --- Keep calculation helpers needed by _generate_daily_summary ---
    def _calculate_focus_score(self, productive_apps: List[str], distraction_apps: List[str], app_breakdown: List[Dict], total_time: int) -> int:
        if total_time <= 0: return 0
        productive_time = sum(app["timeSpent"] for app in app_breakdown if app["appName"] in productive_apps)
        distraction_time = sum(app["timeSpent"] for app in app_breakdown if app["appName"] in distraction_apps)
        neutral_time = max(0, total_time - productive_time - distraction_time)
        weighted_score = (productive_time * 1.0) + (neutral_time * 0.5) - (distraction_time * 1.0)
        normalized_score = weighted_score / total_time if total_time > 0 else 0
        final_score = max(0, min(100, int((normalized_score + 1) / 2 * 100)))
        return final_score
    def _is_productive_app(self, exe_path: str, titles: List[str]) -> bool:
        exe_lower = exe_path.lower(); title_concat_lower = " ".join(titles).lower()
        if any(pe in exe_lower for pe in PRODUCTIVE_EXES):
             if not any(dk in title_concat_lower for dk in DISTRACTION_TITLE_KEYWORDS): return True
        return False
    def _is_distraction_app(self, exe_path: str, titles: List[str]) -> bool:
        exe_lower = exe_path.lower(); title_concat_lower = " ".join(titles).lower()
        if any(de in exe_lower for de in DISTRACTION_EXES): return True
        if any(pe in exe_lower for pe in PRODUCTIVE_EXES) and any(dk in title_concat_lower for dk in DISTRACTION_TITLE_KEYWORDS): return True
        return False
    def _is_meeting_app(self, exe_path: str, title: str) -> bool:
         exe_lower = exe_path.lower(); title_lower = title.lower()
         if any(me in exe_lower for me in MEETING_EXES): return True
         if any(mk in title_lower for mk in MEETING_TITLE_KEYWORDS): return True
         return False

    # --- Main Agent Loop (Simplified) ---
    async def run_agent_loop(self, interval: int = 5):
        """The main agent loop (async) - tracks focused window."""
        logger.info(f"Starting Focus Monitor agent loop (Window Tracking). Interval: {interval}s")
        self.window_start_time = time.time()

        while True:
            main_loop_start_time = time.time()
            try:
                # Check desired state from backend and toggle internal state if needed
                self.toggle_active()

                # Day Change Check (using UTC)
                current_day_utc = self._get_current_utc_date()
                if current_day_utc != self.today:
                    logger.info(f"Date changed from {self.today} to {current_day_utc}. Generating previous day summary.")
                    self._generate_daily_summary() # Generate final summary for previous day
                    self.today = current_day_utc
                    logger.info(f"Updated current tracking date to {self.today}")

                # Skip processing if not active
                if not self.active:
                    await asyncio.sleep(max(0.1, interval - (time.time() - main_loop_start_time)))
                    continue

                # Get current focused window details
                current_window_info = self._get_focused_window_details()

                # Determine if the focused window changed significantly
                is_idle = current_window_info is None
                window_changed = False
                if is_idle:
                     if self.last_window_info is not None: window_changed = True # Active -> Idle
                elif self.last_window_info is None: window_changed = True # Idle -> Active
                elif (current_window_info["hwnd"] != self.last_window_info["hwnd"] or
                      current_window_info["title"] != self.last_window_info["title"] or
                      current_window_info["exe"] != self.last_window_info["exe"]): window_changed = True # Active -> Different Active

                if window_changed:
                    # Log duration for the *previous* window/state
                    if self.last_window_info:
                        duration = int(time.time() - self.window_start_time)
                        if duration > 0: self._log_window_activity(self.last_window_info, duration)

                    # Reset timer and update last window info (becomes None if now idle)
                    self.window_start_time = time.time()
                    self.last_window_info = current_window_info

                # --- NO Screenshot/OCR Logic Here ---

                # Sleep until next interval
                elapsed = time.time() - main_loop_start_time
                sleep_duration = max(0.1, interval - elapsed)
                await asyncio.sleep(sleep_duration)

            except KeyboardInterrupt:
                logger.info("KeyboardInterrupt received in agent loop.")
                break
            except Exception as e:
                 logger.error(f"Unhandled error in agent loop: {e}", exc_info=True)
                 await asyncio.sleep(interval * 2) # Wait longer after error

        # --- Cleanup on exit ---
        logger.info("Agent loop finished. Performing final cleanup...")
        if self.last_window_info: # Log final activity
            duration = int(time.time() - self.window_start_time)
            if duration > 0: self._log_window_activity(self.last_window_info, duration)
        self._generate_daily_summary() # Generate final summary for the last active day
        logger.info("Focus Monitor agent stopped.")


async def main_async():
    parser = argparse.ArgumentParser(description="Focus Monitor Agent (Window Tracking)")
    parser.add_argument("--output-dir", "-o", required=True, help="Base directory where ProjectsHub data resides")
    parser.add_argument("--api-url", "-a", default="http://localhost:8000", help="Backend API URL for status checks")
    parser.add_argument("--interval", "-i", type=int, default=5, help="Sampling interval in seconds")
    # Removed screenshot/tesseract args
    parser.add_argument("--no-api-check", action="store_true", help="Disable checking backend API for status.")
    args = parser.parse_args()

    output_dir_path = Path(args.output_dir)
    if not output_dir_path.is_dir():
        logger.critical(f"Output directory not found: {args.output_dir}"); sys.exit(1)

    api_url = None if args.no_api_check else args.api_url

    agent = FocusMonitorAgent(str(output_dir_path.resolve()), api_url)

    tasks = [asyncio.create_task(agent.run_agent_loop(args.interval))]
    if api_url:
        tasks.append(asyncio.create_task(agent.check_backend_status()))

    try:
        await tasks[0] # Wait for main loop
    except asyncio.CancelledError: logger.info("Agent loop task cancelled.")
    finally: # Cleanup background tasks
        for task in tasks[1:]:
            if not task.done(): task.cancel()
        await asyncio.gather(*tasks[1:], return_exceptions=True)
        logger.info("All background tasks finished.")


if __name__ == "__main__":
     try: asyncio.run(main_async())
     except KeyboardInterrupt: logger.info("Focus Monitor stopped by user (main).")
     except Exception as main_err: logger.critical(f"Focus Monitor exited: {main_err}", exc_info=True)
     