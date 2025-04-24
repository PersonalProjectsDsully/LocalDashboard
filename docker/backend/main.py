from fastapi import FastAPI, WebSocket, WebSocketDisconnect, HTTPException, Query, Path as FastAPIPath, Depends
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from pydantic import BaseModel
import os
import json
import yaml
import asyncio
from typing import List, Dict, Any, Optional, Set
from datetime import datetime, timezone, timedelta
import logging
from pathlib import Path as FilePath
import time
from watchdog.observers import Observer
from watchdog.events import FileSystemEventHandler, FileModifiedEvent, FileCreatedEvent, FileDeletedEvent, FileMovedEvent
import requests
from contextlib import suppress
from concurrent.futures import Future
import re

from update_alarm_legacy import update_alarm_legacy

# Import the Ollama client
from ollama_client import OllamaClient

# Import task models and service
from task_models import (
    TaskCreate, TaskUpdate, TaskInDB, TaskStatusUpdate,
    TaskAssigneeUpdate, TaskStatistics, TaskTemplate, TaskFromTemplate
)
from tasks_service import TasksService

# Import LLM Task Controller
from llm_task_controller import LLMTaskController
from llm_json_extractor import extract_json_from_llm_response

# --- Logging Setup ---
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
    handlers=[
        logging.FileHandler("/hub_data/backend.log", encoding='utf-8'),
        logging.StreamHandler()
    ]
)
logger = logging.getLogger(__name__)

# --- FastAPI App and CORS ---
app = FastAPI(
    title="Projects Hub Backend",
    description="Backend API for Projects Hub - A local-first desktop workspace",
    version="1.0.0-alpha",
)
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# --- Constants and Global State ---
HUB_DATA_PATH = FilePath("/hub_data").resolve()
FOCUS_TIMER_PATH = FilePath(r"C:\Users\admin\Desktop\FocusTimer\focus_logs").resolve()
focus_monitor_active = True
main_event_loop: Optional[asyncio.AbstractEventLoop] = None

# Initialize services
ollama_client = OllamaClient(base_url="http://host.docker.internal:11434")
tasks_service = TasksService(HUB_DATA_PATH)
llm_task_controller = LLMTaskController(tasks_service)

# Service dependencies
def get_tasks_service() -> TasksService:
    return tasks_service

# --- WebSocket Connection Manager ---
class ConnectionManager:
    def __init__(self):
        self.active_connections: List[WebSocket] = []
        self.connections_lock = asyncio.Lock()

    async def connect(self, websocket: WebSocket):
        await websocket.accept()
        async with self.connections_lock: self.active_connections.append(websocket)
        logger.info(f"New WebSocket connection from {websocket.client.host}:{websocket.client.port}. Total: {len(self.active_connections)}")

    async def disconnect(self, websocket: WebSocket):
        async with self.connections_lock:
            if websocket in self.active_connections: self.active_connections.remove(websocket)
        logger.info(f"WebSocket disconnected from {websocket.client.host}:{websocket.client.port}. Remaining: {len(self.active_connections)}")

    async def broadcast(self, message: Dict[str, Any]):
        async with self.connections_lock: connections_to_send = list(self.active_connections)
        
        if not connections_to_send:
            logger.warning(f"Cannot broadcast message of type '{message.get('type')}': No active connections")
            return
            
        logger.info(f"Broadcasting message of type '{message.get('type')}' to {len(connections_to_send)} clients")
        
        # Convert message to JSON just once for better performance
        message_json = json.dumps(message)
        
        results = await asyncio.gather(*[self._send_message(connection, message_json) for connection in connections_to_send], return_exceptions=True)
        
        # Log successful deliveries and handle disconnected sockets
        success_count = sum(1 for r in results if not isinstance(r, Exception))
        logger.info(f"Message broadcast successful to {success_count}/{len(connections_to_send)} clients")
        
        disconnected_sockets = [connections_to_send[i] for i, result in enumerate(results) if isinstance(result, Exception)]
        if disconnected_sockets:
            logger.warning(f"Detected {len(disconnected_sockets)} disconnected websockets during broadcast")
            async with self.connections_lock:
                for socket in disconnected_sockets:
                    if socket in self.active_connections: 
                        self.active_connections.remove(socket)
                        logger.info(f"Removed disconnected socket from active connections. Remaining: {len(self.active_connections)}")

    async def _send_message(self, websocket: WebSocket, message_json: str):
        try: 
            await websocket.send_text(message_json)
            return True
        except Exception as e: 
            logger.error(f"Error sending message to websocket: {str(e)}")
            raise e

manager = ConnectionManager()

# --- File System Watcher ---
class HubChangeHandler(FileSystemEventHandler):
    def __init__(self, ws_manager: ConnectionManager, loop: asyncio.AbstractEventLoop):
        super().__init__()
        self.ws_manager = ws_manager
        self.loop = loop
        self.debounce_cache: Dict[str, float] = {}
        self.debounce_interval: float = 1.0

    def _should_process(self, path_str: str) -> bool:
        try:
            path_obj = FilePath(path_str).resolve()
            if not path_obj.is_relative_to(HUB_DATA_PATH): return False
            ignored_dirs = {".git", ".vscode", ".idea", "__pycache__", "node_modules"}
            ignored_files = {".DS_Store", "backend.log"}
            if any(part in ignored_dirs for part in path_obj.parts) or path_obj.name in ignored_files: return False
            now = time.monotonic()
            last_event = self.debounce_cache.get(path_str)
            if last_event and (now - last_event) < self.debounce_interval: return False
            self.debounce_cache[path_str] = now
            return True
        except Exception: return False

    async def broadcast_change(self, event_type: str, src_path: str):
        try: 
            relative_path = str(FilePath(src_path).relative_to(HUB_DATA_PATH)).replace("\\", "/")
        except ValueError: 
            return
            
        logger.info(f"File Watcher: Processing '{event_type}' for '{relative_path}'")
        message: Optional[Dict[str, Any]] = None
        path_parts = FilePath(relative_path).parts
        
        # Determine message type
        if relative_path == "countdowns.yaml": 
            message = {"type": "alarms_updated"}
        elif relative_path == "00-meta.yaml": 
            message = {"type": "meta_updated"}
        elif relative_path == "workspace_layout.json": 
            message = {"type": "workspace_layout_updated"}
        elif len(path_parts) > 0 and path_parts[0] == "focus_logs":
            if path_parts[-1].startswith("daily_summary_"):
                date_str = path_parts[-1].replace("daily_summary_", "").replace(".json", "")
                message = {"type": "focus_summary_updated", "date": date_str}
            else: 
                return
        elif len(path_parts) > 1:
            project_id = path_parts[0]
            if project_id.startswith(('.', '_')) or '/' in project_id or '\\' in project_id: 
                return
                
            filename = path_parts[-1]
            if filename == "tasks.yaml": 
                message = {"type": "tasks_updated", "project_id": project_id, "path": relative_path}
            elif filename == "project.yaml": 
                message = {"type": "project_updated", "project_id": project_id, "path": relative_path}
            elif len(path_parts) > 2 and path_parts[1] == "docs" and filename.endswith(".md"):
                message = {"type": "document_updated", "project_id": project_id, "path": relative_path, "event": event_type}
            elif len(path_parts) > 2 and path_parts[1] == "assets":
                message = {"type": "asset_updated", "project_id": project_id, "path": relative_path, "event": event_type}
                
        if message: 
            await self.ws_manager.broadcast(message)

    def schedule_broadcast(self, event_type: str, src_path: str):
        if not self.loop.is_running(): 
            return
            
        if not self._should_process(src_path): 
            return
            
        coro = self.broadcast_change(event_type, src_path)
        asyncio.run_coroutine_threadsafe(coro, self.loop)

    def on_modified(self, event: FileModifiedEvent):
        if not event.is_directory: 
            self.schedule_broadcast("modified", event.src_path)
            
    def on_created(self, event: FileCreatedEvent):
        if not event.is_directory: 
            self.schedule_broadcast("created", event.src_path)
            
    def on_deleted(self, event: FileDeletedEvent):
        if not event.is_directory: 
            self.schedule_broadcast("deleted", event.src_path)

# --- Data Models ---
class Project(BaseModel): 
    title: str
    status: str
    tags: List[str] = []
    due: Optional[str] = None
    description: Optional[str] = None
    team: Optional[List[Dict[str, str]]] = None
    
class Task(BaseModel): 
    id: str
    title: str
    description: Optional[str] = None
    status: str
    priority: Optional[str] = None
    due: Optional[str] = None
    assigned_to: Optional[str] = None
    
class Alarm(BaseModel): 
    id: str
    title: str
    days: int
    hours: Optional[int] = 0
    minutes: Optional[int] = 0
    seconds: Optional[int] = 0
    time: Optional[str] = None
    thresholds: Dict[str, int]
    recurrence: Optional[str] = None  # 'once', 'daily', 'weekly', 'monthly'
    startDate: Optional[str] = None
    startTime: Optional[str] = None
    endDate: Optional[str] = None
    endTime: Optional[str] = None
    daysOfWeek: Optional[List[int]] = None  # 0-6 (Sunday to Saturday)
    status: Optional[str] = None  # 'active', 'paused', 'completed'
    lastUpdated: Optional[str] = None
    targetDate: Optional[str] = None  # ISO date string for target date/time
    
class TaskUpdate(BaseModel): 
    id: str
    status: str
    
class DocumentUpdate(BaseModel): 
    content: str
    
class LogEntry(BaseModel): 
    type: str
    message: str
    timestamp: str

# --- Test Form Model ---
class TestForm(BaseModel):
    title: str
    content: str

# --- Chat Models and Sessions ---
class ChatMessage(BaseModel):
    id: str
    role: str
    content: str
    timestamp: str
    model: Optional[str] = None

class ChatSession(BaseModel):
    id: str
    title: str
    lastMessage: str
    lastUpdated: str
    messages: List[ChatMessage] = []

class ChatModel(BaseModel):
    id: str
    name: str
    provider: str
    description: Optional[str] = None
    parameters: Optional[Dict[str, Any]] = None

class ChatRequest(BaseModel):
    message: str
    model_id: str
    session_id: str
    context_data: Optional[Dict[str, Any]] = None
    
    model_config = {
        'protected_namespaces': ()
    }

class LLMTaskRequest(BaseModel):
    command: str
    model_id: str = "llama3"
    system_prompt: Optional[str] = None

# --- Helper Functions ---
def read_yaml_file(file_path: FilePath) -> Any:
    if not file_path.exists(): 
        return None
        
    try:
        with open(file_path, "r", encoding="utf-8") as f: 
            return yaml.safe_load(f)
    except yaml.YAMLError as e: 
        raise HTTPException(500, f"Invalid YAML: {e}")
    except Exception as e: 
        raise HTTPException(500, f"Read error: {e}")
        
def read_json_file(file_path: FilePath) -> Any:
    if not file_path.exists(): 
        return None
        
    try:
        with open(file_path, "r", encoding="utf-8") as f: 
            return json.load(f)
    except json.JSONDecodeError as e: 
        raise HTTPException(500, f"Invalid JSON: {e}")
    except Exception as e: 
        raise HTTPException(500, f"Read error: {e}")
        
def read_text_file(file_path: FilePath) -> str:
    if not file_path.exists(): 
        raise HTTPException(404, f"Not found: {file_path.name}")
        
    if not file_path.is_file(): 
        raise HTTPException(400, f"Not a file: {file_path.name}")
        
    try:
        with open(file_path, "r", encoding="utf-8", errors='ignore') as f: 
            return f.read()
    except Exception as e: 
        raise HTTPException(500, f"Read error: {e}")
        
def write_yaml_file(file_path: FilePath, data: Any):
    try:
        file_path.parent.mkdir(parents=True, exist_ok=True)
        with open(file_path, "w", encoding="utf-8") as f: 
            yaml.dump(data, f, allow_unicode=True, default_flow_style=False, sort_keys=False, indent=2)
        logger.info(f"Wrote YAML: {file_path}")
    except Exception as e: 
        raise HTTPException(500, f"Write error: {e}")
        
def write_text_file(file_path: FilePath, content: str):
    try:
        file_path.parent.mkdir(parents=True, exist_ok=True)
        with open(file_path, "w", encoding="utf-8") as f: 
            f.write(content)
        logger.info(f"Wrote text: {file_path}")
    except Exception as e: 
        raise HTTPException(500, f"Write error: {e}")
        
def _is_safe_path(relative_path: str) -> bool:
    if not relative_path: 
        return False
        
    if ".." in relative_path.split(os.path.sep): 
        return False
        
    try:
        full_path = HUB_DATA_PATH.joinpath(relative_path).resolve()
        return full_path.is_relative_to(HUB_DATA_PATH)
    except Exception: 
        return False

# --- Focus Monitor Logic ---
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
                           
STOP_WORDS = {"the", "and", "for", "with", "this", "that", "http", "https", "com", "www",
              "org", "net", "gov", "edu", "from", "not", "are", "was", "were", "has", "had",
              "but", "you", "your", "all", "its", "use", "can", "will", "new", "set", "get",
              "app", "exe", "error", "warning", "info", "debug", "trace", "file", "line",
              "src", "img", "div", "span", "class", "http", "https", "could", "would",
              "should", "which", "what", "when", "where", "who", "rem", "px", "em", "css",
              "html", "javascript", "python"}

def _is_productive_app_be(exe_path: str, titles: List[str]) -> bool:
    """Backend version: Determine if an app/window seems productive."""
    exe_lower = exe_path.lower()
    title_concat_lower = " ".join(titles).lower()
    if any(pe in exe_lower for pe in PRODUCTIVE_EXES):
         if not any(dk in title_concat_lower for dk in DISTRACTION_TITLE_KEYWORDS):
             return True
    return False

def _is_distraction_app_be(exe_path: str, titles: List[str]) -> bool:
    """Backend version: Determine if an app/window seems like a distraction."""
    exe_lower = exe_path.lower()
    title_concat_lower = " ".join(titles).lower()
    if any(de in exe_lower for de in DISTRACTION_EXES): 
        return True
    if any(pe in exe_lower for pe in PRODUCTIVE_EXES) and any(dk in title_concat_lower for dk in DISTRACTION_TITLE_KEYWORDS): 
        return True
    return False

def _is_meeting_app_be(exe_path: str, title: str) -> bool:
     """Backend version: Determine if an app/window looks like a meeting."""
     exe_lower = exe_path.lower()
     title_lower = title.lower()
     if any(me in exe_lower for me in MEETING_EXES): 
        return True
     if any(mk in title_lower for mk in MEETING_TITLE_KEYWORDS): 
        return True
     return False

def _extract_keywords_be(text: str) -> List[str]:
    """Backend version: Extract simple keywords from OCR text."""
    if not text: 
        return []
        
    try:
        words = re.findall(r'\b[a-zA-Z_][a-zA-Z0-9_]{3,}\b', text.lower())
        keywords = {word for word in words if word not in STOP_WORDS}
        return sorted(list(keywords))
    except Exception as e:
        logger.warning(f"Backend keyword extraction failed: {e}")
        return []

def _calculate_focus_score_be(productive_apps: List[str], distraction_apps: List[str], app_breakdown: List[Dict], total_time: int) -> int:
    """Backend version: Calculate a focus score based on app categories."""
    if total_time <= 0: 
        return 0
        
    productive_time = sum(app["timeSpent"] for app in app_breakdown if app["appName"] in productive_apps)
    distraction_time = sum(app["timeSpent"] for app in app_breakdown if app["appName"] in distraction_apps)
    neutral_time = max(0, total_time - productive_time - distraction_time)
    
    weighted_score = (productive_time * 1.0) + (neutral_time * 0.5) - (distraction_time * 1.0)
    normalized_score = weighted_score / total_time if total_time > 0 else 0
    final_score = max(0, min(100, int((normalized_score + 1) / 2 * 100)))
    
    return final_score

def calculate_summary_from_log(log_file_path: FilePath, date_str: str) -> Dict[str, Any]:
    """Reads a .jsonl log file and calculates the daily summary."""
    logger.info(f"Calculating on-demand summary for {date_str} from {log_file_path}")
    summary = {
        "date": date_str, 
        "totalTime": 0, 
        "appBreakdown": [], 
        "screenshots": [],
        "keywords": [], 
        "focusScore": 0, 
        "distractionEvents": 0, 
        "meetingTime": 0,
        "productiveApps": [], 
        "distractionApps": []
    }
    
    if not log_file_path.exists():
        logger.warning(f"Log file not found for on-demand summary: {log_file_path}")
        return summary

    log_entries = []
    total_time = 0
    app_time: Dict[str, float] = {}
    app_titles: Dict[str, Set[str]] = {}

    try:
        with open(log_file_path, "r", encoding="utf-8") as f:
            for line_num, line in enumerate(f, 1):
                try:
                    entry = json.loads(line.strip())
                    if not isinstance(entry, dict) or not all(k in entry for k in ["exe", "title", "duration", "timestamp"]): 
                        continue
                        
                    duration = entry.get("duration", 0)
                    if duration <= 0: 
                        continue

                    log_entries.append(entry)
                    total_time += duration
                    exe = entry["exe"] or "Unknown"
                    title = entry["title"] or ""
                    app_time[exe] = app_time.get(exe, 0) + duration
                    
                    if exe not in app_titles: 
                        app_titles[exe] = set()
                        
                    if len(app_titles[exe]) < 50: 
                        app_titles[exe].add(title)
                        
                except json.JSONDecodeError: 
                    logger.warning(f"Skipping invalid JSON line {line_num} in {log_file_path.name}")
                except Exception as e: 
                    logger.error(f"Error processing log line {line_num} in {log_file_path.name}: {e}")

        summary["totalTime"] = round(total_time)
        summary["distractionEvents"] = len(log_entries)

        # App breakdown
        app_breakdown_list = []
        for exe, time_spent in app_time.items():
             app_name = os.path.basename(exe).replace('.exe', '') if exe != "Unknown" else "Unknown"
             percentage = (time_spent / total_time * 100) if total_time > 0 else 0
             app_breakdown_list.append({
                 "appName": app_name, 
                 "exePath": exe, 
                 "timeSpent": round(time_spent),
                 "percentage": round(percentage, 2), 
                 "windowTitles": sorted(list(app_titles.get(exe, set())))
             })
        app_breakdown_list.sort(key=lambda x: x["timeSpent"], reverse=True)
        summary["appBreakdown"] = app_breakdown_list

        # Look for screenshots in the focus logs directory
        focus_logs_dir = log_file_path.parent
        screenshots = [f.name for f in focus_logs_dir.glob(f"screenshot_{date_str}_*.png")]
        summary["screenshots"] = screenshots

        # Keywords (find associated TXTs for the date)
        all_keywords = set()
        
        for ocr_file in focus_logs_dir.glob(f"screenshot_{date_str}_*.txt"):
            try:
                with open(ocr_file, "r", encoding="utf-8") as f: 
                    text = f.read()
                all_keywords.update(_extract_keywords_be(text))
            except Exception as e: 
                logger.warning(f"Could not read OCR file {ocr_file.name}: {e}")
                
        summary["keywords"] = sorted(list(all_keywords))

        # Metrics
        title_list_map = {app['exePath']: app['windowTitles'] for app in app_breakdown_list}
        summary["meetingTime"] = round(sum(e["duration"] for e in log_entries if _is_meeting_app_be(e["exe"], e["title"])))
        productive_apps_set = {app["appName"] for app in app_breakdown_list if _is_productive_app_be(app["exePath"], title_list_map.get(app["exePath"], []))}
        distraction_apps_set = {app["appName"] for app in app_breakdown_list if _is_distraction_app_be(app["exePath"], title_list_map.get(app["exePath"], []))}
        summary["productiveApps"] = sorted(list(productive_apps_set))
        summary["distractionApps"] = sorted(list(distraction_apps_set))
        summary["focusScore"] = _calculate_focus_score_be(summary["productiveApps"], summary["distractionApps"], summary["appBreakdown"], summary["totalTime"])

        logger.info(f"Successfully calculated on-demand summary for {date_str}")
        return summary

    except Exception as e:
         logger.error(f"Failed to calculate on-demand summary for {date_str}: {e}", exc_info=True)
         summary["error"] = f"Failed to calculate summary: {e}"
         return summary

# --- Alarms API ---
@app.get("/alarms")
async def get_alarms():
    """Get all alarms from the countdowns.yaml file."""
    try:
        alarms_file = HUB_DATA_PATH / "countdowns.yaml"
        if not alarms_file.exists():
            return {"alarms": []}
        
        alarms_data = read_yaml_file(alarms_file)
        if not alarms_data or "alarms" not in alarms_data:
            return {"alarms": []}
        
        return alarms_data
    except Exception as e:
        logger.error(f"Error getting alarms: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"Error getting alarms: {e}")

@app.post("/alarms/update-countdowns")
async def update_alarm_countdowns():
    """Update countdown timers for all alarms based on recurrence rules."""
    try:
        alarms_file = HUB_DATA_PATH / "countdowns.yaml"
        if not alarms_file.exists():
            return {"status": "success", "message": "No alarms file found"}
        
        alarms_data = read_yaml_file(alarms_file)
        if not alarms_data or "alarms" not in alarms_data:
            return {"status": "success", "message": "No alarms found"}
        
        alarms = alarms_data["alarms"]
        updated = False
        now = datetime.now(timezone.utc)
        
        for i, alarm in enumerate(alarms):
            # Skip if alarm is paused or completed
            if alarm.get("status") == "paused" or alarm.get("status") == "completed":
                continue
            
            # Update lastUpdated timestamp
            alarm["lastUpdated"] = now.isoformat()
            
            # If targetDate is present, use that for countdown calculation
            if alarm.get("targetDate"):
                try:
                    target_date = datetime.fromisoformat(alarm["targetDate"].replace('Z', '+00:00'))
                    time_diff = target_date - now
                    
                    # Calculate days, hours, minutes, seconds
                    total_seconds = max(0, time_diff.total_seconds())
                    days = int(total_seconds // 86400)
                    hours = int((total_seconds % 86400) // 3600)
                    minutes = int((total_seconds % 3600) // 60)
                    seconds = int(total_seconds % 60)
                    
                    # Update alarm with new values
                    alarm["days"] = days
                    alarm["hours"] = hours
                    alarm["minutes"] = minutes
                    alarm["seconds"] = seconds
                    updated = True
                    
                    # Check if countdown reached zero
                    if total_seconds <= 0:
                        # For one-time alarms, mark as completed
                        if not alarm.get("recurrence") or alarm.get("recurrence") == "once":
                            alarm["status"] = "completed"
                            alarm["days"] = 0
                            alarm["hours"] = 0
                            alarm["minutes"] = 0
                            alarm["seconds"] = 0
                        # For recurring alarms, reset based on recurrence type
                        else:
                            recurrence = alarm.get("recurrence")
                            new_target = datetime.now(timezone.utc)
                            
                            if recurrence == "daily":
                                new_target = new_target + timedelta(days=1)
                            elif recurrence == "weekly":
                                new_target = new_target + timedelta(days=7)
                            elif recurrence == "monthly":
                                # Add approximately 30 days for a month
                                new_target = new_target + timedelta(days=30)
                                
                            # Update target date and time values
                            alarm["targetDate"] = new_target.isoformat()
                            alarm["days"] = 1 if recurrence == "daily" else 7 if recurrence == "weekly" else 30
                            alarm["hours"] = 0
                            alarm["minutes"] = 0
                            alarm["seconds"] = 0
                            
                except (ValueError, TypeError) as e:
                    logger.warning(f"Error parsing targetDate for alarm {alarm.get('id')}: {e}")
                    # Fall back to legacy behavior
                    update_alarm_legacy(alarm)
                    updated = True
            else:
                # Legacy behavior for alarms without targetDate
                update_alarm_legacy(alarm)
                updated = True
        
        # If any alarm was updated, write changes and broadcast
        if updated:
            write_yaml_file(alarms_file, alarms_data)
            await manager.broadcast({"type": "alarms_updated"})
        
        return {"status": "success", "message": "Alarms updated", "updated_count": len(alarms)}
    except Exception as e:
        logger.error(f"Error updating alarm countdowns: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"Error updating alarm countdowns: {e}")

@app.post("/alarms")
async def create_alarm(alarm: Alarm):
    """Create a new alarm."""
    try:
        alarms_file = HUB_DATA_PATH / "countdowns.yaml"
        alarms_data = {"alarms": []}
        
        if alarms_file.exists():
            existing_data = read_yaml_file(alarms_file)
            if existing_data and "alarms" in existing_data:
                alarms_data = existing_data
        
        # Generate a unique ID if not provided
        if not alarm.id:
            alarm.id = f"alarm-{int(time.time())}"
        
        # Add the new alarm
        alarm_dict = alarm.dict(exclude_unset=True)
        
        # Ensure hours, minutes, seconds fields are present
        if "hours" not in alarm_dict:
            alarm_dict["hours"] = 0
        if "minutes" not in alarm_dict:
            alarm_dict["minutes"] = 0
        if "seconds" not in alarm_dict:
            alarm_dict["seconds"] = 0
            
        # Always calculate and store targetDate for precise countdown
        if not alarm_dict.get("targetDate"):
            now = datetime.now(timezone.utc)
            target = now + timedelta(
                days=alarm_dict.get("days", 0),
                hours=alarm_dict.get("hours", 0),
                minutes=alarm_dict.get("minutes", 0),
                seconds=alarm_dict.get("seconds", 0)
            )
            alarm_dict["targetDate"] = target.isoformat()
            
        alarms_data["alarms"].append(alarm_dict)
        
        # Write back to file
        write_yaml_file(alarms_file, alarms_data)
        
        return alarm_dict
    except Exception as e:
        logger.error(f"Error creating alarm: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"Error creating alarm: {e}")

@app.put("/alarms/{alarm_id}")
async def update_alarm(alarm_id: str, alarm: Alarm):
    """Update a specific alarm."""
    try:
        alarms_file = HUB_DATA_PATH / "countdowns.yaml"
        if not alarms_file.exists():
            raise HTTPException(status_code=404, detail="Alarms file not found")
        
        alarms_data = read_yaml_file(alarms_file)
        if not alarms_data or "alarms" not in alarms_data:
            raise HTTPException(status_code=404, detail="No alarms found")
        
        # Find and update the alarm
        alarm_found = False
        for i, existing_alarm in enumerate(alarms_data["alarms"]):
            if existing_alarm.get("id") == alarm_id:
                alarm_dict = alarm.dict(exclude_unset=True)
                # Ensure hours, minutes, seconds fields are present
                if "hours" not in alarm_dict:
                    alarm_dict["hours"] = existing_alarm.get("hours", 0)
                if "minutes" not in alarm_dict:
                    alarm_dict["minutes"] = existing_alarm.get("minutes", 0)
                if "seconds" not in alarm_dict:
                    alarm_dict["seconds"] = existing_alarm.get("seconds", 0)
                
                # If days/hours/minutes/seconds changed but targetDate wasn't updated,
                # recalculate the targetDate
                time_changed = (
                    alarm_dict.get("days") != existing_alarm.get("days") or
                    alarm_dict.get("hours") != existing_alarm.get("hours") or
                    alarm_dict.get("minutes") != existing_alarm.get("minutes") or
                    alarm_dict.get("seconds") != existing_alarm.get("seconds")
                )
                target_unchanged = "targetDate" not in alarm_dict
                
                if time_changed and target_unchanged:
                    now = datetime.now(timezone.utc)
                    target = now + timedelta(
                        days=alarm_dict.get("days", 0),
                        hours=alarm_dict.get("hours", 0),
                        minutes=alarm_dict.get("minutes", 0),
                        seconds=alarm_dict.get("seconds", 0)
                    )
                    alarm_dict["targetDate"] = target.isoformat()
                    
                alarms_data["alarms"][i] = alarm_dict
                alarm_found = True
                break
        
        if not alarm_found:
            raise HTTPException(status_code=404, detail=f"Alarm not found: {alarm_id}")
        
        # Write back to file
        write_yaml_file(alarms_file, alarms_data)
        
        return alarm.dict()
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error updating alarm: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"Error updating alarm: {e}")

@app.delete("/alarms/{alarm_id}")
async def delete_alarm(alarm_id: str):
    """Delete a specific alarm."""
    try:
        alarms_file = HUB_DATA_PATH / "countdowns.yaml"
        if not alarms_file.exists():
            raise HTTPException(status_code=404, detail="Alarms file not found")
        
        alarms_data = read_yaml_file(alarms_file)
        if not alarms_data or "alarms" not in alarms_data:
            raise HTTPException(status_code=404, detail="No alarms found")
        
        # Find and remove the alarm
        alarm_found = False
        for i, existing_alarm in enumerate(alarms_data["alarms"]):
            if existing_alarm.get("id") == alarm_id:
                alarms_data["alarms"].pop(i)
                alarm_found = True
                break
        
        if not alarm_found:
            raise HTTPException(status_code=404, detail=f"Alarm not found: {alarm_id}")
        
        # Write back to file
        write_yaml_file(alarms_file, alarms_data)
        
        return {"status": "success", "message": f"Alarm deleted: {alarm_id}"}
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error deleting alarm: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"Error deleting alarm: {e}")

# --- Test Endpoints ---
@app.get("/test-simple")
@app.post("/test-simple")
async def test_simple_endpoint():
    """Simple endpoint to test if the server is up and responding to both GET and POST."""
    logger.info("Test simple endpoint called")
    return {
        "status": "ok",
        "message": "Backend is responding to both GET and POST requests",
        "timestamp": datetime.now().isoformat()
    }

@app.post("/test-form")
async def test_form_endpoint(form_data: TestForm):
    """Test endpoint for receiving form data."""
    logger.info(f"Form data received: {form_data.title}")
    return {
        "status": "ok",
        "message": "Form data received successfully",
        "data": form_data.dict(),
        "timestamp": datetime.now().isoformat()
    }

@app.get("/debug/ping")
async def debug_ping():
    """Simple endpoint to test API connectivity."""
    logger.info("Debug ping received")
    return {
        "status": "ok", 
        "message": "Backend is responding", 
        "timestamp": datetime.now().isoformat()
    }

# --- Focus Monitor Endpoints ---
@app.get("/focus/status")
async def get_focus_status():
    """Get the current focus monitor status."""
    return {"active": focus_monitor_active}

@app.post("/focus/toggle")
async def toggle_focus_status():
    """Toggle the focus monitor status."""
    global focus_monitor_active
    focus_monitor_active = not focus_monitor_active
    logger.info(f"Focus monitor toggled to: {focus_monitor_active}")
    
    # Broadcast the status change to all connected clients
    await manager.broadcast({"type": "focus_status_changed", "active": focus_monitor_active})
    
    return {"active": focus_monitor_active}

# --- WebSocket Endpoint ---
@app.websocket("/ws")
async def websocket_endpoint(websocket: WebSocket):
    """Handle WebSocket connections for real-time updates."""
    await manager.connect(websocket)
    try:
        while True:
            data = await websocket.receive_text()
            # Handle any incoming messages if needed
    except WebSocketDisconnect:
        await manager.disconnect(websocket)

# --- Focus Logs File Access Endpoints ---
@app.get("/focus_logs/{filename}")
async def get_focus_log_file(filename: str):
    """Serve focus log files (screenshots, text files, etc.) directly from FocusTimer directory."""
    # Validate the filename is safe
    if ".." in filename or "/" in filename or "\\" in filename:
        raise HTTPException(status_code=400, detail="Invalid filename")
    
    # Direct path to the file
    file_path = FOCUS_TIMER_PATH / filename
    
    if not file_path.exists():
        raise HTTPException(status_code=404, detail="File not found")
    
    return FileResponse(str(file_path))

# --- Focus Summary Endpoint ---
@app.get("/focus/summary")
async def get_focus_summary(date: str):
    """
    Get focus summary for a specific date.
    Always reads directly from C:\Users\admin\Desktop\FocusTimer\focus_logs.
    If no pre-generated summary is found, calculates it on-the-fly from the JSONL log file.
    """
    try:
        datetime.strptime(date, "%Y-%m-%d")
    except ValueError:
        raise HTTPException(status_code=400, detail="Invalid date format, use YYYY-MM-DD")

    # Direct path to FocusTimer directory
    focus_timer_dir = FilePath(r"C:\Users\admin\Desktop\FocusTimer\focus_logs")
    focus_timer_summary_file = focus_timer_dir / f"daily_summary_{date}.json"
    focus_timer_log_file = focus_timer_dir / f"focus_log_{date}.jsonl"
    
    logger.info(f"Looking for focus logs directly in: {focus_timer_dir}")

    # 1. First try reading pre-generated summary from FocusTimer
    if focus_timer_summary_file.exists():
        summary_data = read_json_file(focus_timer_summary_file)
        if summary_data is not None:
            logger.info(f"Serving pre-generated summary from FocusTimer for {date}")
            return summary_data

    # 2. Try generating from log file in FocusTimer
    logger.info(f"Pre-generated summary not found, attempting on-demand calculation.")
    if focus_timer_log_file.exists():
        logger.info(f"Calculating from FocusTimer log file")
        calculated_summary = calculate_summary_from_log(focus_timer_log_file, date)
        return calculated_summary

    # 3. No log files found
    logger.warning(f"No focus log files found for {date}")
    # Return default empty structure instead of 404 for better UX
    return { 
        "date": date, 
        "totalTime": 0, 
        "appBreakdown": [], 
        "screenshots": [],
        "keywords": [], 
        "focusScore": 0, 
        "distractionEvents": 0, 
        "meetingTime": 0,
        "productiveApps": [], 
        "distractionApps": [], 
        "status": "No log data found" 
    }

# --- Projects API ---
@app.get("/projects")
async def get_projects():
    """Get all projects from the hub data directory."""
    try:
        projects = []
        for item in HUB_DATA_PATH.iterdir():
            if item.is_dir() and not item.name.startswith('.') and not item.name.startswith('_'):
                project_file = item / "project.yaml"
                if project_file.exists():
                    project_data = read_yaml_file(project_file)
                    if project_data:
                        project_data["id"] = item.name
                        projects.append(project_data)
        
        return projects
    except Exception as e:
        logger.error(f"Error getting projects: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"Error getting projects: {e}")

@app.post("/projects")
async def create_project(project: Project):
    """Create a new project."""
    logger.info(f"Create project request received: {project.title}")
    try:
        # Generate a safe project ID from the title
        project_id = re.sub(r'[^a-zA-Z0-9]', '-', project.title.lower())
        project_id = re.sub(r'-+', '-', project_id).strip('-')
        
        # Ensure the project ID is unique
        base_id = project_id
        counter = 1
        while (HUB_DATA_PATH / project_id).exists():
            project_id = f"{base_id}-{counter}"
            counter += 1
        
        # Create project directory
        project_dir = HUB_DATA_PATH / project_id
        project_dir.mkdir(parents=True, exist_ok=True)
        
        # Create project.yaml
        project_data = project.dict()
        write_yaml_file(project_dir / "project.yaml", project_data)
        
        # Create standard subdirectories
        (project_dir / "docs").mkdir(exist_ok=True)
        (project_dir / "assets").mkdir(exist_ok=True)
        
        # Create tasks.yaml if not exists
        if not (project_dir / "tasks.yaml").exists():
            write_yaml_file(project_dir / "tasks.yaml", {"tasks": []})
        
        return {"id": project_id, **project_data}
    except Exception as e:
        logger.error(f"Error creating project: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"Error creating project: {e}")

@app.get("/projects/{project_id}")
async def get_project(project_id: str):
    """Get a specific project by ID."""
    if not _is_safe_path(project_id):
        raise HTTPException(status_code=400, detail="Invalid project ID")
    
    project_file = HUB_DATA_PATH / project_id / "project.yaml"
    if not project_file.exists():
        raise HTTPException(status_code=404, detail=f"Project not found: {project_id}")
    
    project_data = read_yaml_file(project_file)
    if not project_data:
        raise HTTPException(status_code=500, detail=f"Error reading project: {project_id}")
    
    return {"id": project_id, **project_data}

@app.put("/projects/{project_id}")
async def update_project(project_id: str, project: Project):
    """Update a specific project."""
    if not _is_safe_path(project_id):
        raise HTTPException(status_code=400, detail="Invalid project ID")
    
    project_file = HUB_DATA_PATH / project_id / "project.yaml"
    if not project_file.exists():
        raise HTTPException(status_code=404, detail=f"Project not found: {project_id}")
    
    try:
        project_data = project.dict()
        write_yaml_file(project_file, project_data)
        return {"id": project_id, **project_data}
    except Exception as e:
        logger.error(f"Error updating project: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"Error updating project: {e}")

@app.delete("/projects/{project_id}")
async def delete_project(project_id: str):
    """Delete a specific project."""
    if not _is_safe_path(project_id):
        raise HTTPException(status_code=400, detail="Invalid project ID")
    
    project_dir = HUB_DATA_PATH / project_id
    if not project_dir.exists() or not project_dir.is_dir():
        raise HTTPException(status_code=404, detail=f"Project not found: {project_id}")
    
    try:
        import shutil
        shutil.rmtree(project_dir)
        return {"status": "success", "message": f"Project deleted: {project_id}"}
    except Exception as e:
        logger.error(f"Error deleting project: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"Error deleting project: {e}")

# --- LLM Task Controller Routes ---
@app.post("/llm/tasks/process")
async def process_llm_task_command(request: LLMTaskRequest):
    """Process a natural language command for task management with LLM."""
    try:
        # Prepare system prompt with project and task context
        projects = llm_task_controller.get_all_projects()
        
        # Build context section with current projects and tasks
        context = "CURRENT PROJECTS AND TASKS:\n\n"
        for project in projects:
            project_id = project.get('id')
            context += f"Project: {project.get('title')} ({project_id})\n"
            context += f"Description: {project.get('description', 'No description')}\n"
            context += f"Status: {project.get('status', 'Unknown')}\n"
            
            tasks = llm_task_controller.get_project_tasks(project_id)
            context += "Tasks:\n"
            for task in tasks:
                context += f"- [{task.get('status', 'unknown')}] {task.get('id')}: {task.get('title')} " \
                          f"(Priority: {task.get('priority', 'unknown')}, " \
                          f"Due: {task.get('due', 'not set')}, " \
                          f"Assigned to: {task.get('assigned_to', 'unassigned')})\n"
            context += "\n"
        
        # Use custom system prompt if provided, otherwise use default
        system_prompt = request.system_prompt
        if not system_prompt:
            system_prompt = f"""You are an AI assistant that helps manage tasks in a local dashboard. 
            You can perform actions on tasks by responding with specific JSON formatted commands.

            {context}

            When I ask you to perform an action on tasks, you should:
            1. Provide a brief natural language explanation of what you understand and what you're going to do
            2. Include a valid JSON object that I can parse to execute the action
            3. Add any additional advice or context after the JSON

            It's perfectly fine to have normal text before and after the JSON, but make sure the JSON itself is properly formatted.
            Ideally, place the JSON in a code block like this:

            ```json
            {{
                "action": "create_task",
                "project_id": "Project-A",
                "task": {{
                    "title": "Task title",
                    "description": "Task description",
                    "status": "todo",
                    "priority": "medium",
                    "due": "YYYY-MM-DD",
                    "assigned_to": "Person Name"
                }}
            }}
            ```

            For updating a task:
            ```json
            {{
                "action": "update_task",
                "project_id": "Project-A",
                "task_id": "task-1",
                "updates": {{
                    "status": "in-progress"
                    // Add any other fields you want to update
                }}
            }}
            ```

            For deleting a task:
            ```json
            {{
                "action": "delete_task",
                "project_id": "Project-A",
                "task_id": "task-1"
            }}
            ```

            For getting tasks in a project:
            ```json
            {{
                "action": "get_tasks",
                "project_id": "Project-A"
            }}
            ```

            For getting all projects:
            ```json
            {{
                "action": "get_projects"
            }}
            ```

            Task status options: "todo", "in-progress", "done"
            Priority options: "low", "medium", "high"

            Make sure your JSON is properly formatted and contains all required fields for the action."""

        # Generate LLM response
        messages = [
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": request.command}
        ]
        
        logger.info(f"Sending task command to LLM: {request.command}")
        llm_response = ollama_client.chat_completion(request.model_id, messages)
        
        if not llm_response or "content" not in llm_response:
            logger.error("Failed to get response from LLM")
            return {"success": False, "error": "Failed to get response from LLM"}
        
        # Extract JSON from the response
        content = llm_response.get("content", "")
        logger.info(f"Received LLM response, extracting JSON")
        extracted_json = extract_json_from_llm_response(content)
        
        if not extracted_json:
            logger.warning(f"Could not extract valid JSON from LLM response")
            return {
                "success": False, 
                "error": "Could not extract JSON command from LLM response",
                "llm_response": content
            }
        
        # Process the command
        result = llm_task_controller.process_llm_response(extracted_json)
        
        # If successful, broadcast task update if applicable
        if result.get("success") and result.get("action") in ["create_task", "update_task", "delete_task"] \
           and result.get("project_id"):
            await manager.broadcast({"type": "tasks_updated", "project_id": result.get("project_id")})
        
        # Add LLM response to the result
        result["llm_response"] = content
        return result
        
    except Exception as e:
        logger.error(f"Error processing LLM task command: {e}", exc_info=True)
        return {"success": False, "error": str(e)}

@app.post("/llm/tasks/direct-json")
async def process_direct_json(json_data: Dict[str, Any]):
    """Process JSON actions directly without LLM interpretation."""
    try:
        json_str = json.dumps(json_data)
        result = llm_task_controller.process_llm_response(json_str)
        
        # If successful, broadcast task update if applicable
        if result.get("success") and result.get("action") in ["create_task", "update_task", "delete_task"] \
           and result.get("project_id"):
            await manager.broadcast({"type": "tasks_updated", "project_id": result.get("project_id")})
            
        return result
    except Exception as e:
        logger.error(f"Error processing direct JSON: {e}", exc_info=True)
        return {"success": False, "error": str(e)}


# --- Tasks Routes (standard) ---
@app.get("/tasks")
async def get_all_project_tasks():
    """Get all tasks from all projects."""
    try:
        tasks = []
        for item in HUB_DATA_PATH.iterdir():
            if item.is_dir() and not item.name.startswith('.') and not item.name.startswith('_'):
                project_id = item.name
                tasks_file = item / "tasks.yaml"
                if tasks_file.exists():
                    project_tasks = read_yaml_file(tasks_file)
                    if project_tasks:
                        # Handle different formats
                        if isinstance(project_tasks, list):
                            project_task_list = project_tasks
                        elif isinstance(project_tasks, dict) and "tasks" in project_tasks:
                            project_task_list = project_tasks["tasks"]
                        else:
                            project_task_list = []
                            
                        # Add project_id to each task
                        for task in project_task_list:
                            task["project_id"] = project_id
                            tasks.append(task)
        
        return {"tasks": tasks}
    except Exception as e:
        logger.error(f"Error getting all tasks: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"Error getting all tasks: {e}")

@app.get("/tasks/{project_id}")
async def get_tasks_for_project(project_id: str):
    """Get tasks for a specific project."""
    if not _is_safe_path(project_id):
        raise HTTPException(status_code=400, detail="Invalid project ID")
    
    tasks_file = HUB_DATA_PATH / project_id / "tasks.yaml"
    if not tasks_file.exists():
        return {"tasks": []}
    
    tasks_data = read_yaml_file(tasks_file)
    if not tasks_data:
        return {"tasks": []}
        
    # Handle different formats
    if isinstance(tasks_data, list):
        tasks = tasks_data
    elif isinstance(tasks_data, dict) and "tasks" in tasks_data:
        tasks = tasks_data["tasks"]
    else:
        tasks = []
        
    # Add project_id to each task
    for task in tasks:
        task["project_id"] = project_id
        
    return {"tasks": tasks}

@app.post("/tasks/{project_id}")
async def create_project_task(project_id: str, task: Task):
    """Create a new task for a project."""
    logger.info(f"Create task request received for project {project_id}: {task.title}")
    if not _is_safe_path(project_id):
        raise HTTPException(status_code=400, detail="Invalid project ID")
    
    # Check if project exists
    project_dir = HUB_DATA_PATH / project_id
    if not project_dir.exists() or not project_dir.is_dir():
        raise HTTPException(status_code=404, detail=f"Project not found: {project_id}")
    
    try:
        tasks_file = project_dir / "tasks.yaml"
        tasks_file.parent.mkdir(parents=True, exist_ok=True)
        
        # Generate a task ID if not provided
        task_dict = task.dict()
        if not task_dict.get("id"):
            task_dict["id"] = f"task-{int(time.time())}"
        
        # Add creation timestamp
        task_dict["created_at"] = datetime.now().isoformat()
        
        # Read existing tasks or create new structure
        tasks_data = {"tasks": []}
        
        if tasks_file.exists():
            file_content = read_yaml_file(tasks_file)
            if file_content:
                # Handle different formats
                if isinstance(file_content, list):
                    tasks_data = {"tasks": file_content}
                elif isinstance(file_content, dict) and "tasks" in file_content:
                    tasks_data = file_content
        
        # Add the new task
        tasks_data["tasks"].append(task_dict)
        
        # Write back to file
        write_yaml_file(tasks_file, tasks_data)
        
        # Broadcast task update via WebSocket
        await manager.broadcast({"type": "tasks_updated", "project_id": project_id})
        
        # Add project_id for the response
        task_dict["project_id"] = project_id
        
        return task_dict
    except Exception as e:
        logger.error(f"Error creating task: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"Error creating task: {e}")

@app.put("/tasks/{project_id}/{task_id}")
async def update_project_task(project_id: str, task_id: str, task: Task):
    """Update a task in a project."""
    if not _is_safe_path(project_id):
        raise HTTPException(status_code=400, detail="Invalid project ID")
    
    tasks_file = HUB_DATA_PATH / project_id / "tasks.yaml"
    if not tasks_file.exists():
        raise HTTPException(status_code=404, detail=f"No tasks found for project: {project_id}")
    
    try:
        task_dict = task.dict()
        task_dict["updated_at"] = datetime.now().isoformat()
        
        # Make sure the task ID matches
        task_dict["id"] = task_id
        
        # Read existing tasks
        tasks_data = read_yaml_file(tasks_file)
        if not tasks_data:
            raise HTTPException(status_code=404, detail=f"No tasks found for project: {project_id}")
            
        # Handle different formats
        if isinstance(tasks_data, list):
            tasks = tasks_data
            tasks_list_format = True
        elif isinstance(tasks_data, dict) and "tasks" in tasks_data:
            tasks = tasks_data["tasks"]
            tasks_list_format = False
        else:
            raise HTTPException(status_code=500, detail=f"Invalid tasks format for project: {project_id}")
        
        # Find and update the task
        task_found = False
        for i, existing_task in enumerate(tasks):
            if existing_task.get("id") == task_id:
                tasks[i] = task_dict
                task_found = True
                break
                
        if not task_found:
            raise HTTPException(status_code=404, detail=f"Task not found: {task_id}")
            
        # Write back to file
        if tasks_list_format:
            write_yaml_file(tasks_file, tasks)
        else:
            tasks_data["tasks"] = tasks
            write_yaml_file(tasks_file, tasks_data)
        
        # Broadcast task update via WebSocket
        await manager.broadcast({"type": "tasks_updated", "project_id": project_id})
        
        # Add project_id for the response
        task_dict["project_id"] = project_id
        
        return task_dict
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error updating task: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"Error updating task: {e}")

@app.delete("/tasks/{project_id}/{task_id}")
async def delete_project_task(project_id: str, task_id: str):
    """Delete a task from a project."""
    if not _is_safe_path(project_id):
        raise HTTPException(status_code=400, detail="Invalid project ID")
    
    tasks_file = HUB_DATA_PATH / project_id / "tasks.yaml"
    if not tasks_file.exists():
        raise HTTPException(status_code=404, detail=f"No tasks found for project: {project_id}")
    
    try:
        # Read existing tasks
        tasks_data = read_yaml_file(tasks_file)
        if not tasks_data:
            raise HTTPException(status_code=404, detail=f"No tasks found for project: {project_id}")
            
        # Handle different formats
        if isinstance(tasks_data, list):
            tasks = tasks_data
            tasks_list_format = True
        elif isinstance(tasks_data, dict) and "tasks" in tasks_data:
            tasks = tasks_data["tasks"]
            tasks_list_format = False
        else:
            raise HTTPException(status_code=500, detail=f"Invalid tasks format for project: {project_id}")
        
        # Find and delete the task
        task_found = False
        for i, existing_task in enumerate(tasks):
            if existing_task.get("id") == task_id:
                tasks.pop(i)
                task_found = True
                break
                
        if not task_found:
            raise HTTPException(status_code=404, detail=f"Task not found: {task_id}")
            
        # Write back to file
        if tasks_list_format:
            write_yaml_file(tasks_file, tasks)
        else:
            tasks_data["tasks"] = tasks
            write_yaml_file(tasks_file, tasks_data)
        
        # Broadcast task update via WebSocket
        await manager.broadcast({"type": "tasks_updated", "project_id": project_id})
        
        return {"status": "success", "message": f"Task deleted: {task_id}"}
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error deleting task: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"Error deleting task: {e}")

# --- Startup and Shutdown Events ---
@app.on_event("startup")
async def startup_event():
    global main_event_loop
    main_event_loop = asyncio.get_running_loop() # Store the main loop

    logger.info(f"--- Starting Projects Hub Backend ---")
    logger.info(f"Watching data directory: {HUB_DATA_PATH}")
    
    # Ensure hub data directory exists and is writable
    try:
        HUB_DATA_PATH.mkdir(parents=True, exist_ok=True)
        # Test write access by creating a test file
        test_file = HUB_DATA_PATH / ".test_write"
        test_file.write_text("test")
        test_file.unlink()  # Remove test file
        logger.info(f"Hub data directory ready: {HUB_DATA_PATH}")
    except Exception as e:
        logger.critical(f"Failed to access hub data directory: {e}", exc_info=True)
        raise RuntimeError(f"Cannot access hub data directory: {e}")

    # Create required subdirectories
    required_dirs = ["focus_logs"]
    for dir_name in required_dirs:
        dir_path = HUB_DATA_PATH / dir_name
        try:
            dir_path.mkdir(exist_ok=True)
            logger.info(f"Ensured directory exists: {dir_path}")
        except Exception as e:
            logger.error(f"Failed to create {dir_name} directory: {e}")

    # Start file watcher
    if main_event_loop:
        event_handler = HubChangeHandler(manager, main_event_loop)
        observer = Observer()
        try:
            observer.schedule(event_handler, str(HUB_DATA_PATH), recursive=True)
            observer.start()
            app.state.observer = observer
            logger.info(f"File system watcher started successfully.")
        except Exception as e:
            logger.error(f"Failed to start file observer: {e}. Realtime updates disabled.", exc_info=True)
            app.state.observer = None
    else:
        logger.error("Could not get main event loop. File watcher disabled.")
        app.state.observer = None

    # Initialize workspace state file if it doesn't exist
    workspace_file = HUB_DATA_PATH / "workspace_state.json"
    if not workspace_file.exists():
        try:
            workspace_file.write_text(json.dumps({
                "initialized": False,
                "last_opened": None
            }))
            logger.info("Created initial workspace state file")
        except Exception as e:
            logger.error(f"Failed to create workspace state file: {e}")

@app.on_event("shutdown")
async def shutdown_event():
    logger.info("--- Shutting down Projects Hub Backend ---")
    # Stop file watcher
    if hasattr(app.state, 'observer') and app.state.observer and app.state.observer.is_alive():
        app.state.observer.stop()
        try:
             app.state.observer.join(timeout=2.0)
             logger.info("File system watcher stopped.")
        except Exception as e:
             logger.warning(f"Error joining observer thread: {e}")

# --- Meta API Endpoints ---
@app.get("/meta/pinned_docs")
async def get_pinned_docs():
    """Get all pinned documents from 00-meta.yaml."""
    try:
        meta_file = HUB_DATA_PATH / "00-meta.yaml"
        if not meta_file.exists():
            return {"pinned_docs": []}
        
        meta_data = read_yaml_file(meta_file)
        if not meta_data or "pinned_docs" not in meta_data:
            return {"pinned_docs": []}
        
        # Format the response
        pinned_docs = []
        for doc_path in meta_data["pinned_docs"]:
            # Extract project ID from path
            path_parts = doc_path.split('/')
            if len(path_parts) >= 2:
                project_id = path_parts[0]
                title = path_parts[-1].replace('.md', '')
                # Try to read the project info to get proper title
                project_file = HUB_DATA_PATH / project_id / "project.yaml"
                project_title = ""
                if project_file.exists():
                    project_data = read_yaml_file(project_file)
                    if project_data and "title" in project_data:
                        project_title = project_data["title"]
                
                # Get file metadata
                full_path = HUB_DATA_PATH / doc_path
                last_modified = None
                if full_path.exists():
                    last_modified = datetime.fromtimestamp(full_path.stat().st_mtime).isoformat()
                
                pinned_docs.append({
                    "id": doc_path,
                    "title": title,
                    "path": doc_path,
                    "project_id": project_id,
                    "project_title": project_title,
                    "lastModified": last_modified
                })
        
        return {"pinned_docs": pinned_docs}
    except Exception as e:
        logger.error(f"Error getting pinned documents: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"Error getting pinned documents: {e}")

@app.post("/meta/pinned_docs/{doc_path:path}")
async def pin_document(doc_path: str):
    """Add a document to pinned documents list."""
    if not _is_safe_path(doc_path):
        raise HTTPException(status_code=400, detail="Invalid document path")
    
    logger.info(f"Pinning document: {doc_path}")
    
    try:
        # Get existing meta data
        meta_file = HUB_DATA_PATH / "00-meta.yaml"
        meta_data = {"pinned_docs": []}
        
        if meta_file.exists():
            existing_data = read_yaml_file(meta_file)
            if existing_data:
                meta_data = existing_data
        
        # Ensure pinned_docs key exists
        if "pinned_docs" not in meta_data:
            meta_data["pinned_docs"] = []
        
        # Add if not already pinned
        if doc_path not in meta_data["pinned_docs"]:
            meta_data["pinned_docs"].append(doc_path)
            write_yaml_file(meta_file, meta_data)
            await manager.broadcast({"type": "meta_updated", "action": "pin_added", "path": doc_path})
        
        return {"status": "success", "message": f"Document pinned: {doc_path}"}
    except Exception as e:
        logger.error(f"Error pinning document: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"Error pinning document: {e}")

@app.delete("/meta/pinned_docs/{doc_path:path}")
async def unpin_document(doc_path: str):
    """Remove a document from pinned documents list."""
    if not _is_safe_path(doc_path):
        raise HTTPException(status_code=400, detail="Invalid document path")
    
    logger.info(f"Unpinning document: {doc_path}")
    
    try:
        # Get existing meta data
        meta_file = HUB_DATA_PATH / "00-meta.yaml"
        if not meta_file.exists():
            raise HTTPException(status_code=404, detail="Meta file not found")
        
        meta_data = read_yaml_file(meta_file)
        if not meta_data or "pinned_docs" not in meta_data:
            raise HTTPException(status_code=404, detail="No pinned documents found")
        
        # Remove if exists
        if doc_path in meta_data["pinned_docs"]:
            meta_data["pinned_docs"].remove(doc_path)
            write_yaml_file(meta_file, meta_data)
            await manager.broadcast({"type": "meta_updated", "action": "pin_removed", "path": doc_path})
        
        return {"status": "success", "message": f"Document unpinned: {doc_path}"}
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error unpinning document: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"Error unpinning document: {e}")

@app.put("/meta/pinned_docs")
async def reorder_pinned_docs(pinned_docs: List[str]):
    """Update the order of pinned documents."""
    logger.info(f"Reordering pinned documents: {pinned_docs}")
    
    try:
        # Get existing meta data
        meta_file = HUB_DATA_PATH / "00-meta.yaml"
        meta_data = {}
        
        if meta_file.exists():
            existing_data = read_yaml_file(meta_file)
            if existing_data:
                meta_data = existing_data
        
        # Update pinned_docs order
        meta_data["pinned_docs"] = pinned_docs
        write_yaml_file(meta_file, meta_data)
        await manager.broadcast({"type": "meta_updated", "action": "pins_reordered"})
        
        return {"status": "success", "message": "Pinned documents reordered", "pinned_docs": pinned_docs}
    except Exception as e:
        logger.error(f"Error reordering pinned documents: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"Error reordering pinned documents: {e}")

# --- Chat with LLM Task Control Integration ---
@app.post("/chat/completion")
async def chat_completion(request: ChatRequest):
    """Get a chat completion from an LLM with additional task control."""
    try:
        logger.info(f"Chat request received for model: {request.model_id}")
        
        # Create messages array from the request
        messages = []
        
        # Build context data based on what the user requested
        context_data = request.context_data if request.context_data else {}
        
        # Check if we should include workspace data (projects, tasks, documents)
        system_context = ""
        
        # PROJECTS
        if context_data.get("include_projects", False) or context_data.get("include_all", False):
            logger.info("Including project information in context")
            try:
                projects = []
                for item in HUB_DATA_PATH.iterdir():
                    if item.is_dir() and not item.name.startswith('.') and not item.name.startswith('_'):
                        project_file = item / "project.yaml"
                        if project_file.exists():
                            project_data = read_yaml_file(project_file)
                            if project_data:
                                project_data["id"] = item.name
                                projects.append(project_data)
                
                if projects:
                    project_context = "### PROJECTS ###\n\n"
                    for project in projects:
                        project_context += f"Project ID: {project.get('id')}\n"
                        project_context += f"Title: {project.get('title')}\n"
                        project_context += f"Status: {project.get('status', 'Unknown')}\n"
                        if project.get('description'):
                            project_context += f"Description: {project.get('description')}\n"
                        if project.get('tags'):
                            project_context += f"Tags: {', '.join(project.get('tags'))}\n"
                        if project.get('due'):
                            project_context += f"Due Date: {project.get('due')}\n"
                        project_context += "\n"
                    
                    system_context += project_context
                    logger.info(f"Added project context for {len(projects)} projects")
            except Exception as e:
                logger.error(f"Error gathering project information: {e}")
        
        # TASKS
        if context_data.get("include_tasks", False) or context_data.get("include_all", False):
            logger.info("Including tasks information in context")
            try:
                all_tasks = []
                for item in HUB_DATA_PATH.iterdir():
                    if item.is_dir() and not item.name.startswith('.') and not item.name.startswith('_'):
                        project_id = item.name
                        tasks_file = item / "tasks.yaml"
                        if tasks_file.exists():
                            task_data = read_yaml_file(tasks_file)
                            if task_data:
                                # Handle different formats
                                if isinstance(task_data, list):
                                    tasks_list = task_data
                                elif isinstance(task_data, dict) and "tasks" in task_data:
                                    tasks_list = task_data["tasks"]
                                else:
                                    tasks_list = []
                                    
                                # Add project_id to each task
                                for task in tasks_list:
                                    task["project_id"] = project_id
                                    all_tasks.append(task)
                
                if all_tasks:
                    tasks_context = "\n### TASKS ###\n\n"
                    
                    # Group tasks by project
                    tasks_by_project = {}
                    for task in all_tasks:
                        project_id = task.get('project_id')
                        if project_id not in tasks_by_project:
                            tasks_by_project[project_id] = []
                        tasks_by_project[project_id].append(task)
                    
                    # Format tasks grouped by project
                    for project_id, tasks in tasks_by_project.items():
                        tasks_context += f"Project: {project_id}\n"
                        for task in tasks:
                            tasks_context += f"  - ID: {task.get('id')}\n"
                            tasks_context += f"    Title: {task.get('title')}\n"
                            tasks_context += f"    Status: {task.get('status', 'Unknown')}\n"
                            if task.get('description'):
                                tasks_context += f"    Description: {task.get('description')}\n"
                            if task.get('priority'):
                                tasks_context += f"    Priority: {task.get('priority')}\n"
                            if task.get('due'):
                                tasks_context += f"    Due: {task.get('due')}\n"
                            if task.get('assigned_to'):
                                tasks_context += f"    Assigned to: {task.get('assigned_to')}\n"
                            tasks_context += "\n"
                        tasks_context += "\n"
                    
                    system_context += tasks_context
                    logger.info(f"Added context for {len(all_tasks)} tasks")
            except Exception as e:
                logger.error(f"Error gathering tasks information: {e}")
        
        # DOCUMENTS
        if context_data.get("include_documents", False) or context_data.get("include_all", False):
            logger.info("Including documents information in context")
            try:
                docs_context = "\n### DOCUMENTS ###\n\n"
                docs_count = 0
                
                for item in HUB_DATA_PATH.iterdir():
                    if item.is_dir() and not item.name.startswith('.') and not item.name.startswith('_'):
                        project_id = item.name
                        docs_dir = item / "docs"
                        
                        if docs_dir.exists() and docs_dir.is_dir():
                            docs = list(docs_dir.glob("*.md"))
                            
                            if docs:
                                docs_context += f"Project: {project_id}\n"
                                for doc in docs:
                                    docs_count += 1
                                    docs_context += f"  - {doc.name}\n"
                                    
                                    # Option: include document content (careful with token limits)
                                    if context_data.get("include_document_content", False):
                                        try:
                                            content = read_text_file(doc)
                                            docs_context += f"    Content preview: {content[:200]}...\n"
                                        except Exception as doc_err:
                                            logger.error(f"Error reading document content: {doc_err}")
                                docs_context += "\n"
                
                if docs_count > 0:
                    system_context += docs_context
                    logger.info(f"Added context for {docs_count} documents")
            except Exception as e:
                logger.error(f"Error gathering documents information: {e}")
        
        # Add system context if we have any
        if system_context:
            messages.append({"role": "system", "content": system_context})
            logger.info("Added system context with workspace data")
        
        # Check if there's a session with history
        session_path = HUB_DATA_PATH / "chat_sessions" / f"{request.session_id}.json"
        if session_path.exists():
            try:
                session_data = read_json_file(session_path)
                if session_data and "messages" in session_data:
                    # Only keep the last few messages to avoid context overflow
                    saved_messages = session_data["messages"][-10:]
                    messages.extend([{"role": msg["role"], "content": msg["content"]} for msg in saved_messages])
            except Exception as e:
                logger.error(f"Error reading chat session: {e}")
        
        # Add the new user message
        messages.append({"role": "user", "content": request.message})
        
        # Get LLM response
        response = ollama_client.chat_completion(request.model_id, messages)
        
        if response:
            # Extract content and check if it contains a task control command
            content = response.get("content", "")
            extracted_json = extract_json_from_llm_response(content)
            
            # If it seems to be a task control command, process it
            if extracted_json:
                logger.info(f"Detected task control JSON in chat response, processing command")
                result = llm_task_controller.process_llm_response(extracted_json)
                
                # If successful, broadcast task update if applicable
                if result.get("success") and result.get("action") in ["create_task", "update_task", "delete_task"] \
                and result.get("project_id"):
                    await manager.broadcast({"type": "tasks_updated", "project_id": result.get("project_id")})
                    
                # Add a note to the response that a task action was performed
                if result.get("success"):
                    action_type = result.get("action", "")
                    action_note = ""
                    if action_type == "create_task":
                        action_note = "✅ Task created successfully."
                    elif action_type == "update_task":
                        action_note = "✅ Task updated successfully."
                    elif action_type == "delete_task":
                        action_note = "✅ Task deleted successfully."
                    elif action_type == "get_tasks" or action_type == "get_projects":
                        action_note = "✅ Information retrieved successfully."
                        
                    if action_note:
                        content = f"{content}\n\n{action_note}"
                        response["content"] = content
            
            # Add the new message to the session
            try:
                # Create the user message entry
                user_message = {
                    "id": f"msg_{int(time.time())}_user",
                    "role": "user",
                    "content": request.message,
                    "timestamp": datetime.now().isoformat(),
                    "model": None
                }
                
                # Create the assistant message entry
                assistant_message = {
                    "id": response.get("id", f"msg_{int(time.time())}_assistant"),
                    "role": "assistant",
                    "content": content,
                    "timestamp": datetime.now().isoformat(),
                    "model": request.model_id
                }
                
                # Read or create session
                session_data = {
                    "id": request.session_id,
                    "title": request.session_id,
                    "lastMessage": datetime.now().isoformat(),
                    "lastUpdated": datetime.now().isoformat(),
                    "messages": []
                }
                
                if session_path.exists():
                    try:
                        existing_session = read_json_file(session_path)
                        if existing_session:
                            session_data = existing_session
                    except Exception as e:
                        logger.warning(f"Error reading existing session, creating new: {e}")
                
                # Append the new messages
                session_data["messages"].append(user_message)
                session_data["messages"].append(assistant_message)
                session_data["lastMessage"] = request.message[:50] + ("..." if len(request.message) > 50 else "")
                session_data["lastUpdated"] = datetime.now().isoformat()
                
                # Ensure the sessions directory exists
                (HUB_DATA_PATH / "chat_sessions").mkdir(exist_ok=True)
                
                # Write back to file
                with open(session_path, "w", encoding="utf-8") as f:
                    json.dump(session_data, f, ensure_ascii=False, indent=2)
                    
            except Exception as e:
                logger.error(f"Error saving chat session: {e}")
                
            return response
        else:
            return {"error": "No response from model"}
    except Exception as e:
        logger.error(f"Error in chat completion: {e}", exc_info=True)
        return {"error": str(e)}

# --- Main Execution Guard ---
if __name__ == "__main__":
    import uvicorn
    logger.info("Starting backend directly via uvicorn (likely for development).")
    uvicorn.run("main:app", host="0.0.0.0", port=8000, reload=True, workers=1)
