#!/usr/bin/env python3
"""
Focus Monitor Agent

This script tracks active windows, captures screenshots, and performs OCR to generate
focus activity logs and daily summaries.
"""

import os
import sys
import time
import json
import logging
import argparse
import datetime
import subprocess
from typing import Dict, List, Optional, Tuple
from pathlib import Path

try:
    import win32gui
    import win32process
    import win32api
    import mss
    import pytesseract
    from PIL import Image
except ImportError:
    print("Required packages not found. Please install with:")
    print("pip install pywin32 mss pytesseract pillow")
    print("Note: You also need to install Tesseract OCR and set the path to the executable.")
    sys.exit(1)

# Configure logging
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s - %(name)s - %(levelname)s - %(message)s",
    handlers=[
        logging.FileHandler("focus_monitor.log"),
        logging.StreamHandler()
    ]
)
logger = logging.getLogger("focus_monitor")

class FocusMonitorAgent:
    def __init__(self, output_dir: str, tesseract_path: Optional[str] = None, api_url: str = "http://localhost:8000"):
        self.output_dir = Path(output_dir)
        self.api_url = api_url
        self.active = True
        self.last_window_info = None
        self.last_screenshot_time = 0
        self.window_start_time = 0
        self.today = datetime.datetime.now().strftime("%Y-%m-%d")
        
        # Create output directories
        self.focus_logs_dir = self.output_dir / "focus_logs"
        self.focus_logs_dir.mkdir(parents=True, exist_ok=True)
        
        # Set Tesseract path if provided
        if tesseract_path:
            pytesseract.pytesseract.tesseract_cmd = tesseract_path
        
        logger.info(f"Initialized FocusMonitorAgent with output directory: {self.output_dir}")

    def _get_active_window_info(self) -> Dict:
        """Get information about the currently active window."""
        try:
            hwnd = win32gui.GetForegroundWindow()
            _, pid = win32process.GetWindowThreadProcessId(hwnd)
            
            try:
                # Get process executable path
                handle = win32api.OpenProcess(0x0400 | 0x0010, False, pid)
                exe = win32process.GetModuleFileNameEx(handle, 0)
            except Exception:
                exe = "Unknown"
            
            title = win32gui.GetWindowText(hwnd)
            
            return {
                "hwnd": hwnd,
                "pid": pid,
                "exe": exe,
                "title": title,
                "timestamp": datetime.datetime.now().isoformat()
            }
        except Exception as e:
            logger.error(f"Error getting active window info: {e}")
            return {
                "hwnd": 0,
                "pid": 0,
                "exe": "Error",
                "title": "Error",
                "timestamp": datetime.datetime.now().isoformat()
            }

    def _capture_screenshot(self) -> Optional[str]:
        """Capture a screenshot of the current screen."""
        try:
            timestamp = datetime.datetime.now().strftime("%Y%m%d_%H%M%S")
            filename = f"screenshot_{self.today}_{timestamp}.png"
            filepath = self.focus_logs_dir / filename
            
            with mss.mss() as sct:
                monitor = sct.monitors[1]  # Primary monitor
                sct_img = sct.grab(monitor)
                img = Image.frombytes("RGB", sct_img.size, sct_img.bgra, "raw", "BGRX")
                img.save(str(filepath))
            
            logger.info(f"Captured screenshot: {filename}")
            return filename
        except Exception as e:
            logger.error(f"Error capturing screenshot: {e}")
            return None

    def _perform_ocr(self, screenshot_path: str) -> str:
        """Perform OCR on the captured screenshot."""
        try:
            img = Image.open(self.focus_logs_dir / screenshot_path)
            
            # Resize image for faster OCR
            width, height = img.size
            new_width = 1200
            new_height = int(height * (new_width / width))
            img = img.resize((new_width, new_height))
            
            # Perform OCR
            text = pytesseract.image_to_string(img, lang='eng')
            
            # Truncate to first 256 characters
            text = text[:256]
            
            # Save OCR text to file
            ocr_path = self.focus_logs_dir / f"{screenshot_path.replace('.png', '.txt')}"
            with open(ocr_path, "w", encoding="utf-8") as f:
                f.write(text)
            
            logger.info(f"Performed OCR on {screenshot_path}")
            return text
        except Exception as e:
            logger.error(f"Error performing OCR: {e}")
            return ""

    def _log_window_activity(self, window_info: Dict, duration: int):
        """Log window activity to JSONL file."""
        try:
            log_file = self.focus_logs_dir / f"focus_log_{self.today}.jsonl"
            
            log_entry = {
                "timestamp": window_info["timestamp"],
                "exe": window_info["exe"],
                "title": window_info["title"],
                "duration": duration
            }
            
            with open(log_file, "a", encoding="utf-8") as f:
                f.write(json.dumps(log_entry) + "\n")
            
            logger.info(f"Logged window activity: {window_info['title']} ({duration}s)")
        except Exception as e:
            logger.error(f"Error logging window activity: {e}")

    def _extract_keywords(self, text: str) -> List[str]:
        """Extract keywords from OCR text."""
        # This is a simple implementation that could be improved with NLP
        if not text:
            return []
        
        # Split text into words
        words = text.lower().split()
        
        # Remove common words and short words
        stop_words = {"the", "a", "an", "and", "or", "but", "is", "are", "was", "were", "be", "been", "being", "in", "on", "at", "to", "for", "with", "by", "about", "against", "between", "into", "through", "during", "before", "after", "above", "below", "from", "up", "down", "of", "off", "over", "under", "again", "further", "then", "once", "here", "there", "when", "where", "why", "how", "all", "any", "both", "each", "few", "more", "most", "other", "some", "such", "no", "nor", "not", "only", "own", "same", "so", "than", "too", "very", "s", "t", "can", "will", "just", "don", "should", "now"}
        keywords = [word for word in words if word not in stop_words and len(word) > 3]
        
        # Return unique keywords
        return list(set(keywords))

    def _generate_daily_summary(self):
        """Generate a daily summary of focus activity."""
        try:
            log_file = self.focus_logs_dir / f"focus_log_{self.today}.jsonl"
            summary_file = self.focus_logs_dir / f"daily_summary_{self.today}.json"
            
            if not log_file.exists():
                logger.warning(f"No log file found for {self.today}")
                return
            
            # Read log entries
            log_entries = []
            with open(log_file, "r", encoding="utf-8") as f:
                for line in f:
                    log_entries.append(json.loads(line.strip()))
            
            # Calculate total time and app breakdown
            total_time = sum(entry["duration"] for entry in log_entries)
            app_breakdown = {}
            
            for entry in log_entries:
                exe = entry["exe"]
                if exe not in app_breakdown:
                    app_breakdown[exe] = {
                        "appName": os.path.basename(exe).split(".")[0] if "." in os.path.basename(exe) else os.path.basename(exe),
                        "exePath": exe,
                        "timeSpent": 0,
                        "percentage": 0,
                        "windowTitles": []
                    }
                
                app_breakdown[exe]["timeSpent"] += entry["duration"]
                if entry["title"] not in app_breakdown[exe]["windowTitles"]:
                    app_breakdown[exe]["windowTitles"].append(entry["title"])
            
            # Calculate percentages
            for app in app_breakdown.values():
                app["percentage"] = (app["timeSpent"] / total_time) * 100 if total_time > 0 else 0
            
            # Sort by time spent
            app_breakdown_list = sorted(
                app_breakdown.values(),
                key=lambda x: x["timeSpent"],
                reverse=True
            )
            
            # Get screenshots
            screenshots = [f for f in os.listdir(self.focus_logs_dir) if f.startswith(f"screenshot_{self.today}") and f.endswith(".png")]
            
            # Extract keywords from OCR files
            keywords = []
            for screenshot in screenshots:
                ocr_file = screenshot.replace(".png", ".txt")
                ocr_path = self.focus_logs_dir / ocr_file
                
                if ocr_path.exists():
                    with open(ocr_path, "r", encoding="utf-8") as f:
                        text = f.read()
                        keywords.extend(self._extract_keywords(text))
            
            # Get unique keywords
            unique_keywords = list(set(keywords))
            
            # Create summary
            summary = {
                "date": self.today,
                "totalTime": total_time,
                "appBreakdown": app_breakdown_list,
                "screenshots": screenshots,
                "keywords": unique_keywords,
                "focusScore": self._calculate_focus_score(app_breakdown_list, total_time),
                "distractionEvents": len(log_entries),
                "meetingTime": sum(entry["duration"] for entry in log_entries if "meeting" in entry["title"].lower() or "teams" in entry["exe"].lower() or "zoom" in entry["exe"].lower()),
                "productiveApps": [app["appName"] for app in app_breakdown_list if self._is_productive_app(app["exePath"])],
                "distractionApps": [app["appName"] for app in app_breakdown_list if self._is_distraction_app(app["exePath"])]
            }
            
            # Write summary to file
            with open(summary_file, "w", encoding="utf-8") as f:
                json.dump(summary, f, indent=2)
            
            logger.info(f"Generated daily summary for {self.today}")
        except Exception as e:
            logger.error(f"Error generating daily summary: {e}")

    def _calculate_focus_score(self, app_breakdown: List[Dict], total_time: int) -> int:
        """Calculate a focus score based on app usage."""
        if total_time == 0:
            return 0
        
        productive_time = sum(app["timeSpent"] for app in app_breakdown if self._is_productive_app(app["exePath"]))
        distraction_time = sum(app["timeSpent"] for app in app_breakdown if self._is_distraction_app(app["exePath"]))
        
        # Calculate score (0-100)
        score = int((productive_time / total_time) * 100)
        
        # Adjust for distractions
        if distraction_time > 0:
            distraction_penalty = int((distraction_time / total_time) * 20)
            score = max(0, score - distraction_penalty)
        
        return score

    def _is_productive_app(self, exe_path: str) -> bool:
        """Determine if an app is considered productive."""
        productive_keywords = ["code", "visual studio", "intellij", "pycharm", "word", "excel", "powerpoint", "outlook", "teams", "chrome", "edge", "firefox", "safari", "figma", "photoshop", "illustrator", "terminal", "cmd", "powershell"]
        return any(keyword in exe_path.lower() for keyword in productive_keywords)

    def _is_distraction_app(self, exe_path: str) -> bool:
        """Determine if an app is considered a distraction."""
        distraction_keywords = ["game", "steam", "epic", "netflix", "hulu", "spotify", "discord", "slack", "facebook", "twitter", "instagram", "reddit", "youtube"]
        return any(keyword in exe_path.lower() for keyword in distraction_keywords)

    def toggle_active(self):
        """Toggle the active state of the monitor."""
        self.active = not self.active
        logger.info(f"Focus Monitor {'activated' if self.active else 'deactivated'}")

    def run(self, interval: int = 5, screenshot_interval: int = 60):
        """Run the focus monitor loop."""
        logger.info(f"Starting Focus Monitor with interval {interval}s and screenshot interval {screenshot_interval}s")
        
        self.window_start_time = time.time()
        
        try:
            while True:
                if not self.active:
                    time.sleep(interval)
                    continue
                
                # Check if day has changed
                current_day = datetime.datetime.now().strftime("%Y-%m-%d")
                if current_day != self.today:
                    # Generate summary for previous day
                    self._generate_daily_summary()
                    # Update today
                    self.today = current_day
                
                # Get active window info
                current_window_info = self._get_active_window_info()
                
                # Check if window has changed
                if self.last_window_info and (current_window_info["hwnd"] != self.last_window_info["hwnd"] or
                                             current_window_info["title"] != self.last_window_info["title"]):
                    # Log previous window activity
                    duration = int(time.time() - self.window_start_time)
                    if duration >= interval:  # Only log if duration is significant
                        self._log_window_activity(self.last_window_info, duration)
                    
                    # Reset timer
                    self.window_start_time = time.time()
                
                # Check if it's time to take a screenshot
                current_time = time.time()
                if current_time - self.last_screenshot_time >= screenshot_interval:
                    screenshot_path = self._capture_screenshot()
                    if screenshot_path:
                        self._perform_ocr(screenshot_path)
                    self.last_screenshot_time = current_time
                
                # Update last window info
                self.last_window_info = current_window_info
                
                # Sleep for the specified interval
                time.sleep(interval)
        except KeyboardInterrupt:
            logger.info("Focus Monitor stopped by user")
            # Log the last window activity
            if self.last_window_info:
                duration = int(time.time() - self.window_start_time)
                if duration >= interval:
                    self._log_window_activity(self.last_window_info, duration)
            # Generate daily summary
            self._generate_daily_summary()
        except Exception as e:
            logger.error(f"Error in Focus Monitor: {e}")
            # Try to log the last window activity
            if self.last_window_info:
                duration = int(time.time() - self.window_start_time)
                if duration >= interval:
                    self._log_window_activity(self.last_window_info, duration)
            # Try to generate daily summary
            self._generate_daily_summary()

def main():
    parser = argparse.ArgumentParser(description="Focus Monitor Agent")
    parser.add_argument("--output-dir", "-o", default="ProjectsHub", help="Output directory for focus logs")
    parser.add_argument("--tesseract-path", "-t", help="Path to Tesseract OCR executable")
    parser.add_argument("--api-url", "-a", default="http://localhost:8000", help="Backend API URL")
    parser.add_argument("--interval", "-i", type=int, default=5, help="Sampling interval in seconds")
    parser.add_argument("--screenshot-interval", "-s", type=int, default=60, help="Screenshot interval in seconds")
    
    args = parser.parse_args()
    
    agent = FocusMonitorAgent(args.output_dir, args.tesseract_path, args.api_url)
    agent.run(args.interval, args.screenshot_interval)

if __name__ == "__main__":
    main()
