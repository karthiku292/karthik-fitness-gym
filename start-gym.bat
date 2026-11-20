@echo off
title GYM SERVER - keep this window OPEN
cd /d "C:\Users\vamsh\OneDrive\Desktop\gym\backend"
set "STATIC_DIR=C:\Users\vamsh\OneDrive\Desktop\gym\frontend\dist"
echo ============================================================
echo  Starting the gym server. Please wait...
echo  When you see the line   Uvicorn running   below,
echo  open your browser to:   http://127.0.0.1:8000
echo ============================================================
echo.
".venv\Scripts\python.exe" -m uvicorn app.main:app --app-dir .
echo.
echo ===================== SERVER STOPPED =====================
echo If there is error text above, copy it and send it to Kiro.
pause
