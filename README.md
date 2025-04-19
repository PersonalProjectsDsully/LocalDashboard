# LocalDashboard / Projects Hub

A local-first desktop workspace with projects, tasks, docs, alarms, workspace-snap, and a Focus Monitor that tracks active-window time & screenshots.

## Overview

Projects Hub is a comprehensive productivity tool designed to help you manage your projects, tasks, and focus in one place. It combines project management, document editing, time tracking, and workspace management into a single, cohesive application.

### Key Features

- **Project Management**: Organize projects with tasks, documents, and deadlines
- **Document Editing**: Create and edit markdown documents with real-time preview
- **Task Tracking**: Kanban board for visualizing task progress
- **Alarms**: Set countdowns with visual indicators for important deadlines
- **Workspace Snap**: Arrange windows with a single click for optimal productivity
- **Focus Monitor**: Track active window usage and capture periodic screenshots
- **Activity Feed**: Real-time log of actions and events
- **Command Palette**: Quick access to all features with keyboard shortcuts

## Architecture

The application consists of several components:

1. **Tauri Desktop Shell**: A cross-platform desktop application built with Rust and React
2. **FastAPI Backend**: A Python-based API server for file operations and data processing
3. **Workspace Snap Agent**: A Python script for arranging windows according to predefined layouts
4. **Focus Monitor Agent**: A Python script for tracking active windows and capturing screenshots

## Getting Started

### Prerequisites

- [Node.js](https://nodejs.org/) (v16 or later)
- [Rust](https://www.rust-lang.org/tools/install) (latest stable)
- [Python](https://www.python.org/downloads/) (3.12 or later)
- [Docker](https://www.docker.com/products/docker-desktop/) (for running the backend)
- [Tesseract OCR](https://github.com/tesseract-ocr/tesseract) (for OCR functionality)

### Installation

1. Clone the repository:
   ```
   git clone https://github.com/yourusername/projects-hub.git
   cd projects-hub
   ```

2. Set up the backend:
   ```
   cd docker/backend
   docker build -t projects-hub-backend .
   ```

3. Set up the Tauri application:
   ```
   cd ../../tauri
   npm install
   ```

4. Install Python dependencies for the agents:
   ```
   pip install pywin32 mss pytesseract pillow pywinauto screeninfo requests
   ```

### Configuration

1. Create a `ProjectsHub` directory where you want to store your data:
   ```
   mkdir ~/ProjectsHub
   ```

2. Copy the sample configuration files:
   ```
   cp -r ProjectsHub/* ~/ProjectsHub/
   ```

### Running the Application

1. Start the backend:
   ```
   docker-compose up backend
   ```

2. Start the Tauri application:
   ```
   cd tauri
   npm install
   npx tauri dev
   ```

3. (Optional) Run the Workspace Snap agent:
   ```
   python workspace_snap_agent.py --config ~/ProjectsHub/workspace_layout.json
   ```

4. (Optional) Run the Focus Monitor agent:
   ```
   python focus_monitor_agent.py --output-dir ~/ProjectsHub --tesseract-path /path/to/tesseract
   ```

## Usage

### Projects

Projects are stored in the `ProjectsHub` directory, with each project having its own subdirectory. Each project contains:

- `project.yaml`: Project metadata (title, status, tags, due date)
- `tasks.yaml`: Task definitions and status
- `docs/`: Markdown documents related to the project

### Tasks

Tasks are organized in a Kanban board with three columns: To Do, In Progress, and Done. You can drag and drop tasks between columns to update their status.

### Documents

Documents are written in Markdown and can be edited directly in the application. The editor provides a live preview of the rendered Markdown.

### Alarms

Alarms (or countdowns) are defined in `countdowns.yaml` and display in the sidebar with color-coded indicators based on their thresholds.

### Workspace Snap

Workspace layouts are defined in `workspace_layout.json` and can be activated from the command palette or dashboard.

### Focus Monitor

The Focus Monitor runs in the background and tracks:

- Active window title and application
- Time spent in each application
- Periodic screenshots (with OCR for text extraction)

Daily summaries are generated in the `focus_logs` directory and can be viewed in the Focus Report tab.

## Development

### Project Structure

```
ProjectsHub/
├─ 00-meta.yaml            # UI preferences
├─ countdowns.yaml         # Alarms/countdowns
├─ workspace_layout.json   # Window arrangement config
├─ focus_logs/             # Focus monitoring data
├─ templates/              # Project templates
└─ Project-*/              # Project directories
   ├─ project.yaml         # Project metadata
   ├─ tasks.yaml           # Project tasks
   └─ docs/                # Project documents

docker/
├─ backend/                # FastAPI backend Dockerfile and code
└─ tauri/                  # Tauri build container

tauri/                     # Tauri desktop application
├─ src/                    # React frontend code
└─ src-tauri/              # Rust backend code

workspace_snap_agent.py    # Window arrangement script
focus_monitor_agent.py     # Focus tracking script
```

### Building for Production

To build the application for production:

1. Build the Tauri application:
   ```
   cd tauri
   npm run tauri build
   ```

2. The built application will be in `tauri/src-tauri/target/release/bundle/`

## License

This project is licensed under the MIT License - see the LICENSE file for details.

## Acknowledgments

- [Tauri](https://tauri.app/) for the desktop application framework
- [FastAPI](https://fastapi.tiangolo.com/) for the backend API
- [React](https://reactjs.org/) for the frontend UI
- [Tesseract OCR](https://github.com/tesseract-ocr/tesseract) for text extraction from screenshots
