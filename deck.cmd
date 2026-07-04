@echo off
REM Launch Deck as a standalone app window. Double-click me, or pin to taskbar.
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0deck.ps1" %*
