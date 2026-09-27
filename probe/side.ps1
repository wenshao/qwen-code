# PR #12787 side probe: does the product's qwen-update.bat wait-loop progress when spawned the
# way atomicReplace() spawns it (detached, stdio:'ignore', windowsHide)? Four arms, bounded.
$ErrorActionPreference = 'Continue'
$W = 'C:\side'; New-Item -ItemType Directory -Force $W | Out-Null
function New-WaitBat($name, $watchPid) {
  $bat = "$W\$name.bat"
  $lines = @('@echo off', 'set /a TRIES=0', ':wait', 'set /a TRIES+=1',
    "echo iter=%TRIES% %TIME%>> `"$W\$name.progress.txt`"", 'if %TRIES% GTR 30 goto proceed',
    "tasklist /FI `"PID eq $watchPid`" 2>nul | find `"$watchPid`" >nul && (timeout /t 1 >nul & goto wait)",
    ':proceed', "echo proceed tries=%TRIES% %TIME%> `"$W\$name.end.txt`"")
  Set-Content $bat ($lines -join "`r`n") -NoNewline -Encoding ascii
  return $bat
}
function Start-Bat($bat, $detached) {
  node -e "const {spawn}=require('child_process');const c=spawn('cmd.exe',['/c',process.argv[1]],{detached:process.argv[2]==='1',stdio:'ignore',windowsHide:true});c.unref();console.log(c.pid);process.exit(0)" $bat $detached
}
# watched processes
$live = Start-Process -FilePath ping -ArgumentList '-n 600 127.0.0.1' -WindowStyle Hidden -PassThru
$short = Start-Process -FilePath ping -ArgumentList '-n 16 127.0.0.1' -WindowStyle Hidden -PassThru   # exits after ~15s
$dead = node -e "console.log(require('child_process').spawnSync('cmd.exe',['/c','exit 0']).pid)"
Write-Host "watch: live=$($live.Id) short=$($short.Id) dead=$dead"
$t0 = Get-Date
$arms = @(
  @{ n='W1-product-live';     w=$live.Id;  d='1' },
  @{ n='W2-product-exits15s'; w=$short.Id; d='1' },
  @{ n='W3-product-deadpid';  w=$dead;     d='1' },
  @{ n='W4-notdetached-live'; w=$live.Id;  d='0' }
)
foreach ($a in $arms) { $a.pid = (Start-Bat (New-WaitBat $a.n $a.w) $a.d).Trim(); Write-Host "$($a.n) cmd pid=$($a.pid)" }
Start-Sleep -Seconds 60
Write-Host "== snapshot at +$([int]((Get-Date)-$t0).TotalSeconds)s"
foreach ($a in $arms) {
  $alive = [bool](Get-CimInstance Win32_Process -Filter "ProcessId=$($a.pid)")
  $kids = (Get-CimInstance Win32_Process -Filter "ParentProcessId=$($a.pid)" | ForEach-Object { "$($_.Name)[$($_.ProcessId)]" }) -join ','
  $prog = if (Test-Path "$W\$($a.n).progress.txt") { (Get-Content "$W\$($a.n).progress.txt").Count } else { 0 }
  $last = if (Test-Path "$W\$($a.n).progress.txt") { (Get-Content "$W\$($a.n).progress.txt" | Select-Object -Last 1) } else { '-' }
  $end = if (Test-Path "$W\$($a.n).end.txt") { (Get-Content "$W\$($a.n).end.txt") } else { '(not reached)' }
  $line = "SIDE_JSON " + (@{ arm=$a.n; detached=$a.d; watched=$a.w; batAlive=$alive; children=$kids; iterations=$prog; lastIter=$last; proceed=$end } | ConvertTo-Json -Compress)
  Write-Host $line
  taskkill /T /F /PID $a.pid 2>&1 | Out-Null
}
Stop-Process -Id $live.Id -Force -ErrorAction SilentlyContinue
New-Item -ItemType Directory -Force "$env:GITHUB_WORKSPACE\probe-out" | Out-Null
Copy-Item "$W\*.txt" "$env:GITHUB_WORKSPACE\probe-out\" -ErrorAction SilentlyContinue
