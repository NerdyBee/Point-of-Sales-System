# Ajoke POS office server installer (also used to update an existing installation).
# Run Install.cmd, which starts this script as administrator.
#
#   install.ps1 [-InstallDir C:\AjokePOS] [-Port 4000] [-DbPort 3307] [-SkipCloud]
#
# Installs: MariaDB as the "AjokePOS-DB" Windows service, the Ajoke POS server as the
# "Ajoke POS Server" startup task, a firewall rule so tablets/PCs on the shop network can
# connect, a daily database backup, and a desktop shortcut. Updating keeps all data.
param(
  [string]$InstallDir = "C:\AjokePOS",
  [int]$Port = 4000,
  [int]$DbPort = 3307,
  [switch]$SkipCloud
)

$ErrorActionPreference = "Stop"
$Source = $PSScriptRoot
$TaskName = "Ajoke POS Server"
$BackupTaskName = "Ajoke POS Backup"
$DbService = "AjokePOS-DB"

function Step($message) { Write-Host ""; Write-Host "== $message" -ForegroundColor Cyan }
function Fail($message) { Write-Host ""; Write-Host $message -ForegroundColor Red; Read-Host "Press Enter to close"; exit 1 }

function New-Password {
  $chars = [char[]]"ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789"
  $bytes = New-Object byte[] 24
  [System.Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($bytes)
  -join ($bytes | ForEach-Object { $chars[$_ % $chars.Length] })
}

function Copy-Folder($from, $to, [string[]]$keepDirs = @(), [string[]]$keepFiles = @()) {
  $arguments = @($from, $to, "/MIR", "/NFL", "/NDL", "/NJH", "/NJS", "/NP")
  if ($keepDirs.Count) { $arguments += "/XD"; $arguments += $keepDirs }
  if ($keepFiles.Count) { $arguments += "/XF"; $arguments += $keepFiles }
  & robocopy @arguments | Out-Null
  if ($LASTEXITCODE -ge 8) { Fail "Copying $from failed (robocopy code $LASTEXITCODE)." }
}

$principal = New-Object Security.Principal.WindowsPrincipal([Security.Principal.WindowsIdentity]::GetCurrent())
if (-not $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) { Fail "Please run Install.cmd (it asks for administrator permission)." }
if (-not (Test-Path (Join-Path $Source "node\node.exe"))) { Fail "Extract the whole zip file first (right-click > Extract All), then run Install.cmd from the extracted folder." }

$Node = Join-Path $InstallDir "node\node.exe"
$Server = Join-Path $InstallDir "server"
$MariaBin = Join-Path $InstallDir "mariadb\bin"
$DataDir = Join-Path $InstallDir "data"
$EnvFile = Join-Path $Server ".env"
$RootFile = Join-Path $InstallDir "config\db-root.txt"
$updating = Test-Path $EnvFile

Write-Host "Ajoke POS office server - $(if ($updating) { 'update' } else { 'installation' }) into $InstallDir" -ForegroundColor Green

Step "Stopping Ajoke POS if it is running"
if (Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue) {
  Stop-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
}
Get-CimInstance Win32_Process -Filter "Name = 'node.exe'" | Where-Object { $_.ExecutablePath -eq $Node } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force }

Step "Copying program files"
New-Item -ItemType Directory -Force -Path $InstallDir, (Join-Path $InstallDir "logs"), (Join-Path $InstallDir "backups"), (Join-Path $InstallDir "config") | Out-Null
if ((Resolve-Path $Source).Path.TrimEnd("\") -ne $InstallDir.TrimEnd("\")) {
  Copy-Folder (Join-Path $Source "node") (Join-Path $InstallDir "node")
  Copy-Folder (Join-Path $Source "server") $Server @((Join-Path $Server "uploads")) @(".env")
  if (-not (Get-Service $DbService -ErrorAction SilentlyContinue) -or -not (Test-Path $MariaBin)) {
    Copy-Folder (Join-Path $Source "mariadb") (Join-Path $InstallDir "mariadb")
  }
  Get-ChildItem $Source -File | Copy-Item -Destination $InstallDir -Force
}

Step "Setting up the database"
if (-not (Get-Service $DbService -ErrorAction SilentlyContinue)) {
  if (Test-Path $DataDir) { Fail "$DataDir already exists but the $DbService service is missing. Move that folder away (it holds old data) and run Install.cmd again." }
  $rootPassword = New-Password
  & (Join-Path $MariaBin "mariadb-install-db.exe") "--datadir=$DataDir" "--service=$DbService" "--port=$DbPort" "--password=$rootPassword"
  if ($LASTEXITCODE -ne 0) { Fail "Creating the database failed." }
  Set-Content -Path $RootFile -Value $rootPassword -Encoding ascii
  & icacls $RootFile /inheritance:r /grant:r "Administrators:F" "SYSTEM:F" | Out-Null
}
Set-Service $DbService -StartupType Automatic
Start-Service $DbService

if (-not $updating) {
  $rootPassword = (Get-Content $RootFile -Raw).Trim()
  $appPassword = New-Password
  $sql = "CREATE DATABASE IF NOT EXISTS naijapos CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci; " +
    "CREATE OR REPLACE USER 'naijapos'@'localhost' IDENTIFIED BY '$appPassword'; " +
    "CREATE OR REPLACE USER 'naijapos'@'127.0.0.1' IDENTIFIED BY '$appPassword'; " +
    "GRANT ALL PRIVILEGES ON naijapos.* TO 'naijapos'@'localhost'; " +
    "GRANT ALL PRIVILEGES ON naijapos.* TO 'naijapos'@'127.0.0.1'; FLUSH PRIVILEGES;"
  & (Join-Path $MariaBin "mariadb.exe") "-uroot" "-p$rootPassword" "-h127.0.0.1" "-P$DbPort" "-e" $sql
  if ($LASTEXITCODE -ne 0) { Fail "Creating the database user failed." }

  @(
    "DATABASE_URL=`"mysql://naijapos:$appPassword@127.0.0.1:$DbPort/naijapos`"",
    "NODE_ENV=production",
    "NODE_ROLE=office",
    "HOST=0.0.0.0",
    "PORT=$Port",
    "WEB_DIR=$(Join-Path $Server 'web')"
  ) | Set-Content -Path $EnvFile -Encoding ascii
  & icacls $EnvFile /inheritance:r /grant:r "Administrators:F" "SYSTEM:F" | Out-Null
}

Step "Creating or updating tables"
Push-Location $Server
& $Node "node_modules\prisma\build\index.js" db push
$pushed = $LASTEXITCODE
Pop-Location
if ($pushed -ne 0) { Fail "Updating the database tables failed. Nothing was deleted. Send logs and this window's text to your Ajoke POS provider." }

Step "Registering Ajoke POS to start with Windows"
# Waits for the database (up to 2 minutes after boot), then runs the server.
@(
  "@echo off",
  "cd /d `"%~dp0server`"",
  "for /l %%i in (1,1,60) do (",
  "  `"%~dp0mariadb\bin\mariadb-admin.exe`" ping -h127.0.0.1 -P$DbPort --connect-timeout=2 >nul 2>&1 && goto ready",
  "  timeout /t 2 /nobreak >nul",
  ")",
  ":ready",
  "`"%~dp0node\node.exe`" dist\server.cjs >> `"%~dp0logs\server.log`" 2>&1"
) | Set-Content -Path (Join-Path $InstallDir "start-server.cmd") -Encoding ascii
$action = New-ScheduledTaskAction -Execute "cmd.exe" -Argument "/c `"$(Join-Path $InstallDir 'start-server.cmd')`""
$trigger = New-ScheduledTaskTrigger -AtStartup
$settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -StartWhenAvailable `
  -ExecutionTimeLimit ([TimeSpan]::Zero) -RestartCount 999 -RestartInterval (New-TimeSpan -Minutes 1)
$system = New-ScheduledTaskPrincipal -UserId "SYSTEM" -LogonType ServiceAccount -RunLevel Highest
Register-ScheduledTask -TaskName $TaskName -Action $action -Trigger $trigger -Settings $settings -Principal $system -Force | Out-Null

$backupAction = New-ScheduledTaskAction -Execute "powershell.exe" -Argument "-NoProfile -ExecutionPolicy Bypass -File `"$(Join-Path $InstallDir 'backup.ps1')`""
$backupTrigger = New-ScheduledTaskTrigger -Daily -At "21:00"
Register-ScheduledTask -TaskName $BackupTaskName -Action $backupAction -Trigger $backupTrigger -Settings $settings -Principal $system -Force | Out-Null

# All profiles: Windows often marks shop Wi-Fi as "Public", which would block the tablets.
if (-not (Get-NetFirewallRule -DisplayName "Ajoke POS Server" -ErrorAction SilentlyContinue)) {
  New-NetFirewallRule -DisplayName "Ajoke POS Server" -Direction Inbound -Protocol TCP -LocalPort $Port -Action Allow -Profile Any | Out-Null
}

$shortcut = "[InternetShortcut]`r`nURL=http://localhost:$Port/`r`n"
Set-Content -Path (Join-Path ([Environment]::GetFolderPath("CommonDesktopDirectory")) "Ajoke POS.url") -Value $shortcut -Encoding ascii
Set-Content -Path (Join-Path ([Environment]::GetFolderPath("CommonPrograms")) "Ajoke POS.url") -Value $shortcut -Encoding ascii

if (-not $SkipCloud -and -not $updating) {
  & (Join-Path $InstallDir "connect-cloud.ps1") -InstallDir $InstallDir -NoRestart
}

Step "Starting Ajoke POS"
Start-ScheduledTask -TaskName $TaskName
$ready = $false
for ($i = 0; $i -lt 60 -and -not $ready; $i++) {
  Start-Sleep -Seconds 2
  try { $ready = (Invoke-WebRequest "http://127.0.0.1:$Port/health" -UseBasicParsing -TimeoutSec 2).StatusCode -eq 200 } catch {}
}
if (-not $ready) { Fail "Ajoke POS did not start. See $(Join-Path $InstallDir 'logs\server.log')." }

$addresses = Get-NetIPAddress -AddressFamily IPv4 | Where-Object { $_.IPAddress -notlike "127.*" -and $_.IPAddress -notlike "169.254.*" } | ForEach-Object { "http://$($_.IPAddress):$Port" }
Write-Host ""
Write-Host "Ajoke POS is running." -ForegroundColor Green
Write-Host "  On this computer : http://localhost:$Port (shortcut on the desktop)"
Write-Host "  Other devices    : $($addresses -join ', ')"
Write-Host "  Backups          : $(Join-Path $InstallDir 'backups') (every day at 21:00)"
Start-Process "http://localhost:$Port/"
Read-Host "Press Enter to close"
