from fastapi import FastAPI, WebSocket, WebSocketDisconnect, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
import os
import json
import yaml
import asyncio
from typing import List, Dict, Any, Optional
from datetime import datetime
import logging

# Configure logging
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s - %(name)s - %(levelname)s - %(message)s",
)
logger = logging.getLogger(__name__)

# Initialize FastAPI app
app = FastAPI(
    title="Projects Hub Backend",
    description="Backend API for Projects Hub - A local-first desktop workspace",
    version="1.0.0-alpha",
)

# Add CORS middleware
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # In production, this should be restricted
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# WebSocket connection manager
class ConnectionManager:
    def __init__(self):
        self.active_connections: List[WebSocket] = []

    async def connect(self, websocket: WebSocket):
        await websocket.accept()
        self.active_connections.append(websocket)
        logger.info(f"New WebSocket connection. Total connections: {len(self.active_connections)}")

    def disconnect(self, websocket: WebSocket):
        self.active_connections.remove(websocket)
        logger.info(f"WebSocket disconnected. Remaining connections: {len(self.active_connections)}")

    async def broadcast(self, message: Dict[str, Any]):
        for connection in self.active_connections:
            try:
                await connection.send_json(message)
            except Exception as e:
                logger.error(f"Error broadcasting message: {e}")

manager = ConnectionManager()

# Data models
class Project(BaseModel):
    title: str
    status: str
    tags: List[str]
    due: Optional[str] = None

class Task(BaseModel):
    id: str
    title: str
    description: Optional[str] = None
    status: str
    priority: Optional[str] = None
    due: Optional[str] = None

class Alarm(BaseModel):
    id: str
    title: str
    days: int
    time: Optional[str] = None
    thresholds: Dict[str, int]

# API Routes
@app.get("/")
async def root():
    return {"message": "Projects Hub API is running"}

# Files API
@app.get("/files")
async def list_files(path: str = ""):
    """List files in the ProjectsHub directory"""
    try:
        base_path = os.path.join("/hub_data", path)
        if not os.path.exists(base_path):
            raise HTTPException(status_code=404, detail=f"Path not found: {path}")
        
        items = []
        for item in os.listdir(base_path):
            item_path = os.path.join(base_path, item)
            items.append({
                "name": item,
                "path": os.path.join(path, item),
                "type": "directory" if os.path.isdir(item_path) else "file",
                "size": os.path.getsize(item_path) if os.path.isfile(item_path) else None,
                "modified": datetime.fromtimestamp(os.path.getmtime(item_path)).isoformat(),
            })
        return {"items": items}
    except Exception as e:
        logger.error(f"Error listing files: {e}")
        raise HTTPException(status_code=500, detail=str(e))

@app.get("/files/content")
async def get_file_content(path: str):
    """Get the content of a file"""
    try:
        file_path = os.path.join("/hub_data", path)
        if not os.path.exists(file_path):
            raise HTTPException(status_code=404, detail=f"File not found: {path}")
        
        if not os.path.isfile(file_path):
            raise HTTPException(status_code=400, detail=f"Not a file: {path}")
        
        with open(file_path, "r") as f:
            content = f.read()
        
        return {"content": content}
    except Exception as e:
        logger.error(f"Error reading file: {e}")
        raise HTTPException(status_code=500, detail=str(e))

# Projects API
@app.get("/projects")
async def list_projects():
    """List all projects"""
    try:
        projects = []
        base_path = "/hub_data"
        
        for item in os.listdir(base_path):
            project_dir = os.path.join(base_path, item)
            project_file = os.path.join(project_dir, "project.yaml")
            
            if os.path.isdir(project_dir) and os.path.exists(project_file):
                with open(project_file, "r") as f:
                    project_data = yaml.safe_load(f)
                    project_data["id"] = item
                    projects.append(project_data)
        
        return {"projects": projects}
    except Exception as e:
        logger.error(f"Error listing projects: {e}")
        raise HTTPException(status_code=500, detail=str(e))

# Tasks API
@app.get("/tasks")
async def list_tasks(project_id: str):
    """List tasks for a project"""
    try:
        tasks_file = os.path.join("/hub_data", project_id, "tasks.yaml")
        
        if not os.path.exists(tasks_file):
            raise HTTPException(status_code=404, detail=f"Tasks file not found for project: {project_id}")
        
        with open(tasks_file, "r") as f:
            tasks_data = yaml.safe_load(f)
        
        return {"tasks": tasks_data}
    except Exception as e:
        logger.error(f"Error listing tasks: {e}")
        raise HTTPException(status_code=500, detail=str(e))

# Alarms API
@app.get("/alarms")
async def list_alarms():
    """List all alarms"""
    try:
        alarms_file = os.path.join("/hub_data", "countdowns.yaml")
        
        if not os.path.exists(alarms_file):
            return {"alarms": []}
        
        with open(alarms_file, "r") as f:
            alarms_data = yaml.safe_load(f)
        
        return {"alarms": alarms_data}
    except Exception as e:
        logger.error(f"Error listing alarms: {e}")
        raise HTTPException(status_code=500, detail=str(e))

# Focus Monitor API
@app.get("/focus/summary")
async def get_focus_summary(date: str):
    """Get focus summary for a specific date"""
    try:
        summary_file = os.path.join("/hub_data", "focus_logs", f"daily_summary_{date}.json")
        
        if not os.path.exists(summary_file):
            raise HTTPException(status_code=404, detail=f"Focus summary not found for date: {date}")
        
        with open(summary_file, "r") as f:
            summary_data = json.load(f)
        
        return summary_data
    except Exception as e:
        logger.error(f"Error getting focus summary: {e}")
        raise HTTPException(status_code=500, detail=str(e))

# WebSocket endpoint
@app.websocket("/ws")
async def websocket_endpoint(websocket: WebSocket):
    await manager.connect(websocket)
    try:
        while True:
            data = await websocket.receive_text()
            # Process received data if needed
            await manager.broadcast({"message": "Event received", "data": data})
    except WebSocketDisconnect:
        manager.disconnect(websocket)

# Startup and shutdown events
@app.on_event("startup")
async def startup_event():
    logger.info("Starting Projects Hub Backend")
    # Start background tasks here
    asyncio.create_task(alarm_engine())

@app.on_event("shutdown")
async def shutdown_event():
    logger.info("Shutting down Projects Hub Backend")
    # Cleanup tasks here

# Background tasks
async def alarm_engine():
    """Background task to check alarms and send notifications"""
    while True:
        try:
            # Check alarms logic will go here
            pass
        except Exception as e:
            logger.error(f"Error in alarm engine: {e}")
        
        await asyncio.sleep(60)  # Check every minute

if __name__ == "__main__":
    import uvicorn
    uvicorn.run("main:app", host="0.0.0.0", port=8000, reload=True)
