# PR #12787 Windows real-machine probe driver (GitHub-hosted windows-2022).
$ErrorActionPreference = 'Continue'
$P = 'C:\probe'
New-Item -ItemType Directory -Force $P, "$P\out", "$P\work", "$P\work-low", "$P\work-std" | Out-Null
Copy-Item "$PSScriptRoot\*.mjs" $P
icacls $P /grant '*S-1-1-0:(OI)(CI)F' /T /Q | Out-Null
icacls "$P\work" /setintegritylevel '(OI)(CI)M' /Q | Out-Null
icacls "$P\work-low" /setintegritylevel '(OI)(CI)L' /Q | Out-Null
icacls "$P\out" /setintegritylevel '(OI)(CI)L' /Q | Out-Null
$node = (Get-Command node).Source
Write-Host "node=$node $(node -v)"

Write-Host '== runner token'
whoami
whoami /groups /fo csv /nh | Select-String 'Mandatory Label|S-1-5-32-544'
reg query 'HKLM\SOFTWARE\Microsoft\Windows\CurrentVersion\Policies\System' /v EnableLUA
reg query 'HKLM\SOFTWARE\Microsoft\Windows\CurrentVersion\Policies\System' /v ConsentPromptBehaviorAdmin
[System.Environment]::OSVersion.VersionString

# 1. The "bat": spawned exactly the way atomicReplace() spawns qwen-update.bat,
#    from this (runner) token. It records its own token, then idles ~15 min.
$bat = "$P\qwen-update.bat"
Set-Content $bat "@echo off`r`nwhoami /groups /fo csv /nh > `"$P\out\bat-groups.txt`"`r`nping -n 900 127.0.0.1 >nul`r`n" -NoNewline -Encoding ascii
node -e "const {spawn}=require('child_process');const c=spawn('cmd.exe',['/c',process.argv[1]],{detached:true,stdio:'ignore',windowsHide:true});c.unref();require('fs').writeFileSync(process.argv[2],String(c.pid));" $bat "$P\batpid.txt"
$batPid = (Get-Content "$P\batpid.txt").Trim()
Start-Sleep -Seconds 2
Write-Host "== bat pid=$batPid"
Get-CimInstance Win32_Process -Filter "ProcessId=$batPid" | Format-List ProcessId,Name,CommandLine
Get-Content "$P\out\bat-groups.txt" | Select-String 'Mandatory Label|S-1-5-32-544'

# 2. Dead-PID control
$deadPid = node -e "const r=require('child_process').spawnSync('cmd.exe',['/c','exit 0']);console.log(r.pid)"
Write-Host "== dead pid=$deadPid"

# 3a. same token as the bat
node "$P\probe.mjs" same-token $batPid "$P\work" "$P\out\same-token.txt"
# 3b. dead control
node "$P\probe.mjs" dead-pid $deadPid "$P\work" "$P\out\dead-pid.txt"

# 3c/3d. same user, token duplicated and lowered to Medium / Low integrity
Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
public static class IlLauncher {
  [StructLayout(LayoutKind.Sequential)] public struct SID_AND_ATTRIBUTES { public IntPtr Sid; public uint Attributes; }
  [StructLayout(LayoutKind.Sequential)] public struct TOKEN_MANDATORY_LABEL { public SID_AND_ATTRIBUTES Label; }
  [StructLayout(LayoutKind.Sequential, CharSet=CharSet.Unicode)] public struct STARTUPINFO {
    public int cb; public string lpReserved; public string lpDesktop; public string lpTitle;
    public int dwX, dwY, dwXSize, dwYSize, dwXCountChars, dwYCountChars, dwFillAttribute, dwFlags;
    public short wShowWindow, cbReserved2; public IntPtr lpReserved2, hStdInput, hStdOutput, hStdError; }
  [StructLayout(LayoutKind.Sequential)] public struct PROCESS_INFORMATION { public IntPtr hProcess, hThread; public int dwProcessId, dwThreadId; }
  [DllImport("advapi32.dll", SetLastError=true)] static extern bool OpenProcessToken(IntPtr h, uint acc, out IntPtr tok);
  [DllImport("advapi32.dll", SetLastError=true)] static extern bool DuplicateTokenEx(IntPtr tok, uint acc, IntPtr sa, int imp, int type, out IntPtr newTok);
  [DllImport("advapi32.dll", SetLastError=true, CharSet=CharSet.Unicode)] static extern bool ConvertStringSidToSid(string sid, out IntPtr psid);
  [DllImport("advapi32.dll", SetLastError=true)] static extern bool SetTokenInformation(IntPtr tok, int cls, ref TOKEN_MANDATORY_LABEL tml, int len);
  [DllImport("advapi32.dll")] static extern int GetLengthSid(IntPtr sid);
  [DllImport("advapi32.dll", SetLastError=true, CharSet=CharSet.Unicode)] static extern bool CreateProcessAsUser(IntPtr tok, string app, string cmd, IntPtr pa, IntPtr ta, bool inherit, uint flags, IntPtr env, string cwd, ref STARTUPINFO si, out PROCESS_INFORMATION pi);
  [DllImport("advapi32.dll", SetLastError=true, CharSet=CharSet.Unicode)] static extern bool CreateProcessWithTokenW(IntPtr tok, uint logon, string app, string cmd, uint flags, IntPtr env, string cwd, ref STARTUPINFO si, out PROCESS_INFORMATION pi);
  [DllImport("kernel32.dll")] static extern IntPtr GetCurrentProcess();
  [DllImport("kernel32.dll")] static extern uint WaitForSingleObject(IntPtr h, uint ms);
  [DllImport("kernel32.dll")] static extern bool GetExitCodeProcess(IntPtr h, out uint code);
  public static string Run(string cmdline, string ilSid) {
    IntPtr tok, dup, sid;
    if (!OpenProcessToken(GetCurrentProcess(), 0x02000000, out tok)) return "OpenProcessToken err " + Marshal.GetLastWin32Error();
    if (!DuplicateTokenEx(tok, 0x02000000, IntPtr.Zero, 2, 1, out dup)) return "DuplicateTokenEx err " + Marshal.GetLastWin32Error();
    if (!ConvertStringSidToSid(ilSid, out sid)) return "ConvertStringSidToSid err " + Marshal.GetLastWin32Error();
    var tml = new TOKEN_MANDATORY_LABEL(); tml.Label.Sid = sid; tml.Label.Attributes = 0x20;
    if (!SetTokenInformation(dup, 25, ref tml, Marshal.SizeOf(tml) + GetLengthSid(sid))) return "SetTokenInformation err " + Marshal.GetLastWin32Error();
    var si = new STARTUPINFO(); si.cb = Marshal.SizeOf(si);
    PROCESS_INFORMATION pi; string how = "CreateProcessAsUser";
    if (!CreateProcessAsUser(dup, null, cmdline, IntPtr.Zero, IntPtr.Zero, false, 0x08000000, IntPtr.Zero, null, ref si, out pi)) {
      int e1 = Marshal.GetLastWin32Error(); how = "CreateProcessWithTokenW (CreateProcessAsUser err " + e1 + ")";
      if (!CreateProcessWithTokenW(dup, 0, null, cmdline, 0x08000000, IntPtr.Zero, null, ref si, out pi)) return how + " err " + Marshal.GetLastWin32Error();
    }
    WaitForSingleObject(pi.hProcess, 600000);
    uint code; GetExitCodeProcess(pi.hProcess, out code);
    return how + " pid=" + pi.dwProcessId + " exit=" + code;
  }
}
'@
Write-Host '== medium-IL launch:' ([IlLauncher]::Run("`"$node`" `"$P\probe.mjs`" medium-il $batPid `"$P\work`" `"$P\out\medium-il.txt`"", 'S-1-16-8192'))
Write-Host '== low-IL launch:' ([IlLauncher]::Run("`"$node`" `"$P\probe.mjs`" low-il $batPid `"$P\work-low`" `"$P\out\low-il.txt`"", 'S-1-16-4096'))

# 3e. a different, non-admin local user
$pw = 'Pr12787-' + [guid]::NewGuid().ToString('N').Substring(0, 12) + '!a'
net user probeuser $pw /add /y | Out-Null
$cred = New-Object System.Management.Automation.PSCredential('probeuser', (ConvertTo-SecureString $pw -AsPlainText -Force))
try {
  $p = Start-Process -FilePath $node -ArgumentList "`"$P\probe.mjs`" std-user $batPid `"$P\work-std`" `"$P\out\std-user.txt`"" -Credential $cred -WorkingDirectory $P -WindowStyle Hidden -PassThru -Wait
  Write-Host "== std-user exit=$($p.ExitCode)"
} catch { Write-Host "== std-user launch failed: $_" }

# 4. Side measurement: how long the real bat wait-loop idles when stdin is NUL
#    (atomicReplace spawns it with stdio:'ignore'); waits on the live bat PID.
$wait = "$P\wait-loop.bat"
$lines = @(
  '@echo off', 'set /a TRIES=0', ':wait', 'set /a TRIES+=1', 'if %TRIES% GTR 30 goto proceed',
  "tasklist /FI `"PID eq $batPid`" 2>nul | find `"$batPid`" >nul && (timeout /t 1 >nul & goto wait)",
  ':proceed', "echo tries=%TRIES% > `"$P\out\wait-end.txt`"")
Set-Content $wait ($lines -join "`r`n") -NoNewline -Encoding ascii
node -e "const {spawn}=require('child_process');const fs=require('fs');const t0=Date.now();const c=spawn('cmd.exe',['/c',process.argv[1]],{detached:true,stdio:'ignore',windowsHide:true});c.on('exit',()=>{console.log('PROBE_WAITLOOP '+JSON.stringify({ms:Date.now()-t0,end:fs.existsSync(process.argv[2])?fs.readFileSync(process.argv[2],'utf8').trim():null}))});" $wait "$P\out\wait-end.txt"

Write-Host '== bat still alive?'
Get-CimInstance Win32_Process -Filter "ProcessId=$batPid" | Select-Object ProcessId,Name
Write-Host '== results'
Get-ChildItem "$P\out" | ForEach-Object { Write-Host "-- $($_.Name)"; Get-Content $_.FullName }
