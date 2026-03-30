@echo off
cd /d "%~dp0"
npm run dev
if %errorlevel% neq 0 (
    echo.
    echo Launch failed. Press any key to exit.
    pause >nul
)
