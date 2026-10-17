@echo off
title Stop Hotel City Park Local Servers
cd /d "%~dp0"

echo ==================================================================
echo       STOPPING HOTEL CITY PARK LOCAL SERVERS
echo ==================================================================
echo.

powershell -Command "
$ports = @(3000, 8081);
foreach ($p in $ports) {
  $conn = Get-NetTCPConnection -LocalPort $p -ErrorAction SilentlyContinue;
  if ($conn) {
    $pids = $conn.OwningProcess | Select-Object -Unique;
    foreach ($procId in $pids) {
      if ($procId -gt 4) {
        Write-Host \"Stopping process on port $p (PID: $procId)...\";
        Stop-Process -Id $procId -Force -ErrorAction SilentlyContinue;
      }
    }
  } else {
    Write-Host \"Port $p is already free.\";
  }
}
"

echo.
echo [✓] All local Hotel City Park servers have been stopped.
echo.
pause
