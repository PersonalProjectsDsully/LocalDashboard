@echo off
echo Creating sample focus log for testing...

REM Get current date in YYYY-MM-DD format (works on most locales)
for /f "tokens=2-4 delims=/ " %%a in ('date /t') do (
    set mm=%%a
    set dd=%%b
    set yyyy=%%c
)

REM Format with leading zeros if needed
if %mm% LSS 10 set mm=0%mm%
if %dd% LSS 10 set dd=0%dd%

REM Create the date string
set today=%yyyy%-%mm%-%dd%

REM Path to focus logs
set FOCUS_LOGS_DIR=C:\Users\admin\Desktop\FocusTimer\focus_logs
set LOG_FILE=%FOCUS_LOGS_DIR%\focus_log_%today%.jsonl

REM Create directory if it doesn't exist
if not exist "%FOCUS_LOGS_DIR%" mkdir "%FOCUS_LOGS_DIR%"

REM Create sample log entry
echo Creating sample log file: %LOG_FILE%
echo {"timestamp": "%today%T12:00:00.000Z", "exe": "code.exe", "title": "Sample Editor Window", "duration": 1800} > "%LOG_FILE%"
echo {"timestamp": "%today%T12:30:00.000Z", "exe": "chrome.exe", "title": "Google - Search", "duration": 900} >> "%LOG_FILE%"
echo {"timestamp": "%today%T12:45:00.000Z", "exe": "explorer.exe", "title": "File Explorer", "duration": 600} >> "%LOG_FILE%"

echo Sample focus log created at: %LOG_FILE%
echo Running sync to make sure it's copied to ProjectsHub...

REM Run the sync script to copy it to ProjectsHub
call sync_focus_logs.bat

echo Done!
pause
