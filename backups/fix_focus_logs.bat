@echo off
echo Fixing Focus Logs access...

REM Stop Docker containers
echo Stopping Docker containers...
docker-compose down

REM Create FocusTimer directory if it doesn't exist
if not exist "C:\Users\admin\Desktop\FocusTimer" (
    echo Creating FocusTimer directory...
    mkdir "C:\Users\admin\Desktop\FocusTimer"
)

REM Create focus_logs subdirectory if it doesn't exist
if not exist "C:\Users\admin\Desktop\FocusTimer\focus_logs" (
    echo Creating focus_logs subdirectory...
    mkdir "C:\Users\admin\Desktop\FocusTimer\focus_logs"
)

REM Set environment variable for docker-compose
set FOCUS_TIMER_DIR=C:/Users/admin/Desktop/FocusTimer

REM Start Docker containers with the fixed configuration
echo Starting Docker containers with fixed configuration...
docker-compose up -d

echo Done! The Focus Report should now be able to access the logs.
echo If you still encounter issues, please restart the application completely.

pause