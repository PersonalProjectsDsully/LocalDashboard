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

REM Create directories if they don't exist
if not exist "C:\Users\admin\Desktop\FocusTimer" mkdir "C:\Users\admin\Desktop\FocusTimer"
if not exist "C:\Users\admin\Desktop\FocusTimer\focus_logs" mkdir "C:\Users\admin\Desktop\FocusTimer\focus_logs"

REM Run the sync script once before starting
call sync_focus_logs.bat

REM Check if Windows Terminal is available
where wt >nul 2>nul
if %ERRORLEVEL% EQU 0 (
    REM Using Windows Terminal with tabs - all in one command to ensure they're in the same window
    echo Starting services using Windows Terminal tabs...
    
    REM Use a single command to create all tabs in the same window
    start wt -p "Command Prompt" -d "%CD%" cmd /k "docker-compose up --build" ^
         ; new-tab -p "Command Prompt" -d "%CD%" cmd /k "auto_sync_focus_logs.bat" ^
         ; new-tab -p "Command Prompt" -d "%CD%" cmd /k "python focus_monitor_agent.py --output-dir C:\Users\admin\Desktop\FocusTimer --api-url http://localhost:8000" ^
         ; new-tab -p "Command Prompt" -d "%CD%\tauri" cmd /k "timeout /t 5 && npm run dev"
    
    REM Wait for backend to initialize
    echo Waiting for services to initialize...
    timeout /t 5 /nobreak > nul
    
) else (
    REM Fallback to separate windows if Windows Terminal is not available
    echo Windows Terminal not found, using separate windows...
    
    REM Start the backend services in a new window
    start cmd /k "docker-compose up --build"
    
    REM Wait a moment for the backend to initialize
    timeout /t 5
    
    REM Start auto-sync in a new window
    start cmd /k "auto_sync_focus_logs.bat"
    
    REM Start the focus monitor agent in a new window
    start cmd /k "python focus_monitor_agent.py --output-dir C:\Users\admin\Desktop\FocusTimer --api-url http://localhost:8000"
    
    REM Start the Tauri development environment
    cd tauri
    npm run dev
)

echo All services started!
echo You can now use the LocalDashboard application.
echo - The backend API is running on http://localhost:8000
echo - The focus logs are stored in C:\Users\admin\Desktop\FocusTimer
echo - The focus logs are automatically synced every 60 seconds
