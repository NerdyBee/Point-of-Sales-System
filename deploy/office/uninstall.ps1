# Removes the Ajoke POS startup tasks, database service, firewall rule and shortcuts.
# The data, backups and program folder stay unless you pass -DeleteData.
param([string]$InstallDir = $PSScriptRoot, [switch]$DeleteData)

$ErrorActionPreference = "Continue"
foreach ($task in "Ajoke POS Server", "Ajoke POS Backup") {
  Stop-ScheduledTask -TaskName $task -ErrorAction SilentlyContinue
  Unregister-ScheduledTask -TaskName $task -Confirm:$false -ErrorAction SilentlyContinue
}
$node = Join-Path $InstallDir "node\node.exe"
Get-CimInstance Win32_Process -Filter "Name = 'node.exe'" | Where-Object { $_.ExecutablePath -eq $node } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force }
if (Get-Service "AjokePOS-DB" -ErrorAction SilentlyContinue) {
  Stop-Service "AjokePOS-DB" -Force
  & sc.exe delete "AjokePOS-DB" | Out-Null
}
Remove-NetFirewallRule -DisplayName "Ajoke POS Server" -ErrorAction SilentlyContinue
Remove-Item (Join-Path ([Environment]::GetFolderPath("CommonDesktopDirectory")) "Ajoke POS.url") -ErrorAction SilentlyContinue
Remove-Item (Join-Path ([Environment]::GetFolderPath("CommonPrograms")) "Ajoke POS.url") -ErrorAction SilentlyContinue

if ($DeleteData) {
  Set-Location $env:TEMP
  Remove-Item $InstallDir -Recurse -Force
  Write-Host "Ajoke POS and all its data were removed."
} else {
  Write-Host "Ajoke POS was uninstalled. Data and backups are still in $InstallDir."
}
