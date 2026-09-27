# Lists node/sleep/bash/cmd processes as "pid|name|parent|commandline", minus this one.
Get-CimInstance Win32_Process |
  Where-Object { $_.ProcessId -ne $PID -and $_.Name -in @('node.exe', 'sleep.exe', 'bash.exe', 'cmd.exe', 'pwsh.exe') } |
  ForEach-Object { "$($_.ProcessId)|$($_.Name)|$($_.ParentProcessId)|$($_.CommandLine)" }
