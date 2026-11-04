# Saves a compressed copy of the Ajoke POS database to the backups folder and keeps the
# newest 30. Runs daily from the "Ajoke POS Backup" task; you can also run it by hand.
# Copy the backups folder to a USB drive or Google Drive from time to time.
param([string]$InstallDir = $PSScriptRoot, [int]$Keep = 30)

# "Continue": mariadb-dump prints harmless warnings; failures are caught by exit code.
$ErrorActionPreference = "Continue"
$envLine = Get-Content (Join-Path $InstallDir "server\.env") | Where-Object { $_ -like "DATABASE_URL=*" }
$url = [Uri]($envLine -replace '^DATABASE_URL="?([^"]*)"?$', '$1')
$user, $password = $url.UserInfo.Split(":", 2)
$backups = Join-Path $InstallDir "backups"
$name = "ajokepos-$(Get-Date -Format 'yyyy-MM-dd-HHmm')"
$sql = Join-Path $backups "$name.sql"

New-Item -ItemType Directory -Force -Path $backups | Out-Null
& (Join-Path $InstallDir "mariadb\bin\mariadb-dump.exe") "-u$user" "-p$([Uri]::UnescapeDataString($password))" "-h$($url.Host)" "-P$($url.Port)" `
  --single-transaction --routines --triggers "--result-file=$sql" $url.AbsolutePath.Trim("/")
if ($LASTEXITCODE -ne 0) { Remove-Item $sql -ErrorAction SilentlyContinue; throw "mariadb-dump failed" }

$items = @($sql)
$uploads = Join-Path $InstallDir "server\uploads"
if (Test-Path $uploads) { $items += $uploads }
Compress-Archive -Path $items -DestinationPath (Join-Path $backups "$name.zip") -Force
Remove-Item $sql

Get-ChildItem $backups -Filter "ajokepos-*.zip" | Sort-Object Name -Descending | Select-Object -Skip $Keep | Remove-Item
Write-Host "Backup saved: $(Join-Path $backups "$name.zip")"
