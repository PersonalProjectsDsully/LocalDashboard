@echo off
echo Starting automatic focus logs synchronization...
echo This window will stay open and sync every 60 seconds.
echo Press Ctrl+C to stop.

:loop
cls
echo Syncing focus logs at %time%

REM Create source and destination directories if they don't exist
mkdir "C:\Users\admin\Desktop\FocusTimer\focus_logs" 2>NUL
mkdir "C:\Users\admin\Desktop\LocalDashboard\LocalDashboard\ProjectsHub\focus_logs" 2>NUL

REM Copy all focus log files from source to destination
xcopy "C:\Users\admin\Desktop\FocusTimer\focus_logs\*.*" "C:\Users\admin\Desktop\LocalDashboard\LocalDashboard\ProjectsHub\focus_logs\" /D /E /Y /I

REM List files in both directories
echo.
echo Source files (FocusTimer):
dir "C:\Users\admin\Desktop\FocusTimer\focus_logs\" /B
echo.
echo Destination files (ProjectsHub):
dir "C:\Users\admin\Desktop\LocalDashboard\LocalDashboard\ProjectsHub\focus_logs\" /B
echo.

REM Wait for 60 seconds
timeout /t 60
goto loop
