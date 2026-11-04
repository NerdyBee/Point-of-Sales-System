@echo off
rem Installs or updates the Ajoke POS office server. Asks for administrator permission.
powershell -NoProfile -ExecutionPolicy Bypass -Command "Start-Process powershell -Verb RunAs -ArgumentList '-NoProfile -ExecutionPolicy Bypass -File ""%~dp0install.ps1""'"
