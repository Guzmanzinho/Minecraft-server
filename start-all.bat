@echo off
rem Playit reutiliza la credencial persistente oficial; no genera claims.
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\start-all.ps1"
if errorlevel 1 pause
