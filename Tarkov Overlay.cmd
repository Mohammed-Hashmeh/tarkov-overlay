@echo off
REM Launches Tarkov Overlay using Electron's own binary instead of a packaged
REM exe. Windows Smart App Control blocks freshly built unsigned executables,
REM but allows electron.exe, so this is the way to run the app on a machine
REM with SAC enforcement on. Double-click this file (or make a shortcut to it).
setlocal
cd /d "%~dp0"

if not exist "node_modules\electron\dist\electron.exe" (
  echo Electron is not installed. Run:  npm install
  pause
  exit /b 1
)

if not exist "out\main\index.js" (
  echo App is not built yet. Run:  npm run build
  pause
  exit /b 1
)

if not exist "data\maps.json" (
  echo Map data is missing. Run:  npm run fetch-data
  pause
  exit /b 1
)

start "" "node_modules\electron\dist\electron.exe" .
