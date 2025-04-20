@echo off
echo Checking focus logs file naming...

REM Path to focus logs
set FOCUS_LOGS_DIR=C:\Users\admin\Desktop\FocusTimer\focus_logs

REM Check if directory exists
if not exist "%FOCUS_LOGS_DIR%" (
    echo Focus logs directory not found. Creating it...
    mkdir "%FOCUS_LOGS_DIR%"
    echo Done.
    goto end
)

REM Check for files with incorrect naming patterns
echo Looking for focus log files...
for %%F in ("%FOCUS_LOGS_DIR%\*.*") do (
    REM Check if file matches the expected pattern
    echo Found: %%~nxF
    
    REM Check if it's a JSONL file without "focus_log_" prefix
    if "%%~xF"==".jsonl" (
        if not "%%~nF"=="focus_log_" (
            if not "%%~nF:~0,10%"=="focus_log_" (
                echo Fixing file name: %%~nxF to focus_log_%%~nF.jsonl
                ren "%%F" "focus_log_%%~nF%%~xF"
            )
        )
    )
)

:end
echo Focus logs file naming check complete.
pause
