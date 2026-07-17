@echo off
setlocal
cd /d "%~dp0"
node tools\content-studio\start.mjs
if errorlevel 1 pause
