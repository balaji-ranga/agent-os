#Requires -Version 5.1
# Start installed Google Chrome with remote debugging for Flolah browser worker.
# Sign in to Google / Flow in THIS window, then run Start-BrowserWorker.ps1
# with BROWSER_CDP_URL=http://127.0.0.1:9222 in .env
$ErrorActionPreference = 'Stop'
$Root = Split-Path -Parent $PSScriptRoot
$Port = 9222
if ($env:BROWSER_CDP_PORT) { $Port = [int]$env:BROWSER_CDP_PORT }
$ProfileRel = 'browser-profile-chrome'
if ($env:BROWSER_USER_DATA_DIR) { $ProfileRel = $env:BROWSER_USER_DATA_DIR }
if ([System.IO.Path]::IsPathRooted($ProfileRel)) {
  $Profile = $ProfileRel
} else {
  $Profile = Join-Path $Root $ProfileRel
}
New-Item -ItemType Directory -Force -Path $Profile | Out-Null

$ChromeCandidates = @(
  (Join-Path $env:ProgramFiles 'Google\Chrome\Application\chrome.exe'),
  (Join-Path ${env:ProgramFiles(x86)} 'Google\Chrome\Application\chrome.exe'),
  (Join-Path $env:LOCALAPPDATA 'Google\Chrome\Application\chrome.exe')
)
$Chrome = $null
foreach ($c in $ChromeCandidates) {
  if ($c -and (Test-Path $c)) { $Chrome = $c; break }
}
if (-not $Chrome) { throw 'Google Chrome not found. Install Chrome, then retry.' }

$listening = Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue
if ($listening) {
  Write-Host ("Chrome CDP already listening on 127.0.0.1:{0} - reuse that window for Google/Flow login." -f $Port)
  Write-Host ("Then run Start-BrowserWorker.ps1 with BROWSER_CDP_URL=http://127.0.0.1:{0} in .env" -f $Port)
  exit 0
}

Write-Host ("Starting Chrome (debug port {0}, profile {1})..." -f $Port, $Profile)
Write-Host 'Sign in to Google Flow in this window, then start Start-BrowserWorker.ps1'
$chromeArgs = @(
  ("--remote-debugging-port={0}" -f $Port),
  '--remote-debugging-address=127.0.0.1',
  ("--user-data-dir={0}" -f $Profile),
  '--no-first-run',
  '--no-default-browser-check',
  'https://labs.google/fx/tools/flow'
)
Start-Process -FilePath $Chrome -ArgumentList $chromeArgs
Write-Host ("CDP URL: http://127.0.0.1:{0}" -f $Port)
