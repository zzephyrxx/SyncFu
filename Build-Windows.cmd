@echo off
setlocal
chcp 65001 >nul
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
  echo Node.js 22.18 or newer is required. Install Node.js LTS, then reopen this file.
  echo See README.md for Windows build prerequisites.
  pause
  exit /b 1
)
node scripts\build.mjs windows
set "SYNCFU_BUILD_EXIT=%ERRORLEVEL%"
echo.
if not "%SYNCFU_BUILD_EXIT%"=="0" (
  echo Build failed. Keep the error output above; do not run an old installer.
) else (
  echo Build complete. Open the installer under releases\0.1.0\.
)
pause
exit /b %SYNCFU_BUILD_EXIT%
