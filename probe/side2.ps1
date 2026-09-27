# PR #12787 side probe 2: isolate why the bat wait-loop wedges. Watched PID is already dead in
# every arm, so a healthy loop must reach :proceed on its first iteration. Parents stay alive 70s.
$ErrorActionPreference = 'Continue'
$W = 'C:\side2'; New-Item -ItemType Directory -Force $W | Out-Null
$dead = node -e "console.log(require('child_process').spawnSync('cmd.exe',['/c','exit 0']).pid)"
function New-WaitBat($name) {
  $bat = "$W\$name.bat"
  $lines = @('@echo off', 'set /a TRIES=0', ':wait', 'set /a TRIES+=1',
    "echo iter=%TRIES% %TIME%>> `"$W\$name.progress.txt`"", 'if %TRIES% GTR 30 goto proceed',
    "tasklist /FI `"PID eq $dead`" 2>nul | find `"$dead`" >nul && (timeout /t 1 >nul & goto wait)",
    ':proceed', "echo proceed tries=%TRIES% %TIME%> `"$W\$name.end.txt`"")
  Set-Content $bat ($lines -join "`r`n") -NoNewline -Encoding ascii
  return $bat
}
$spawner = "$W\spawn.js"
Set-Content $spawner @'
const { spawn } = require('child_process');
const [bat, detached, hide, pidFile] = process.argv.slice(2);
const c = spawn('cmd.exe', ['/c', bat], { detached: detached === '1', stdio: 'ignore', windowsHide: hide === '1' });
require('fs').writeFileSync(pidFile, String(c.pid));
setTimeout(() => {}, 70000); // keep the parent alive so its lifetime is not a confound
'@
$arms = @(
  @{ n='P1-product-detached-ignore-hide'; d='1'; h='1' },
  @{ n='P2-detached-ignore-nohide';       d='1'; h='0' },
  @{ n='P3-notdetached-ignore-hide';      d='0'; h='1' }
)
foreach ($a in $arms) {
  $bat = New-WaitBat $a.n
  Start-Process -FilePath node -ArgumentList "`"$spawner`" `"$bat`" $($a.d) $($a.h) `"$W\$($a.n).pid`"" -WindowStyle Hidden | Out-Null
}
# C1 control: same bat started by PowerShell with its own (hidden) console
$c1 = New-WaitBat 'C1-startprocess-console'
$c1p = Start-Process -FilePath cmd.exe -ArgumentList '/c', "`"$c1`"" -WindowStyle Hidden -PassThru
Set-Content "$W\C1-startprocess-console.pid" $c1p.Id
Start-Sleep -Seconds 45
Write-Host "== snapshot at +45s (watched pid $dead is dead in every arm)"
foreach ($n in @($arms.n) + 'C1-startprocess-console') {
  $cpid = if (Test-Path "$W\$n.pid") { (Get-Content "$W\$n.pid").Trim() } else { '' }
  $alive = if ($cpid) { [bool](Get-CimInstance Win32_Process -Filter "ProcessId=$cpid") } else { $false }
  $kids = if ($cpid) { (Get-CimInstance Win32_Process -Filter "ParentProcessId=$cpid" | ForEach-Object { "$($_.Name)[$($_.ProcessId)]" }) -join ',' } else { '' }
  $prog = if (Test-Path "$W\$n.progress.txt") { @(Get-Content "$W\$n.progress.txt").Count } else { 0 }
  $end = if (Test-Path "$W\$n.end.txt") { (Get-Content "$W\$n.end.txt") } else { '(not reached)' }
  Write-Host ("SIDE_JSON " + (@{ arm=$n; batPid=$cpid; batAlive=$alive; children=$kids; iterations=$prog; proceed=$end } | ConvertTo-Json -Compress))
  if ($cpid) { taskkill /T /F /PID $cpid 2>&1 | Out-Null }
}
New-Item -ItemType Directory -Force "$env:GITHUB_WORKSPACE\probe-out" | Out-Null
Copy-Item "$W\*.txt" "$env:GITHUB_WORKSPACE\probe-out\" -ErrorAction SilentlyContinue
exit 0
