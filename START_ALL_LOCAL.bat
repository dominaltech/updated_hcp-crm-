@echo off
title Hotel City Park - Local Environment (CRM, Admin, Storeman)
cd /d "%~dp0"

echo ==================================================================
echo       STARTING HOTEL CITY PARK LOCAL ENVIRONMENT
echo ==================================================================
echo.
echo [1/2] Checking Node.js installation...
node -v >nul 2>&1
if errorlevel 1 (
    echo [ERROR] Node.js is not found in PATH!
    echo Please install Node.js from https://nodejs.org or verify your installation.
    pause
    exit /b 1
)

echo [2/2] Launching CRM (port 3000), Admin Panel (port 8081), and Storeman Panel...
echo.
node scripts/start_all.js --local-only %*

pause
