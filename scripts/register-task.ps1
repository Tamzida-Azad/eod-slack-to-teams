# Registers Windows Scheduled Task: Slack #calysta-eod to Teams Calystapro EMR Web Dev
# Cadence: weekdays 11:30 PM local Asia/Dhaka (GMT+6)
# Message window: 12:00 PM – 11:20 PM that day
# StartWhenAvailable: catch-up when PC comes back; Node gatekeeper retries up to 10x / 10 min
# Backfill: every missed weekday (dated headers), then tonight's run still posts today's EOD

$ErrorActionPreference = 'Stop'

$taskName = 'SJ-EOD-Slack-To-Teams'
$projectRoot = Split-Path -Parent $PSScriptRoot
$batPath = Join-Path $PSScriptRoot 'run-daily.bat'

if (-not (Test-Path $batPath)) {
  throw "Missing runner: $batPath"
}

$profile = Join-Path (Split-Path -Parent $projectRoot) 'teams-slack-task-automation\browser-profile'
if (-not (Test-Path $profile)) {
  Write-Warning "Browser profile not found at $profile - sign in via teams-slack-task-automation first."
}

$action = New-ScheduledTaskAction -Execute $batPath -WorkingDirectory $projectRoot
$trigger = New-ScheduledTaskTrigger -Weekly -DaysOfWeek Monday,Tuesday,Wednesday,Thursday,Friday -At '11:30PM'
$settings = New-ScheduledTaskSettingsSet `
  -AllowStartIfOnBatteries `
  -DontStopIfGoingOnBatteries `
  -StartWhenAvailable `
  -MultipleInstances IgnoreNew `
  -ExecutionTimeLimit (New-TimeSpan -Hours 2)

$principal = New-ScheduledTaskPrincipal -UserId $env:USERNAME -LogonType Interactive -RunLevel Limited

$description = 'EOD Slack calysta-eod to Teams Calystapro EMR Web Dev. Weekdays 11:30 PM Asia/Dhaka GMT+6. No LLM.'

Register-ScheduledTask -TaskName $taskName -Action $action -Trigger $trigger -Settings $settings -Principal $principal -Description $description -Force | Out-Null

Write-Host "Scheduled task registered: $taskName"
Write-Host "Project:  $projectRoot"
Write-Host 'Schedule: Mon-Fri at 11:30 PM local Asia/Dhaka GMT+6'
Write-Host "Action:   $batPath"
Write-Host 'Missed:   StartWhenAvailable (one catch-up when PC comes on)'
Write-Host ''
Write-Host 'Useful commands:'
Write-Host "  Get-ScheduledTask -TaskName '$taskName' | Get-ScheduledTaskInfo"
Write-Host "  Start-ScheduledTask -TaskName '$taskName'"
Write-Host "  Unregister-ScheduledTask -TaskName '$taskName' -Confirm:`$false"
