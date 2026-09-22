@echo off
title Stop Hotel City Park CRM
color 0C
echo =======================================================
echo          STOPPING HOTEL CITY PARK CRM SERVER           
echo =======================================================
echo Finding processes running on port 3000...

for /f "tokens=5" %%a in ('netstat -aon ^| findstr ":3000" ^| findstr "LISTENING"') do (
    echo Terminating PID: %%a ...
    taskkill /F /PID %%a >nul 2>&1
)

echo.
echo Checking if HotelCityPark.exe is running...
taskkill /F /IM HotelCityPark.exe >nul 2>&1

echo.
echo =======================================================
echo [OK] Hotel City Park CRM has been stopped cleanly.
echo =======================================================
timeout /t 3 >nul
