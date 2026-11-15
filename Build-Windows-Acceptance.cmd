@echo off
setlocal
chcp 65001 >nul
cd /d "%~dp0"
node scripts\build-acceptance.mjs windows
if errorlevel 1 (
  echo.
  echo Build failed. Keep this window and send the error output. Do not run an old installer.
) else (
  echo.
  echo Build complete. See target\x86_64-pc-windows-msvc\release\bundle\nsis
)
pause
