@echo off
chcp 437 >nul
echo VideoSR Start
echo.

if not exist "venv\Scripts\python.exe" (
    echo Creating venv...
    python -m venv venv
)

echo Installing deps...
venv\Scripts\pip.exe install -r requirements.txt
echo Pip done, starting server...
echo.

venv\Scripts\python.exe server.py

echo.
echo Server stopped.
cmd /k
