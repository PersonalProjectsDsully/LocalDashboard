@echo off
echo Restarting LocalDashboard application...

REM Stop current processes
echo Stopping current processes...
taskkill /f /im cmd.exe /fi "WINDOWTITLE eq *LocalDashboard*" > nul 2>&1
docker-compose down

REM Wait a moment 
timeout /t 2 /nobreak > nul

REM Start the application again
echo Starting application again...
start start_dev.bat

echo Done! The application should now restart.
