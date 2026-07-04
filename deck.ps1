# Launch Deck as a standalone desktop-style app window.
#
# - Ensures the prod server is up on http://127.0.0.1:12345 (builds once if the
#   web bundle is missing, then serves it detached so closing this window keeps
#   Deck running).
# - Opens Deck in a chromeless Edge/Chrome "app" window with its own dedicated
#   profile + taskbar icon, so it never gets lost among your browser tabs.
#
# Double-click deck.cmd, or pin that to the taskbar / Start.

$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $MyInvocation.MyCommand.Path
$port = 12345
$url  = "http://127.0.0.1:$port"

function Test-Port($p) {
  [bool](Get-NetTCPConnection -LocalPort $p -State Listen -ErrorAction SilentlyContinue)
}

if (-not (Test-Port $port)) {
  if (-not (Test-Path (Join-Path $root 'web\dist\index.html'))) {
    Write-Host 'Building Deck web bundle (first run)...'
    Start-Process -Wait -WindowStyle Hidden -WorkingDirectory $root `
      -FilePath 'cmd.exe' -ArgumentList '/c', 'bun run build'
  }
  Write-Host "Starting Deck server on $port..."
  Start-Process -WindowStyle Hidden -WorkingDirectory $root `
    -FilePath 'cmd.exe' -ArgumentList '/c', 'bun start'
  for ($i = 0; $i -lt 60 -and -not (Test-Port $port); $i++) { Start-Sleep -Milliseconds 500 }
}

# A dedicated user-data-dir makes this a truly separate, persistent window —
# not a tab in your main browser session.
$profileDir = Join-Path $root '.deck-app-profile'
$browsers = @(
  "$env:ProgramFiles\Microsoft\Edge\Application\msedge.exe",
  "${env:ProgramFiles(x86)}\Microsoft\Edge\Application\msedge.exe",
  "$env:LOCALAPPDATA\Microsoft\Edge\Application\msedge.exe",
  "$env:ProgramFiles\Google\Chrome\Application\chrome.exe",
  "${env:ProgramFiles(x86)}\Google\Chrome\Application\chrome.exe",
  "$env:LOCALAPPDATA\Google\Chrome\Application\chrome.exe"
)
$browser = $browsers | Where-Object { Test-Path $_ } | Select-Object -First 1

if ($browser) {
  Start-Process -FilePath $browser -ArgumentList "--app=$url", "--user-data-dir=$profileDir"
} else {
  Write-Warning 'Edge/Chrome not found; opening in the default browser instead.'
  Start-Process $url
}
