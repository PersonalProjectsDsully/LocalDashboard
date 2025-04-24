@echo off
echo Synchronizing focus logs...

REM Create source and destination directories if they don't exist
mkdir "C:\Users\admin\Desktop\FocusTimer\focus_logs" 2>NUL
mkdir "C:\Users\admin\Desktop\LocalDashboard\LocalDashboard\ProjectsHub\focus_logs" 2>NUL

REM Copy all focus log files from source to destination
xcopy "C:\Users\admin\Desktop\FocusTimer\focus_logs\*.*" "C:\Users\admin\Desktop\LocalDashboard\LocalDashboard\ProjectsHub\focus_logs\" /D /E /Y /I

echo Focus logs synchronized!
