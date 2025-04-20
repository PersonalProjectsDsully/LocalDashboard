@echo off
echo Starting LocalDashboard development environment...

REM Check if Python and required packages are installed
python -c "import win32gui" 2>NUL
if errorlevel 1 (
    echo Installing required Python packages...
    pip install pywin32 requests
)

REM Clean up old containers
echo Cleaning up old containers...
docker-compose down --remove-orphans

REM Start the backend services in a new window
start cmd /k "docker-compose up --build"

REM Wait a moment for the backend to initialize
timeout /t 5

REM Start the focus monitor agent in a new window
start cmd /k "python focus_monitor_agent.py --output-dir ProjectsHub --api-url http://localhost:8000"

REM Start the Tauri development environment
cd tauri
npm run dev

REM Keep the window open if there's an error
pause 