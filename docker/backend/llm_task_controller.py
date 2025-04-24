"""
LLM Task Controller Module

This module provides functionality for language models to interact with and modify tasks
in the LocalDashboard system through structured JSON responses.
"""

import json
import logging
import datetime
from typing import Dict, List, Optional, Union, Any
from pathlib import Path

# Set up logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s',
    handlers=[
        logging.FileHandler("/hub_data/llm_task_controller.log", encoding='utf-8'),
        logging.StreamHandler()
    ]
)
logger = logging.getLogger(__name__)

class LLMTaskController:
    """
    Controller that enables language models to interact with and modify tasks
    in the LocalDashboard system through structured JSON responses.
    """
    
    def __init__(self, tasks_service):
        """
        Initialize the task controller with the tasks service
        
        Args:
            tasks_service: The TasksService instance
        """
        self.tasks_service = tasks_service
        logger.info(f"Initialized LLMTaskController")
    
    def get_all_projects(self) -> List[Dict]:
        """
        Get information about all projects
        
        Returns:
            List of project information dictionaries
        """
        try:
            # Extract projects from tasks service
            projects = []
            for item in self.tasks_service.data_path.iterdir():
                if (item.is_dir() and
                    not item.name.startswith('.') and
                    not item.name.startswith('_')):
                    project_info = self._get_project_info(item.name)
                    if project_info:
                        projects.append(project_info)
            return projects
        except Exception as e:
            logger.error(f"Error getting all projects: {e}")
            return []
    
    def _get_project_info(self, project_id: str) -> Optional[Dict]:
        """Get information for a specific project"""
        project_path = self.tasks_service.data_path / project_id / 'project.yaml'
        if not project_path.exists():
            logger.warning(f"Project file not found: {project_path}")
            return None
        
        try:
            project_data = self.tasks_service._get_project_data(project_id)
            if project_data:
                project_data['id'] = project_id
                return project_data
            return None
        except Exception as e:
            logger.error(f"Error loading project {project_id}: {e}")
            return None
    
    def get_project_tasks(self, project_id: str) -> List[Dict]:
        """
        Get all tasks for a specific project
        
        Args:
            project_id: Project identifier (e.g., 'Project-A')
            
        Returns:
            List of task dictionaries
        """
        try:
            tasks = self.tasks_service.get_project_tasks(project_id)
            return tasks
        except Exception as e:
            logger.error(f"Error getting tasks for project {project_id}: {e}")
            return []
    
    def create_task(self, project_id: str, task_data: Dict) -> Dict:
        """
        Create a new task in a project
        
        Args:
            project_id: Project identifier (e.g., 'Project-A')
            task_data: Dictionary containing task information
            
        Returns:
            Dictionary with operation result
        """
        try:
            # Validate required fields
            required_fields = ['title', 'description']
            for field in required_fields:
                if field not in task_data:
                    return {"success": False, "error": f"Missing required field: {field}"}
            
            # Set default values if not provided
            if 'status' not in task_data:
                task_data['status'] = 'todo'
                
            if 'priority' not in task_data:
                task_data['priority'] = 'medium'
            
            # Create the task using tasks service
            created_task = self.tasks_service.create_task(project_id, task_data)
            
            if created_task:
                logger.info(f"Created task {created_task.get('id')} in {project_id}")
                return {"success": True, "task_id": created_task.get('id'), "project_id": project_id, "action": "create_task"}
            else:
                return {"success": False, "error": "Failed to create task"}
                
        except Exception as e:
            logger.error(f"Error creating task in {project_id}: {e}")
            return {"success": False, "error": str(e)}
    
    def update_task(self, project_id: str, task_id: str, updates: Dict) -> Dict:
        """
        Update an existing task
        
        Args:
            project_id: Project identifier (e.g., 'Project-A')
            task_id: Task identifier (e.g., 'task-1')
            updates: Dictionary containing fields to update
            
        Returns:
            Dictionary with operation result
        """
        try:
            # Get the current task
            task = self.tasks_service.get_task(project_id, task_id)
            
            if not task:
                return {"success": False, "error": f"Task not found: {task_id}"}
            
            # Apply updates
            for key, value in updates.items():
                if key not in ['id', 'project_id']:  # Prevent changing the ID or project
                    task[key] = value
                    
            # Update the task
            updated_task = self.tasks_service.update_task(project_id, task_id, task)
            
            if updated_task:
                logger.info(f"Updated task {task_id} in {project_id}")
                return {"success": True, "project_id": project_id, "action": "update_task"}
            else:
                return {"success": False, "error": "Failed to update task"}
                
        except Exception as e:
            logger.error(f"Error updating task {task_id} in {project_id}: {e}")
            return {"success": False, "error": str(e)}
    
    def delete_task(self, project_id: str, task_id: str) -> Dict:
        """
        Delete a task from a project
        
        Args:
            project_id: Project identifier (e.g., 'Project-A')
            task_id: Task identifier (e.g., 'task-1')
            
        Returns:
            Dictionary with operation result
        """
        try:
            # Delete the task
            success = self.tasks_service.delete_task(project_id, task_id)
            
            if success:
                logger.info(f"Deleted task {task_id} from {project_id}")
                return {"success": True, "project_id": project_id, "action": "delete_task"}
            else:
                return {"success": False, "error": f"Failed to delete task {task_id}"}
                
        except Exception as e:
            logger.error(f"Error deleting task {task_id} from {project_id}: {e}")
            return {"success": False, "error": str(e)}
    
    def process_llm_response(self, llm_response: str) -> Dict:
        """
        Process JSON response from language model and execute the requested action
        
        Args:
            llm_response: JSON string from language model
            
        Returns:
            Dictionary with result of the executed action
        """
        try:
            # Parse the JSON response
            try:
                action_data = json.loads(llm_response)
            except json.JSONDecodeError as e:
                logger.error(f"JSON parsing error: {e}")
                logger.error(f"Attempted to parse: {llm_response}")
                return {
                    "success": False, 
                    "error": "Invalid JSON format", 
                    "details": str(e),
                    "attempted_json": llm_response
                }
            
            # Validate action format
            if 'action' not in action_data:
                return {"success": False, "error": "Missing 'action' field in response"}
                
            action = action_data['action']
            
            # Execute the appropriate action
            if action == 'get_projects':
                projects = self.get_all_projects()
                return {"success": True, "data": projects, "action": action}
                
            elif action == 'get_tasks':
                if 'project_id' not in action_data:
                    return {"success": False, "error": "Missing 'project_id' field"}
                tasks = self.get_project_tasks(action_data['project_id'])
                return {"success": True, "data": tasks, "project_id": action_data['project_id'], "action": action}
                
            elif action == 'create_task':
                if 'project_id' not in action_data or 'task' not in action_data:
                    return {"success": False, "error": "Missing required fields (project_id or task)"}
                return self.create_task(action_data['project_id'], action_data['task'])
                
            elif action == 'update_task':
                if 'project_id' not in action_data or 'task_id' not in action_data or 'updates' not in action_data:
                    return {"success": False, "error": "Missing required fields (project_id, task_id, or updates)"}
                return self.update_task(action_data['project_id'], action_data['task_id'], action_data['updates'])
                
            elif action == 'delete_task':
                if 'project_id' not in action_data or 'task_id' not in action_data:
                    return {"success": False, "error": "Missing required fields (project_id or task_id)"}
                return self.delete_task(action_data['project_id'], action_data['task_id'])
                
            else:
                return {"success": False, "error": f"Unknown action: {action}"}
                
        except Exception as e:
            logger.error(f"Error processing LLM response: {e}")
            return {"success": False, "error": str(e)}
