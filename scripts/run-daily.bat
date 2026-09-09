@echo off
setlocal
cd /d "%~dp0.."
if not exist "logs" mkdir logs

set "NODE_EXE=C:\Program Files\nodejs\node.exe"
if not exist "%NODE_EXE%" set "NODE_EXE=node"

echo [%DATE% %TIME%] Starting EOD Slack-to-Teams run>> "logs\scheduler.log"
"%NODE_EXE%" -v >> "logs\scheduler.log" 2>&1
"%NODE_EXE%" ".\src\run-daily.js" >> "logs\scheduler.log" 2>&1
set EXITCODE=%ERRORLEVEL%
if not %EXITCODE%==0 (
  echo [%DATE% %TIME%] FAILED exit %EXITCODE%>> "logs\scheduler.log"
) else (
  echo [%DATE% %TIME%] SUCCESS>> "logs\scheduler.log"
)
exit /b %EXITCODE%
