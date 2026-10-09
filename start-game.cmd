@echo off
setlocal
cd /d "%~dp0"
where node >nul 2>nul
if not errorlevel 1 goto :path
set "TASKNODE=%USERPROFILE%\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe"
if exist "%TASKNODE%" goto :runtime
set "TASKNODE=C:\Program Files\nodejs\node.exe"
if exist "%TASKNODE%" goto :runtime
for /f "delims=" %%i in ('dir /b /ad "%USERPROFILE%\.workbuddy\binaries\node\versions" 2^>nul') do if exist "%USERPROFILE%\.workbuddy\binaries\node\versions\%%i\node.exe" set "TASKNODE=%USERPROFILE%\.workbuddy\binaries\node\versions\%%i\node.exe"
if exist "%TASKNODE%" goto :runtime
echo Node.js runtime was not found. Please install Node.js 18 or newer.
pause
exit /b 1
:path
node launcher.mjs %*
goto :done
:runtime
"%TASKNODE%" launcher.mjs %*
:done
if errorlevel 1 pause
exit /b %errorlevel%
