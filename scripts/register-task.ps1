# Registers Windows Scheduled Task: Slack EOD channel -> Teams (see .env)
# Cadence: weekdays 11:30 PM local Asia/Dhaka (GMT+6), plus recovery every 10 min
# through ~1:20 AM so a mid-post kill (0x41306) gets a fresh run that re-posts.
# Message window: 12:00 PM - 11:20 PM that day
# StartWhenAvailable: catch-up when PC comes back; Node gatekeeper retries up to 10x / 10 min
# Backfill: every missed weekday (dated headers), then tonight's run still posts today's EOD

$ErrorActionPreference = 'Stop'

$taskName = 'SJ-EOD-Slack-To-Teams'
$projectRoot = Split-Path -Parent $PSScriptRoot
$batPath = Join-Path $PSScriptRoot 'run-daily.bat'

if (-not (Test-Path $batPath)) {
  throw "Missing runner: $batPath"
}

$envFile = Join-Path $projectRoot '.env'
if (-not (Test-Path $envFile)) {
  Write-Warning "Missing .env - copy .env.example and set EOD_BROWSER_PROFILE_DIR before scheduling."
}

$action = New-ScheduledTaskAction -Execute $batPath -WorkingDirectory $projectRoot

# Primary night window (Mon-Fri): 11:30, 11:40, 11:50
# If the first run is still alive (gatekeeper sleeping), MultipleInstances IgnoreNew skips these.
# If Windows killed the process mid-Teams-post, the next slot starts a fresh catch-up.
$triggers = @(
  (New-ScheduledTaskTrigger -Weekly -DaysOfWeek Monday,Tuesday,Wednesday,Thursday,Friday -At '11:30PM'),
  (New-ScheduledTaskTrigger -Weekly -DaysOfWeek Monday,Tuesday,Wednesday,Thursday,Friday -At '11:40PM'),
  (New-ScheduledTaskTrigger -Weekly -DaysOfWeek Monday,Tuesday,Wednesday,Thursday,Friday -At '11:50PM')
)

# After-midnight continuation for Mon-Fri nights -> Tue-Sat early morning (00:00-01:20)
foreach ($m in 0, 10, 20, 30, 40, 50) {
  $at = '{0:d2}:{1:d2}' -f 0, $m
  $triggers += New-ScheduledTaskTrigger -Weekly -DaysOfWeek Tuesday,Wednesday,Thursday,Friday,Saturday -At $at
}
foreach ($m in 0, 10, 20) {
  $at = '{0:d2}:{1:d2}' -f 1, $m
  $triggers += New-ScheduledTaskTrigger -Weekly -DaysOfWeek Tuesday,Wednesday,Thursday,Friday,Saturday -At $at
}

$settings = New-ScheduledTaskSettingsSet `
  -AllowStartIfOnBatteries `
  -DontStopIfGoingOnBatteries `
  -StartWhenAvailable `
  -MultipleInstances IgnoreNew `
  -ExecutionTimeLimit (New-TimeSpan -Hours 3)

$principal = New-ScheduledTaskPrincipal -UserId $env:USERNAME -LogonType Interactive -RunLevel Limited

$description = 'EOD Slack to Teams digest. Weekdays 11:30 PM + 10-min recovery through 1:20 AM. Configure channels in .env.'

Register-ScheduledTask -TaskName $taskName -Action $action -Trigger $triggers -Settings $settings -Principal $principal -Description $description -Force | Out-Null

Write-Host "Scheduled task registered: $taskName"
Write-Host "Project:  $projectRoot"
Write-Host 'Schedule: Mon-Fri 11:30/11:40/11:50 PM; Tue-Sat 12:00-1:20 AM every 10 min (recovery)'
Write-Host "Action:   $batPath"
Write-Host 'Missed:   StartWhenAvailable + recovery slots (IgnoreNew while gatekeeper still running)'
Write-Host 'Limit:    3 hours (covers scrape/post + 10x10 min in-process retries)'
Write-Host ''
Write-Host 'Useful commands:'
Write-Host "  Get-ScheduledTask -TaskName '$taskName' | Get-ScheduledTaskInfo"
Write-Host "  Start-ScheduledTask -TaskName '$taskName'"
Write-Host "  Unregister-ScheduledTask -TaskName '$taskName' -Confirm:`$false"
