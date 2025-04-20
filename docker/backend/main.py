from fastapi import FastAPI, WebSocket, WebSocketDisconnect, HTTPException, Query, Path as FastAPIPath, Depends
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from pydantic import BaseModel
import os
import json
import yaml
import asyncio
from typing import List, Dict, Any, Optional, Set
from datetime import datetime, timezone, timedelta # Added timedelta
import logging
from pathlib import Path as FilePath
import time
from watchdog.observers import Observer
from watchdog.events import FileSystemEventHandler, FileModifiedEvent, FileCreatedEvent, FileDeletedEvent, FileMovedEvent
import requests
from contextlib import suppress
from concurrent.futures import Future
import re # For keyword extraction

# Import the Ollama client
from ollama_client import OllamaClient

# Import task models and service
from task_models import (
    TaskCreate, TaskUpdate, TaskInDB, TaskStatusUpdate,
    TaskAssigneeUpdate, TaskStatistics, TaskTemplate, TaskFromTemplate
)
from tasks_service import TasksService

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
focus_monitor_active = True
main_event_loop: Optional[asyncio.AbstractEventLoop] = None

# Initialize services
ollama_client = OllamaClient(base_url="http://host.docker.internal:11434")
tasks_service = TasksService(HUB_DATA_PATH)

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
    time: Optional[str] = None
    thresholds: Dict[str, int]
    
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

        # Screenshots (find associated PNGs for the date)
        focus_logs_dir = log_file_path.parent
        summary["screenshots"] = sorted([f.name for f in focus_logs_dir.glob(f"screenshot_{date_str}_*.png")])

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

# --- Focus Monitor Status Endpoint ---
@app.get("/focus/status")
async def get_focus_status():
    """Get the current focus monitor status."""
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

# --- Focus Summary Endpoint ---
@app.get("/focus/summary")
async def get_focus_summary(date: str):
    """
    Get focus summary for a specific date.
    Tries to read pre-generated summary JSON first.
    If not found, calculates it on-the-fly from the JSONL log file.
    """
    try:
        datetime.strptime(date, "%Y-%m-%d")
    except ValueError:
        raise HTTPException(status_code=400, detail="Invalid date format, use YYYY-MM-DD")

    # Log paths for debugging
    summary_file = HUB_DATA_PATH / "focus_logs" / f"daily_summary_{date}.json"
    log_file = HUB_DATA_PATH / "focus_logs" / f"focus_log_{date}.jsonl"
    
    logger.info(f"Looking for focus logs at: {summary_file} or {log_file}")

    # 1. Try reading the pre-generated summary file
    summary_data = read_json_file(summary_file)
    if summary_data is not None:
        logger.info(f"Serving pre-generated summary for {date}")
        return summary_data

    # 2. If pre-generated doesn't exist, try generating on-demand from log
    logger.info(f"Pre-generated summary not found for {date}, attempting on-demand calculation.")
    if not log_file.exists():
        logger.warning(f"Neither summary nor log file found for {date}")
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

    # Calculate summary from the log file
    calculated_summary = calculate_summary_from_log(log_file, date)
    return calculated_summary

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
        alarm_dict = alarm.dict()
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
                alarms_data["alarms"][i] = alarm.dict()
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

# --- Tasks API ---
@app.get("/api/tasks", response_model=List[TaskInDB], tags=["tasks"])
async def get_all_tasks(tasks_service: TasksService = Depends(get_tasks_service)):
    """Get all tasks from all projects."""
    try:
        tasks = tasks_service.get_all_tasks()
        return tasks
    except Exception as e:
        logger.error(f"Error getting all tasks: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"Error getting all tasks: {str(e)}")

@app.get("/api/tasks/search", response_model=List[TaskInDB], tags=["tasks"])
async def search_tasks(
    q: Optional[str] = Query(None, description="Search text in title and description"),
    status: Optional[str] = Query(None, description="Filter by status"),
    due_before: Optional[str] = Query(None, description="Filter by due date before (YYYY-MM-DD)"),
    due_after: Optional[str] = Query(None, description="Filter by due date after (YYYY-MM-DD)"),
    assigned_to: Optional[str] = Query(None, description="Filter by assignee"),
    priority: Optional[str] = Query(None, description="Filter by priority"),
    project_id: Optional[str] = Query(None, description="Filter by project ID"),
    tags: Optional[List[str]] = Query(None, description="Filter by tags"),
    tasks_service: TasksService = Depends(get_tasks_service)
):
    """Search for tasks with various filters."""
    try:
        tasks = tasks_service.search_tasks(
            query=q,
            status=status,
            due_before=due_before,
            due_after=due_after,
            assigned_to=assigned_to,
            priority=priority,
            project_id=project_id,
            tags=tags
        )
        return tasks
    except Exception as e:
        logger.error(f"Error searching tasks: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"Error searching tasks: {str(e)}")

@app.get("/api/tasks/statistics", response_model=TaskStatistics, tags=["tasks"])
async def get_task_statistics(tasks_service: TasksService = Depends(get_tasks_service)):
    """Get statistics about all tasks."""
    try:
        statistics = tasks_service.get_task_statistics()
        return statistics
    except Exception as e:
        logger.error(f"Error getting task statistics: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"Error getting task statistics: {str(e)}")

@app.get("/api/projects/{project_id}/tasks", response_model=List[TaskInDB], tags=["tasks"])
async def get_project_tasks(
    project_id: str = FastAPIPath(..., description="Project ID"),
    tasks_service: TasksService = Depends(get_tasks_service)
):
    """Get all tasks for a specific project."""
    if not _is_safe_path(project_id):
        raise HTTPException(status_code=400, detail="Invalid project ID")
    
    try:
        tasks = tasks_service.get_project_tasks(project_id)
        return tasks
    except Exception as e:
        logger.error(f"Error getting tasks for project {project_id}: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"Error getting tasks: {str(e)}")

@app.get("/api/projects/{project_id}/tasks/{task_id}", response_model=TaskInDB, tags=["tasks"])
async def get_task(
    project_id: str = FastAPIPath(..., description="Project ID"),
    task_id: str = FastAPIPath(..., description="Task ID"),
    tasks_service: TasksService = Depends(get_tasks_service)
):
    """Get a specific task from a project."""
    if not _is_safe_path(project_id):
        raise HTTPException(status_code=400, detail="Invalid project ID")
    
    try:
        task = tasks_service.get_task(project_id, task_id)
        if not task:
            raise HTTPException(status_code=404, detail=f"Task not found: {task_id}")
        return task
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error getting task {task_id} from project {project_id}: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"Error getting task: {str(e)}")

@app.post("/api/projects/{project_id}/tasks", response_model=TaskInDB, status_code=201, tags=["tasks"])
async def create_task(
    project_id: str = FastAPIPath(..., description="Project ID"),
    task: TaskCreate = None,
    tasks_service: TasksService = Depends(get_tasks_service)
):
    """Create a new task in a project."""
    if not _is_safe_path(project_id):
        raise HTTPException(status_code=400, detail="Invalid project ID")
    
    # Check if project exists
    project_dir = HUB_DATA_PATH / project_id
    if not project_dir.exists() or not project_dir.is_dir():
        raise HTTPException(status_code=404, detail=f"Project not found: {project_id}")
    
    try:
        created_task = tasks_service.create_task(project_id, task.dict(exclude_unset=True))
        
        # Broadcast task update via WebSocket
        await manager.broadcast({"type": "tasks_updated", "project_id": project_id})
        
        return created_task
    except Exception as e:
        logger.error(f"Error creating task in project {project_id}: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"Error creating task: {str(e)}")

@app.put("/api/projects/{project_id}/tasks/{task_id}", response_model=TaskInDB, tags=["tasks"])
async def update_task(
    project_id: str = FastAPIPath(..., description="Project ID"),
    task_id: str = FastAPIPath(..., description="Task ID"),
    task: TaskUpdate = None,
    tasks_service: TasksService = Depends(get_tasks_service)
):
    """Update a specific task in a project."""
    if not _is_safe_path(project_id):
        raise HTTPException(status_code=400, detail="Invalid project ID")
    
    try:
        # Convert the TaskUpdate model to a dict, add the id
        task_dict = task.dict(exclude_unset=True)
        task_dict["id"] = task_id
        
        updated_task = tasks_service.update_task(project_id, task_id, task_dict)
        if not updated_task:
            raise HTTPException(status_code=404, detail=f"Task not found: {task_id}")
        
        # Broadcast task update via WebSocket
        await manager.broadcast({"type": "tasks_updated", "project_id": project_id})
        
        return updated_task
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error updating task {task_id} in project {project_id}: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"Error updating task: {str(e)}")

@app.delete("/api/projects/{project_id}/tasks/{task_id}", tags=["tasks"])
async def delete_task(
    project_id: str = FastAPIPath(..., description="Project ID"),
    task_id: str = FastAPIPath(..., description="Task ID"),
    tasks_service: TasksService = Depends(get_tasks_service)
):
    """Delete a specific task in a project."""
    if not _is_safe_path(project_id):
        raise HTTPException(status_code=400, detail="Invalid project ID")
    
    try:
        success = tasks_service.delete_task(project_id, task_id)
        if not success:
            raise HTTPException(status_code=404, detail=f"Task not found: {task_id}")
        
        # Broadcast task update via WebSocket
        await manager.broadcast({"type": "tasks_updated", "project_id": project_id})
        
        return {"status": "success", "message": f"Task deleted: {task_id}"}
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error deleting task {task_id} in project {project_id}: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"Error deleting task: {str(e)}")

@app.patch("/api/projects/{project_id}/tasks/{task_id}/status", response_model=TaskInDB, tags=["tasks"])
async def update_task_status(
    project_id: str = FastAPIPath(..., description="Project ID"),
    task_id: str = FastAPIPath(..., description="Task ID"),
    status_update: TaskStatusUpdate = None,
    tasks_service: TasksService = Depends(get_tasks_service)
):
    """Update only the status of a task (for quick status changes)."""
    if not _is_safe_path(project_id):
        raise HTTPException(status_code=400, detail="Invalid project ID")
    
    try:
        updated_task = tasks_service.update_task_status(project_id, task_id, status_update.status)
        if not updated_task:
            raise HTTPException(status_code=404, detail=f"Task not found: {task_id}")
        
        # Broadcast task update via WebSocket
        await manager.broadcast({"type": "tasks_updated", "project_id": project_id})
        
        return updated_task
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error updating status for task {task_id} in project {project_id}: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"Error updating task status: {str(e)}")

@app.get("/api/task_templates", response_model=List[TaskTemplate], tags=["tasks"])
async def get_task_templates(tasks_service: TasksService = Depends(get_tasks_service)):
    """Get all available task templates."""
    try:
        templates = tasks_service.get_task_templates()
        return templates
    except Exception as e:
        logger.error(f"Error getting task templates: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"Error getting task templates: {str(e)}")

@app.post("/api/projects/{project_id}/tasks/from_template", response_model=TaskInDB, status_code=201, tags=["tasks"])
async def create_task_from_template(
    project_id: str = FastAPIPath(..., description="Project ID"),
    template_request: TaskFromTemplate = None,
    tasks_service: TasksService = Depends(get_tasks_service)
):
    """Create a new task from a template."""
    if not _is_safe_path(project_id):
        raise HTTPException(status_code=400, detail="Invalid project ID")
    
    # Check if project exists
    project_dir = HUB_DATA_PATH / project_id
    if not project_dir.exists() or not project_dir.is_dir():
        raise HTTPException(status_code=404, detail=f"Project not found: {project_id}")
    
    try:
        # Extract template ID and override data
        template_id = template_request.template_id
        task_data = template_request.dict(exclude={"template_id"}, exclude_unset=True)
        
        created_task = tasks_service.create_task_from_template(project_id, template_id, task_data)
        if not created_task:
            raise HTTPException(status_code=404, detail=f"Template not found: {template_id}")
        
        # Broadcast task update via WebSocket
        await manager.broadcast({"type": "tasks_updated", "project_id": project_id})
        
        return created_task
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error creating task from template in project {project_id}: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"Error creating task from template: {str(e)}")

# --- Chat API Endpoints ---
@app.get("/chat/models")
async def get_chat_models():
    """Get all available chat models."""
    try:
        # Query actual models from Ollama
        ollama_models = ollama_client.get_models()
        
        # If we couldn't get any models from Ollama, fall back to default models
        if not ollama_models:
            logger.warning("Could not retrieve models from Ollama, using default models")
            ollama_models = [
                {
                    "id": "llama3",
                    "name": "Llama 3 8B",
                    "provider": "ollama",
                    "description": "Meta's Llama 3 8B model"
                },
                {
                    "id": "mistral",
                    "name": "Mistral 7B",
                    "provider": "ollama",
                    "description": "Mistral AI's 7B model"
                }
            ]
            
        # Add Claude for completeness (not actually available through Ollama)
        models = ollama_models + [
            {
                "id": "claude",
                "name": "Claude",
                "provider": "anthropic",
                "description": "Anthropic's Claude model (mock - not available)"
            }
        ]
        return models
    except Exception as e:
        logger.error(f"Error getting chat models: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"Error getting chat models: {e}")

@app.get("/chat/sessions")
async def get_chat_sessions():
    """Get all chat sessions."""
    try:
        chat_dir = HUB_DATA_PATH / "chat_sessions"
        chat_dir.mkdir(exist_ok=True)
        
        sessions = []
        for file in chat_dir.glob("*.json"):
            try:
                session_data = read_json_file(file)
                if session_data:
                    sessions.append(session_data)
            except Exception as e:
                logger.warning(f"Error reading chat session file {file}: {e}")
        
        # Sort by last updated timestamp
        sessions.sort(key=lambda s: s.get("lastUpdated", ""), reverse=True)
        return sessions
    except Exception as e:
        logger.error(f"Error getting chat sessions: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"Error getting chat sessions: {e}")

@app.get("/chat/sessions/{session_id}")
async def get_chat_session(session_id: str):
    """Get a specific chat session by ID."""
    try:
        session_file = HUB_DATA_PATH / "chat_sessions" / f"{session_id}.json"
        if not session_file.exists():
            raise HTTPException(status_code=404, detail=f"Chat session not found: {session_id}")
        
        session_data = read_json_file(session_file)
        if not session_data:
            raise HTTPException(status_code=500, detail=f"Error reading chat session: {session_id}")
        
        return session_data
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error getting chat session: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"Error getting chat session: {e}")

@app.post("/chat/sessions")
async def create_chat_session(session: ChatSession):
    """Create a new chat session."""
    try:
        chat_dir = HUB_DATA_PATH / "chat_sessions"
        chat_dir.mkdir(exist_ok=True)
        
        session_file = chat_dir / f"{session.id}.json"
        if session_file.exists():
            raise HTTPException(status_code=400, detail=f"Chat session already exists: {session.id}")
        
        session_data = session.dict()
        with open(session_file, "w", encoding="utf-8") as f:
            json.dump(session_data, f, indent=2)
        
        return session_data
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error creating chat session: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"Error creating chat session: {e}")

@app.put("/chat/sessions/{session_id}")
async def update_chat_session(session_id: str, session: ChatSession):
    """Update a specific chat session."""
    try:
        chat_dir = HUB_DATA_PATH / "chat_sessions"
        chat_dir.mkdir(exist_ok=True)
        
        session_file = chat_dir / f"{session_id}.json"
        if not session_file.exists():
            raise HTTPException(status_code=404, detail=f"Chat session not found: {session_id}")
        
        # Make sure the session ID matches the path parameter
        if session.id != session_id:
            raise HTTPException(status_code=400, detail="Session ID mismatch")
        
        session_data = session.dict()
        with open(session_file, "w", encoding="utf-8") as f:
            json.dump(session_data, f, indent=2)
        
        # Broadcast session update via WebSocket
        await manager.broadcast({"type": "chat_session_updated", "session_id": session_id})
        
        return session_data
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error updating chat session: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"Error updating chat session: {e}")

@app.delete("/chat/sessions/{session_id}")
async def delete_chat_session(session_id: str):
    """Delete a specific chat session."""
    try:
        session_file = HUB_DATA_PATH / "chat_sessions" / f"{session_id}.json"
        if not session_file.exists():
            raise HTTPException(status_code=404, detail=f"Chat session not found: {session_id}")
        
        # Delete the file
        session_file.unlink()
        
        # Broadcast session deletion via WebSocket
        await manager.broadcast({"type": "chat_session_deleted", "session_id": session_id})
        
        return {"status": "success", "message": f"Chat session deleted: {session_id}"}
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error deleting chat session: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"Error deleting chat session: {e}")

@app.post("/chat/message")
async def send_chat_message(request: ChatRequest):
    """Send a message to the LLM and get a response."""
    try:
        # First get the session
        session_file = HUB_DATA_PATH / "chat_sessions" / f"{request.session_id}.json"
        if not session_file.exists():
            raise HTTPException(status_code=404, detail=f"Chat session not found: {request.session_id}")
        
        session_data = read_json_file(session_file)
        if not session_data:
            raise HTTPException(status_code=500, detail=f"Error reading chat session: {request.session_id}")
        
        # Create user message
        user_message = {
            "id": f"msg_{int(time.time() * 1000)}",
            "role": "user",
            "content": request.message,
            "timestamp": datetime.now(timezone.utc).isoformat()
        }
        
        # Add user message to session
        if "messages" not in session_data:
            session_data["messages"] = []
        session_data["messages"].append(user_message)
        session_data["lastMessage"] = request.message
        session_data["lastUpdated"] = datetime.now(timezone.utc).isoformat()
        
        # Get model info
        models = await get_chat_models()
        model_info = next((m for m in models if m["id"] == request.model_id), None)
        model_name = model_info["name"] if model_info else request.model_id
        
        # Determine if we should use Ollama or return a mock response
        assistant_message = None
        if request.model_id == "claude":
            # Mock response for Claude since we don't have it
            assistant_message = {
                "id": f"msg_{int(time.time() * 1000)}",
                "role": "assistant",
                "content": "This is a mock response from Claude. The actual Claude API is not integrated with this dashboard.",
                "timestamp": datetime.now(timezone.utc).isoformat(),
                "model": "Claude (mock)"
            }
        else:
            # Call Ollama API for real response
            logger.info(f"Sending message to Ollama model {request.model_id}")
            try:
                # Convert existing messages to format expected by Ollama
                previous_messages = []
                if "messages" in session_data:
                    for msg in session_data["messages"]:
                        if msg.get("role") in ["user", "assistant", "system"]:
                            previous_messages.append({
                                "role": msg["role"],
                                "content": msg["content"]
                            })
                
                # Get response from Ollama
                ollama_response = ollama_client.chat_completion(
                    model_id=request.model_id,
                    messages=previous_messages,
                    temperature=0.7
                )
                
                # Format the response
                assistant_message = {
                    "id": ollama_response.get("id", f"msg_{int(time.time() * 1000)}"),
                    "role": "assistant",
                    "content": ollama_response.get("content", "No response from model"),
                    "timestamp": datetime.now(timezone.utc).isoformat(),
                    "model": model_name
                }
            except Exception as e:
                logger.error(f"Error calling Ollama API: {e}", exc_info=True)
                assistant_message = {
                    "id": f"error_{int(time.time() * 1000)}",
                    "role": "assistant",
                    "content": f"Error communicating with Ollama: {str(e)}",
                    "timestamp": datetime.now(timezone.utc).isoformat(),
                    "model": model_name
                }
        
        # Add assistant message to session
        session_data["messages"].append(assistant_message)
        session_data["lastMessage"] = "Response from assistant"
        session_data["lastUpdated"] = datetime.now(timezone.utc).isoformat()
        
        # Update session title if it's a new session
        if not session_data.get("title") or session_data.get("title") == "New Chat":
            # Extract a title from the first user message
            if len(session_data["messages"]) <= 2:  # This is the first exchange
                title = request.message
                if len(title) > 30:
                    title = title[:27] + "..."
                session_data["title"] = title
        
        # Update session file
        with open(session_file, "w", encoding="utf-8") as f:
            json.dump(session_data, f, indent=2)
        
        # Broadcast session update via WebSocket
        try:
            logger.info(f"Broadcasting chat message via WebSocket for session {request.session_id}")
            await manager.broadcast({
                "type": "chat_message_received", 
                "session_id": request.session_id,
                "message": assistant_message
            })
        except Exception as ws_error:
            logger.error(f"Error broadcasting message via websocket: {ws_error}")
        
        return {
            "session": session_data,
            "user_message": user_message,
            "assistant_message": assistant_message
        }
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error processing chat message: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"Error processing chat message: {e}")

# --- Workspace Management ---
@app.post("/workspace/initialize")
async def initialize_workspace():
    """Initialize the workspace by creating necessary directories and files."""
    try:
        # Create basic directory structure
        for dir_name in ["templates", "assets", "docs"]:
            dir_path = HUB_DATA_PATH / dir_name
            dir_path.mkdir(exist_ok=True)

        # Create initial configuration files if they don't exist
        config_files = {
            "workspace_state.json": {
                "initialized": True,
                "last_opened": datetime.now(timezone.utc).isoformat()
            },
            "countdowns.yaml": {
                "alarms": []
            },
            "00-meta.yaml": {
                "workspace_name": "My Projects Hub",
                "created_at": datetime.now(timezone.utc).isoformat(),
                "settings": {
                    "theme": "system",
                    "default_view": "grid"
                }
            }
        }

        for filename, content in config_files.items():
            file_path = HUB_DATA_PATH / filename
            if not file_path.exists():
                if filename.endswith('.json'):
                    with open(file_path, 'w', encoding='utf-8') as f:
                        json.dump(content, f, indent=2)
                else:  # .yaml files
                    write_yaml_file(file_path, content)

        # Create a welcome project
        welcome_project_dir = HUB_DATA_PATH / "welcome-project"
        if not welcome_project_dir.exists():
            welcome_project_dir.mkdir(exist_ok=True)
            (welcome_project_dir / "docs").mkdir(exist_ok=True)
            (welcome_project_dir / "assets").mkdir(exist_ok=True)

            # Create project.yaml
            write_yaml_file(welcome_project_dir / "project.yaml", {
                "title": "Welcome to Projects Hub",
                "status": "active",
                "description": "This is your first project. Feel free to explore and customize it!",
                "tags": ["welcome", "getting-started"]
            })

            # Create tasks.yaml
            write_yaml_file(welcome_project_dir / "tasks.yaml", {
                "tasks": [
                    {
                        "id": "task-1",
                        "title": "Explore the dashboard",
                        "status": "todo",
                        "priority": "medium",
                        "description": "Take a tour of the main dashboard features"
                    },
                    {
                        "id": "task-2",
                        "title": "Create your first project",
                        "status": "todo",
                        "priority": "high",
                        "description": "Click the 'New Project' button to create your own project"
                    }
                ]
            })

            # Create welcome document
            welcome_doc = welcome_project_dir / "docs" / "getting-started.md"
            welcome_doc.write_text("""# Welcome to Projects Hub!

This is your personal project management workspace. Here's what you can do:

1. **Create Projects**: Organize your work into projects
2. **Track Tasks**: Keep track of your to-dos and progress
3. **Write Documents**: Create and organize documentation
4. **Set Alarms**: Never miss important deadlines
5. **Monitor Focus**: Track your productivity

Need help? Check out the documentation or reach out to support.

Happy organizing! 🚀
""")

        return {"status": "success", "message": "Workspace initialized successfully"}

    except Exception as e:
        logger.error(f"Failed to initialize workspace: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"Failed to initialize workspace: {e}")

# --- Workspace Status ---
@app.get("/workspace/status")
async def get_workspace_status():
    """Get the current workspace initialization status."""
    try:
        workspace_file = HUB_DATA_PATH / "workspace_state.json"
        if not workspace_file.exists():
            return {"initialized": False, "error": "Workspace not initialized"}
        
        state = read_json_file(workspace_file)
        return {"initialized": state.get("initialized", False), "last_opened": state.get("last_opened")}
    except Exception as e:
        logger.error(f"Failed to get workspace status: {e}", exc_info=True)
        return {"initialized": False, "error": str(e)}

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

# --- Main Execution Guard ---
if __name__ == "__main__":
    import uvicorn
    logger.info("Starting backend directly via uvicorn (likely for development).")
    uvicorn.run("main:app", host="0.0.0.0", port=8000, reload=True, workers=1)
