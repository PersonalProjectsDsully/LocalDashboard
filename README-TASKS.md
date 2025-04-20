# Tasks Backend Documentation

This document provides information about the enhanced tasks backend for the LocalDashboard application.

## Overview

The tasks backend provides a comprehensive set of APIs for managing tasks within projects. It includes features for:

- Creating, reading, updating, and deleting tasks
- Searching and filtering tasks across projects
- Task status management
- Task statistics
- Task templates

## API Endpoints

All task endpoints are prefixed with `/api`.

### Task Management

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/tasks` | GET | Get all tasks from all projects |
| `/api/tasks/search` | GET | Search for tasks with various filters |
| `/api/tasks/statistics` | GET | Get task statistics |
| `/api/projects/{project_id}/tasks` | GET | Get all tasks for a specific project |
| `/api/projects/{project_id}/tasks/{task_id}` | GET | Get a specific task |
| `/api/projects/{project_id}/tasks` | POST | Create a new task |
| `/api/projects/{project_id}/tasks/{task_id}` | PUT | Update a task |
| `/api/projects/{project_id}/tasks/{task_id}` | DELETE | Delete a task |
| `/api/projects/{project_id}/tasks/{task_id}/status` | PATCH | Update task status |
| `/api/task_templates` | GET | Get available task templates |
| `/api/projects/{project_id}/tasks/from_template` | POST | Create a task from a template |

## Models

The task backend uses several data models defined using Pydantic:

### TaskBase

Base model containing common task fields:

- `title` (string, required): The task title
- `description` (string, optional): Task description
- `status` (string, default="todo"): Current task status (must be one of: "todo", "in-progress", "blocked", "review", "done")
- `priority` (string, optional): Task priority (must be one of: "low", "medium", "high", "critical")
- `due` (string, optional): Due date in YYYY-MM-DD format
- `assigned_to` (string, optional): Person assigned to the task
- `tags` (array of strings, optional): List of tags associated with the task

### TaskCreate

Model for creating a new task. Inherits from TaskBase and adds:

- `id` (string, optional): Unique task identifier (generated if not provided)

### TaskUpdate

Model for updating an existing task. Inherits from TaskBase.

### TaskInDB

Model representing a task as stored. Inherits from TaskBase and adds:

- `id` (string, required): Unique task identifier
- `project_id` (string, required): ID of the project the task belongs to
- `created_at` (string, optional): Creation timestamp 
- `updated_at` (string, optional): Last updated timestamp

### TaskStatusUpdate

Model for updating only the status of a task:

- `status` (string, required): New task status

### TaskStatistics

Model for task statistics:

- `total_tasks` (integer): Total number of tasks
- `total_projects` (integer): Number of projects with tasks
- `status_breakdown` (object): Counts of tasks by status
- `priority_breakdown` (object): Counts of tasks by priority
- `overdue_count` (integer): Number of overdue tasks
- `due_today_count` (integer): Number of tasks due today
- `due_this_week_count` (integer): Number of tasks due this week
- `assignee_breakdown` (object): Counts of tasks by assignee

### TaskTemplate

Model for a task template:

- `id` (string): Template identifier
- `name` (string): Template name
- `description` (string, optional): Template description
- `template` (object): Template content for task creation

### TaskFromTemplate

Model for creating a task from a template:

- `template_id` (string): ID of the template to use
- Task fields to override template values (all optional)

## Task Templates

Task templates provide a way to create standardized tasks with predefined fields. Templates are stored as YAML files in the `templates/tasks` directory. Each template consists of:

- `name`: The template name
- `description`: Description of the template purpose
- `template`: Default values for the task

Available templates:
- Bug Fix (`bug-fix`)
- New Feature (`feature`)
- Meeting (`meeting`)
- Documentation (`documentation`)
- Project Milestone (`milestone`)

## Examples

### Create a Task

```http
POST /api/projects/project-a/tasks
Content-Type: application/json

{
  "title": "Implement user authentication",
  "description": "Add user authentication using OAuth2",
  "status": "todo",
  "priority": "high",
  "due": "2025-05-20",
  "assigned_to": "Jane Smith",
  "tags": ["auth", "security"]
}
```

### Update Task Status

```http
PATCH /api/projects/project-a/tasks/task-123/status
Content-Type: application/json

{
  "status": "in-progress"
}
```

### Create Task from Template

```http
POST /api/projects/project-a/tasks/from_template
Content-Type: application/json

{
  "template_id": "bug-fix",
  "title": "Fix login page error",
  "assigned_to": "John Doe",
  "due": "2025-04-25"
}
```

### Search Tasks

```http
GET /api/tasks/search?status=todo&priority=high&due_before=2025-05-15
```

## WebSocket Notifications

When tasks are created, updated, or deleted, the system broadcasts WebSocket messages to notify clients. The message has the following format:

```json
{
  "type": "tasks_updated",
  "project_id": "project-a"
}
```

Clients can listen for these messages to refresh their task lists accordingly.

## Implementation

The task backend is implemented using:

- `tasks_service.py`: Contains the TasksService class that handles all task operations
- `task_models.py`: Defines the Pydantic models for task data
- `main.py`: Defines the FastAPI routes for the task endpoints

## File Storage

Tasks are stored in YAML files within each project directory. Each project has a `tasks.yaml` file with the following structure:

```yaml
tasks:
  - id: task-1
    title: Task 1
    description: Description of task 1
    status: todo
    priority: high
    due: 2025-05-15
    assigned_to: John Doe
    tags:
      - feature
      - frontend
  - id: task-2
    # ...
```

Or alternatively as a flat list:

```yaml
- id: task-1
  title: Task 1
  description: Description of task 1
  status: todo
  priority: high
  due: 2025-05-15
  assigned_to: John Doe
  tags:
    - feature
    - frontend
- id: task-2
  # ...
```

Both formats are supported, but the service normalizes to the first format when writing updates.
