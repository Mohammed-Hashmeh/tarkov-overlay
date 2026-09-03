# Creates a "Tarkov Overlay" shortcut on the Desktop that can be pinned to the
# taskbar. Windows refuses to pin .cmd/.bat files, so the shortcut targets
# Electron's own electron.exe -- which also keeps it clear of Smart App Control,
# since SAC blocks freshly built unsigned executables but permits electron.exe.
#
#   npm run shortcut

$ErrorActionPreference = 'Stop'
$proj = Split-Path -Parent $PSScriptRoot

$electron = Join-Path $proj 'node_modules\electron\dist\electron.exe'
$mainJs   = Join-Path $proj 'out\main\index.js'
$mapData  = Join-Path $proj 'data\maps.json'
$icon     = Join-Path $proj 'build\icon.ico'

if (-not (Test-Path $electron)) { Write-Error 'Electron is not installed. Run:  npm install'; exit 1 }
if (-not (Test-Path $mainJs))   { Write-Error 'App is not built yet. Run:  npm run build'; exit 1 }
if (-not (Test-Path $mapData))  { Write-Error 'Map data is missing. Run:  npm run fetch-data'; exit 1 }

$desktop = [Environment]::GetFolderPath('Desktop')
$lnkPath = Join-Path $desktop 'Tarkov Overlay.lnk'

$ws = New-Object -ComObject WScript.Shell
$lnk = $ws.CreateShortcut($lnkPath)
$lnk.TargetPath = $electron
# The "." is what makes Electron load this app rather than its welcome window.
$lnk.Arguments = '.'
$lnk.WorkingDirectory = $proj
$lnk.Description = 'Tarkov Overlay - interactive EFT map'
if (Test-Path $icon) { $lnk.IconLocation = "$icon,0" }
$lnk.Save()

Write-Host "Created: $lnkPath"
Write-Host ''
Write-Host 'To pin it: right-click the shortcut -> Show more options -> Pin to taskbar.'
