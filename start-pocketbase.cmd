@echo off
setlocal EnableExtensions DisableDelayedExpansion
cd /d "%~dp0" || exit /b 1

set "PB_EXE="
if exist "%~dp0pocketbase.exe" set "PB_EXE=%~dp0pocketbase.exe"
if not defined PB_EXE if exist "%~dp0.local\pocketbase\pocketbase.exe" set "PB_EXE=%~dp0.local\pocketbase\pocketbase.exe"
if not defined PB_EXE for /f "delims=" %%F in ('where pocketbase.exe 2^>nul') do if not defined PB_EXE set "PB_EXE=%%F"
if not defined PB_EXE (
    echo PocketBase executable not found.
    echo Put pocketbase.exe in the project root, .local\pocketbase, or PATH.
    exit /b 1
)

set "PB_PORT="
for /f "delims=" %%P in ('powershell -NoProfile -NonInteractive -Command "foreach ($p in 8090..8190) { try { $listener = [Net.Sockets.TcpListener]::new([Net.IPAddress]::Loopback, $p); $listener.Start(); $listener.Stop(); Write-Output $p; break } catch {} }"') do if not defined PB_PORT set "PB_PORT=%%P"
if not defined PB_PORT (
    echo No free local port found from 8090 through 8190.
    exit /b 1
)

echo PocketBase URL: http://127.0.0.1:%PB_PORT%
echo Set this URL in CueLearn's learning page if the port is not 8090.
"%PB_EXE%" serve --http="127.0.0.1:%PB_PORT%" --dir "pb_data" --migrationsDir "pb_migrations"
exit /b %ERRORLEVEL%
