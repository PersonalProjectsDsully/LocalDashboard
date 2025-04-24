@echo off
echo Cleaning up focus log copies...

REM Create a README file explaining the change
echo # Focus Logs Directory > "C:\Users\admin\Desktop\LocalDashboard\LocalDashboard\ProjectsHub\focus_logs\README.md"
echo. >> "C:\Users\admin\Desktop\LocalDashboard\LocalDashboard\ProjectsHub\focus_logs\README.md"
echo This directory previously contained copies of focus logs from the FocusTimer application. >> "C:\Users\admin\Desktop\LocalDashboard\LocalDashboard\ProjectsHub\focus_logs\README.md"
echo. >> "C:\Users\admin\Desktop\LocalDashboard\LocalDashboard\ProjectsHub\focus_logs\README.md"
echo As of the April 2025 update, the LocalDashboard application now reads focus logs directly from: >> "C:\Users\admin\Desktop\LocalDashboard\LocalDashboard\ProjectsHub\focus_logs\README.md"
echo `C:\Users\admin\Desktop\FocusTimer\focus_logs` >> "C:\Users\admin\Desktop\LocalDashboard\LocalDashboard\ProjectsHub\focus_logs\README.md"
echo. >> "C:\Users\admin\Desktop\LocalDashboard\LocalDashboard\ProjectsHub\focus_logs\README.md"
echo This directory is kept for backward compatibility but no longer contains synchronized log files. >> "C:\Users\admin\Desktop\LocalDashboard\LocalDashboard\ProjectsHub\focus_logs\README.md"

REM Delete all files in the directory except the README
del /Q "C:\Users\admin\Desktop\LocalDashboard\LocalDashboard\ProjectsHub\focus_logs\*.json" 2>NUL
del /Q "C:\Users\admin\Desktop\LocalDashboard\LocalDashboard\ProjectsHub\focus_logs\*.jsonl" 2>NUL
del /Q "C:\Users\admin\Desktop\LocalDashboard\LocalDashboard\ProjectsHub\focus_logs\*.png" 2>NUL
del /Q "C:\Users\admin\Desktop\LocalDashboard\LocalDashboard\ProjectsHub\focus_logs\*.txt" 2>NUL

echo Focus logs copies cleaned up and README created.
echo The directory structure has been maintained for backward compatibility.

pause
