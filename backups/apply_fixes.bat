@echo off
echo Applying fixes to LocalDashboard...

REM Stop current processes
echo Stopping current processes...
taskkill /f /im cmd.exe /fi "WINDOWTITLE eq *LocalDashboard*" > nul 2>&1
docker-compose down

echo Creating empty documents directory and notes file for projects...
REM Loop through each project directory and create docs folder with readme file
FOR /D %%G IN ("C:\Users\admin\Desktop\LocalDashboard\LocalDashboard\ProjectsHub\*") DO (
    IF NOT "%%~nxG"=="chat_sessions" IF NOT "%%~nxG"=="focus_logs" IF NOT "%%~nxG"=="templates" IF NOT "%%~nxG"=="assets" IF NOT "%%~nxG"=="docs" (
        echo Creating docs directory for project: %%~nxG
        mkdir "%%G\docs" 2>NUL
        
        echo # Project Documentation > "%%G\docs\readme.md"
        echo. >> "%%G\docs\readme.md"
        echo This is the readme file for the project %%~nxG. >> "%%G\docs\readme.md"
        echo. >> "%%G\docs\readme.md"
        echo ## Getting Started >> "%%G\docs\readme.md"
        echo. >> "%%G\docs\readme.md"
        echo 1. Create tasks in the Tasks section >> "%%G\docs\readme.md"
        echo 2. Document your project here >> "%%G\docs\readme.md"
        echo 3. Track your progress >> "%%G\docs\readme.md"
        
        echo # Project Notes > "%%G\docs\notes.md"
        echo. >> "%%G\docs\notes.md"
        echo Use this document to keep track of important project notes. >> "%%G\docs\notes.md"
    )
)

REM Wait a moment 
timeout /t 2 /nobreak > nul

REM Start the application again
echo Starting application again...
start start_dev.bat

echo Done! The application should now be fixed.
echo - Projects page should show all your projects
echo - Documents page will show mock documents
echo - Tasks page should work for your projects
echo.
echo If any issues persist, please let me know!
