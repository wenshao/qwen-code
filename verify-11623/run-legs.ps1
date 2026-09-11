param([string]$Label)
$ErrorActionPreference = 'Continue'
$dist = Join-Path $PWD 'packages\core\dist'
foreach ($scenario in @('nofault', 'denied', 'deny-all', 'supervisor-gone')) {
  $env:CORE_DIST = $dist
  $env:SCENARIO = $scenario
  $env:FAKE_WIN_ROOT = "$env:RUNNER_TEMP\fakewin"
  $env:TASKKILL_LOG = "$env:RUNNER_TEMP\taskkill-$Label-$scenario.log"
  $env:DENY_NAME = ''
  if ($scenario -eq 'denied') { $env:DENY_NAME = 'node' }
  if ($scenario -eq 'deny-all') { $env:DENY_NAME = '*' }
  Remove-Item $env:TASKKILL_LOG -ErrorAction SilentlyContinue
  Write-Host "############ build=$Label scenario=$scenario ############"
  $out = & node verify-11623\drive-win.mjs 2>&1 | Out-String
  Write-Host $out
  $out | Out-File -FilePath "$env:RUNNER_TEMP\e2e-$Label-$scenario.log" -Encoding utf8
  $verdict = ($out -split "`n" | Where-Object { $_ -match '^VERDICT' }) -join ' '
  "$Label`t$scenario`t$verdict" | Out-File -FilePath "$env:RUNNER_TEMP\verdicts.txt" -Append -Encoding utf8
}
