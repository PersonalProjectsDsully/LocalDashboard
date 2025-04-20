@echo off
echo Installing markdown editor packages...
cd /d %~dp0
npm install --save @uiw/react-md-editor
echo Done! Restart your application.
pause
