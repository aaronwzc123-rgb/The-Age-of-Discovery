@echo off
setlocal
cd /d "%~dp0"
where node >nul 2>nul
if not errorlevel 1 goto :run
set "NODEDIR="
for /f "delims=" %%i in ('dir /b /ad "%USERPROFILE%\.workbuddy\binaries\node\versions" 2^>nul') do set "NODEDIR=%%i"
if not defined NODEDIR goto :missing
set "NODEEXE=%USERPROFILE%\.workbuddy\binaries\node\versions\%NODEDIR%\node.exe"
if not exist "%NODEEXE%" goto :missing
"%NODEEXE%" stopper.mjs
goto :done
:run
node stopper.mjs
:done
echo.
pause
exit /b 0
:missing
echo.
echo [X] Node.js runtime not found. Nothing was stopped.
pause
exit /b 1
