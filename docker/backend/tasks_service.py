"""
Tasks Service Module

This module provides service functions for task management in the LocalDashboard application.
It includes functions for creating, reading, updating, and deleting tasks, as well as
specialized operations like task filtering, status updates, and analytics.
"""

import os
import yaml
import json
import logging
from datetime import datetime
from pathlib import Path
from typing import Dict, List, Any, Optional, Union
import uuid
import time

logger = logging.getLogger(__name__)

class TasksService:
    """Service class for task operations."""

    def __init__(self, data_path: Path):
        """Initialize TasksService with base data path."""
        self.data_path = data_path
        
    def get_all_tasks(self) -> List[Dict[str, Any]]:
        """Get all tasks from all projects."""
        all_tasks = []
        
        # Iterate through project directories
        for project_dir in self.data_path.iterdir():
            if not project_dir.is_dir() or project_dir.name.startswith('.') or project_dir.name.startswith('_'):
                continue
                
            project_id = project_dir.name
            tasks = self._get_project_tasks_internal(project_id)
            
            # Add project_id to each task and add to result list
            for task in tasks:
                task["project_id"] = project_id
                # Add project title if available
                project_data = self._get_project_data(project_id)
                if project_data and "title" in project_data:
                    task["project_title"] = project_data["title"]
                all_tasks.append(task)
        
        return all_tasks
    
    def search_tasks(self, query: Optional[str] = None, 
                     status: Optional[str] = None,
                     due_before: Optional[str] = None,
                     due_after: Optional[str] = None,
                     assigned_to: Optional[str] = None,
                     priority: Optional[str] = None,
                     project_id: Optional[str] = None,
                     tags: Optional[List[str]] = None) -> List[Dict[str, Any]]:
        """Search for tasks with various filters."""
        # Get all tasks
        all_tasks = self.get_all_tasks()
        filtered_tasks = all_tasks
        
        # Apply filters
        if query:
            query = query.lower()
            filtered_tasks = [
                task for task in filtered_tasks 
                if (task.get("title", "").lower().find(query) != -1) or 
                (task.get("description", "").lower().find(query) != -1)
            ]
        
        if status:
            filtered_tasks = [task for task in filtered_tasks if task.get("status") == status]
            
        if project_id:
            filtered_tasks = [task for task in filtered_tasks if task.get("project_id") == project_id]
        
        if due_before:
            try:
                due_date = datetime.strptime(due_before, "%Y-%m-%d").date()
                filtered_tasks = [
                    task for task in filtered_tasks 
                    if task.get("due") and datetime.strptime(task.get("due"), "%Y-%m-%d").date() <= due_date
                ]
            except ValueError:
                logger.warning(f"Invalid date format for due_before: {due_before}")
                
        if due_after:
            try:
                due_date = datetime.strptime(due_after, "%Y-%m-%d").date()
                filtered_tasks = [
                    task for task in filtered_tasks 
                    if task.get("due") and datetime.strptime(task.get("due"), "%Y-%m-%d").date() >= due_date
                ]
            except ValueError:
                logger.warning(f"Invalid date format for due_after: {due_after}")
        
        if assigned_to:
            filtered_tasks = [
                task for task in filtered_tasks 
                if task.get("assigned_to", "").lower() == assigned_to.lower()
            ]
        
        if priority:
            filtered_tasks = [task for task in filtered_tasks if task.get("priority") == priority]
            
        if tags and isinstance(tags, list):
            filtered_tasks = [
                task for task in filtered_tasks
                if task.get("tags") and any(tag in task.get("tags", []) for tag in tags)
            ]
        
        return filtered_tasks
    
    def get_project_tasks(self, project_id: str) -> List[Dict[str, Any]]:
        """Get tasks for a specific project."""
        tasks = self._get_project_tasks_internal(project_id)
        
        # Add project_id to each task
        for task in tasks:
            task["project_id"] = project_id
            
        return tasks
    
    def get_task(self, project_id: str, task_id: str) -> Optional[Dict[str, Any]]:
        """Get a specific task from a project."""
        tasks = self._get_project_tasks_internal(project_id)
        
        for task in tasks:
            if task.get("id") == task_id:
                task["project_id"] = project_id
                return task
                
        return None
    
    def create_task(self, project_id: str, task_data: Dict[str, Any]) -> Dict[str, Any]:
        """Create a new task in the specified project."""
        tasks_file = self.data_path / project_id / "tasks.yaml"
        tasks_file.parent.mkdir(parents=True, exist_ok=True)
        
        # Ensure task has an ID
        if not task_data.get("id"):
            task_data["id"] = f"task-{str(uuid.uuid4())[:8]}"
            
        # Ensure it has a timestamp
        if not task_data.get("created_at"):
            task_data["created_at"] = datetime.now().isoformat()
            
        # Read existing tasks or create new structure
        tasks = []
        tasks_data = {}
        
        if tasks_file.exists():
            with open(tasks_file, "r", encoding="utf-8") as f:
                file_content = f.read().strip()
                
            if file_content:
                try:
                    tasks_data = yaml.safe_load(file_content)
                    
                    # Handle different formats
                    if isinstance(tasks_data, list):
                        tasks = tasks_data
                        # Convert to {"tasks": [...]} format
                        tasks_data = {"tasks": tasks}
                    elif isinstance(tasks_data, dict) and "tasks" in tasks_data:
                        tasks = tasks_data["tasks"]
                    else:
                        tasks_data = {"tasks": []}
                        tasks = tasks_data["tasks"]
                except yaml.YAMLError:
                    logger.error(f"Invalid YAML in tasks file: {tasks_file}")
                    tasks_data = {"tasks": []}
                    tasks = tasks_data["tasks"]
            else:
                tasks_data = {"tasks": []}
                tasks = tasks_data["tasks"]
        else:
            tasks_data = {"tasks": []}
            tasks = tasks_data["tasks"]
            
        # Check for duplicate ID
        if any(t.get("id") == task_data["id"] for t in tasks):
            # Generate a new ID to avoid conflicts
            task_data["id"] = f"task-{str(uuid.uuid4())[:8]}"
            
        # Add the new task
        tasks.append(task_data)
        
        # Write back to file
        with open(tasks_file, "w", encoding="utf-8") as f:
            if "tasks" in tasks_data:
                yaml.dump(tasks_data, f, default_flow_style=False, sort_keys=False)
            else:
                yaml.dump(tasks, f, default_flow_style=False, sort_keys=False)
            
        # Add project_id for the response
        task_data["project_id"] = project_id
        
        return task_data
        
    def update_task(self, project_id: str, task_id: str, task_data: Dict[str, Any]) -> Optional[Dict[str, Any]]:
        """Update an existing task."""
        # Ensure task ID in the data matches the requested ID
        task_data["id"] = task_id
        task_data["updated_at"] = datetime.now().isoformat()
        
        tasks_file = self.data_path / project_id / "tasks.yaml"
        if not tasks_file.exists():
            return None
            
        # Read existing tasks
        with open(tasks_file, "r", encoding="utf-8") as f:
            file_content = f.read().strip()
            
        if not file_content:
            return None
            
        try:
            tasks_data = yaml.safe_load(file_content)
            
            # Handle different formats
            if isinstance(tasks_data, list):
                tasks = tasks_data
                # We'll convert to {"tasks": [...]} format for consistency
                tasks_data = {"tasks": tasks}
            elif isinstance(tasks_data, dict) and "tasks" in tasks_data:
                tasks = tasks_data["tasks"]
            else:
                return None
                
            # Find and update the task
            task_found = False
            for i, task in enumerate(tasks):
                if task.get("id") == task_id:
                    tasks[i] = task_data
                    task_found = True
                    break
                    
            if not task_found:
                return None
                
            # Write back to file
            with open(tasks_file, "w", encoding="utf-8") as f:
                if isinstance(tasks_data, dict) and "tasks" in tasks_data:
                    yaml.dump(tasks_data, f, default_flow_style=False, sort_keys=False)
                else:
                    yaml.dump(tasks, f, default_flow_style=False, sort_keys=False)
                
            # Add project_id for the response
            task_data["project_id"] = project_id
            return task_data
            
        except yaml.YAMLError:
            logger.error(f"Invalid YAML in tasks file: {tasks_file}")
            return None
    
    def delete_task(self, project_id: str, task_id: str) -> bool:
        """Delete a task from a project."""
        tasks_file = self.data_path / project_id / "tasks.yaml"
        if not tasks_file.exists():
            return False
            
        # Read existing tasks
        with open(tasks_file, "r", encoding="utf-8") as f:
            file_content = f.read().strip()
            
        if not file_content:
            return False
            
        try:
            tasks_data = yaml.safe_load(file_content)
            
            # Handle different formats
            if isinstance(tasks_data, list):
                tasks = tasks_data
                # We'll convert to {"tasks": [...]} format for consistency
                tasks_data = {"tasks": tasks}
            elif isinstance(tasks_data, dict) and "tasks" in tasks_data:
                tasks = tasks_data["tasks"]
            else:
                return False
                
            # Find and delete the task
            task_found = False
            for i, task in enumerate(tasks):
                if task.get("id") == task_id:
                    tasks.pop(i)
                    task_found = True
                    break
                    
            if not task_found:
                return False
                
            # Write back to file
            with open(tasks_file, "w", encoding="utf-8") as f:
                if isinstance(tasks_data, dict) and "tasks" in tasks_data:
                    yaml.dump(tasks_data, f, default_flow_style=False, sort_keys=False)
                else:
                    yaml.dump(tasks, f, default_flow_style=False, sort_keys=False)
                
            return True
            
        except yaml.YAMLError:
            logger.error(f"Invalid YAML in tasks file: {tasks_file}")
            return False
    
    def update_task_status(self, project_id: str, task_id: str, new_status: str) -> Optional[Dict[str, Any]]:
        """Update just the status of a task."""
        task = self.get_task(project_id, task_id)
        if not task:
            return None
            
        task["status"] = new_status
        task["updated_at"] = datetime.now().isoformat()
        
        return self.update_task(project_id, task_id, task)
    
    def get_task_statistics(self) -> Dict[str, Any]:
        """Get statistics about all tasks."""
        all_tasks = self.get_all_tasks()
        
        # Basic stats
        total_tasks = len(all_tasks)
        total_projects = len({task.get("project_id") for task in all_tasks})
        
        # Status breakdown
        status_counts = {}
        for task in all_tasks:
            status = task.get("status", "unknown")
            status_counts[status] = status_counts.get(status, 0) + 1
            
        # Priority breakdown
        priority_counts = {}
        for task in all_tasks:
            priority = task.get("priority", "unknown")
            priority_counts[priority] = priority_counts.get(priority, 0) + 1
            
        # Due date analysis
        overdue_tasks = []
        due_today = []
        due_this_week = []
        today = datetime.now().date()
        
        for task in all_tasks:
            if task.get("due"):
                try:
                    due_date = datetime.strptime(task.get("due"), "%Y-%m-%d").date()
                    days_until_due = (due_date - today).days
                    
                    if days_until_due < 0 and task.get("status") != "done":
                        overdue_tasks.append(task)
                    elif days_until_due == 0:
                        due_today.append(task)
                    elif 0 < days_until_due <= 7:
                        due_this_week.append(task)
                except ValueError:
                    pass
        
        # Assignee breakdown
        assignee_counts = {}
        for task in all_tasks:
            assignee = task.get("assigned_to", "unassigned")
            assignee_counts[assignee] = assignee_counts.get(assignee, 0) + 1
            
        return {
            "total_tasks": total_tasks,
            "total_projects": total_projects,
            "status_breakdown": status_counts,
            "priority_breakdown": priority_counts,
            "overdue_count": len(overdue_tasks),
            "due_today_count": len(due_today),
            "due_this_week_count": len(due_this_week),
            "assignee_breakdown": assignee_counts
        }
    
    def get_task_templates(self) -> List[Dict[str, Any]]:
        """Get available task templates."""
        templates_dir = self.data_path / "templates" / "tasks"
        if not templates_dir.exists():
            return []
            
        templates = []
        for template_file in templates_dir.glob("*.yaml"):
            try:
                with open(template_file, "r", encoding="utf-8") as f:
                    template_data = yaml.safe_load(f)
                    
                if template_data:
                    template_name = template_file.stem
                    templates.append({
                        "id": template_name,
                        "name": template_data.get("name", template_name),
                        "description": template_data.get("description", ""),
                        "template": template_data.get("template", {})
                    })
            except Exception as e:
                logger.error(f"Error reading template {template_file}: {e}")
                
        return templates
    
    def create_task_from_template(self, project_id: str, template_id: str, 
                                  task_data: Dict[str, Any]) -> Optional[Dict[str, Any]]:
        """Create a new task from a template."""
        templates_dir = self.data_path / "templates" / "tasks"
        template_file = templates_dir / f"{template_id}.yaml"
        
        if not template_file.exists():
            return None
            
        try:
            with open(template_file, "r", encoding="utf-8") as f:
                template_data = yaml.safe_load(f)
                
            if not template_data or "template" not in template_data:
                return None
                
            # Start with template and override with provided data
            final_task_data = template_data["template"].copy()
            final_task_data.update(task_data)
            
            # Ensure ID is unique
            if not final_task_data.get("id"):
                final_task_data["id"] = f"task-{str(uuid.uuid4())[:8]}"
                
            return self.create_task(project_id, final_task_data)
            
        except Exception as e:
            logger.error(f"Error creating task from template: {e}")
            return None
            
    def _get_project_tasks_internal(self, project_id: str) -> List[Dict[str, Any]]:
        """Internal method to get tasks for a project."""
        tasks_file = self.data_path / project_id / "tasks.yaml"
        if not tasks_file.exists():
            return []
            
        try:
            with open(tasks_file, "r", encoding="utf-8") as f:
                file_content = f.read().strip()
                
            if not file_content:
                return []
                
            tasks_data = yaml.safe_load(file_content)
            
            # Handle different formats
            if isinstance(tasks_data, list):
                return tasks_data
            elif isinstance(tasks_data, dict) and "tasks" in tasks_data:
                return tasks_data["tasks"]
            else:
                return []
                
        except Exception as e:
            logger.error(f"Error reading tasks for project {project_id}: {e}")
            return []
            
    def _get_project_data(self, project_id: str) -> Optional[Dict[str, Any]]:
        """Get project metadata."""
        project_file = self.data_path / project_id / "project.yaml"
        if not project_file.exists():
            return None
            
        try:
            with open(project_file, "r", encoding="utf-8") as f:
                project_data = yaml.safe_load(f)
                
            return project_data
        except Exception as e:
            logger.error(f"Error reading project data for {project_id}: {e}")
            return None