# Links this office server to the business's cloud server.
# Your Ajoke POS provider gives you the cloud address and a one-time pairing code.
#
#   connect-cloud.ps1 [-InstallDir C:\AjokePOS] [-Url https://...] [-Code ABCD-EFGH] [-NoRestart]
param(
  [string]$InstallDir = $PSScriptRoot,
  [string]$Url,
  [string]$Code,
  [switch]$NoRestart
)

$ErrorActionPreference = "Stop"
$TaskName = "Ajoke POS Server"
$Node = Join-Path $InstallDir "node\node.exe"
$Server = Join-Path $InstallDir "server"

Write-Host ""
Write-Host "== Connect to the cloud server" -ForegroundColor Cyan
if (-not $Url) { $Url = Read-Host "Cloud address (e.g. https://pos.yourbusiness.com), or press Enter to skip" }
if (-not $Url) { Write-Host "Skipped. Run connect-cloud.ps1 in $InstallDir later to connect."; return }
if (-not $Code) { $Code = Read-Host "Pairing code" }

# Only one process may sync at a time, so the server is paused while the first sync runs.
$task = Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
if ($task) { Stop-ScheduledTask -TaskName $TaskName }
Get-CimInstance Win32_Process -Filter "Name = 'node.exe'" | Where-Object { $_.ExecutablePath -eq $Node } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force }

Push-Location $Server
& $Node "dist\sync.cjs" connect --url $Url.Trim() --code $Code.Trim().ToUpper()
$connected = $LASTEXITCODE -eq 0
Pop-Location

if ($connected) { Write-Host "Connected. The business has been downloaded from the cloud." -ForegroundColor Green }
else { Write-Host "Could not connect. Check the address and code (codes expire after 24 hours) and the internet connection, then run connect-cloud.ps1 again." -ForegroundColor Yellow }

if ($task -and -not $NoRestart) { Start-ScheduledTask -TaskName $TaskName }
