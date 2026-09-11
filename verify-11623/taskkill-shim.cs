using System;
using System.Diagnostics;
using System.IO;
using System.Text;

// Shim for %SystemRoot%\System32\taskkill.exe used only by the PR #11623
// verification driver: logs every call, optionally injects
// ERROR_ACCESS_DENIED, and otherwise forwards to the real taskkill.
class Shim {
  static int Main(string[] args) {
    string log = Environment.GetEnvironmentVariable("TASKKILL_LOG");
    string deny = Environment.GetEnvironmentVariable("DENY_NAME") ?? "";
    string pid = "";
    for (int i = 0; i < args.Length; i++) {
      if (string.Equals(args[i], "/pid", StringComparison.OrdinalIgnoreCase) && i + 1 < args.Length) pid = args[i + 1];
    }
    string pname = "(gone)";
    try { pname = Process.GetProcessById(int.Parse(pid)).ProcessName; } catch { }
    string joined = string.Join(" ", args);

    if (deny.Length > 0 && (deny == "*" || string.Equals(pname, deny, StringComparison.OrdinalIgnoreCase))) {
      Write(log, joined + "  (" + pname + ")  -> ERROR_ACCESS_DENIED (injected)");
      Console.Error.WriteLine("ERROR: The process with PID " + pid + " could not be terminated. Reason: Access is denied.");
      return 1;
    }

    var psi = new ProcessStartInfo(@"C:\Windows\System32\taskkill.exe");
    var sb = new StringBuilder();
    foreach (var a in args) { sb.Append('"').Append(a).Append("\" "); }
    psi.Arguments = sb.ToString();
    psi.UseShellExecute = false;
    psi.RedirectStandardOutput = true;
    psi.RedirectStandardError = true;
    var p = Process.Start(psi);
    string so = p.StandardOutput.ReadToEnd();
    string se = p.StandardError.ReadToEnd();
    p.WaitForExit();
    Console.Write(so);
    Console.Error.Write(se);
    Write(log, joined + "  (" + pname + ")  -> real taskkill exit=" + p.ExitCode + "  " + (so + se).Replace("\r", " ").Replace("\n", " ").Trim());
    return p.ExitCode;
  }

  static void Write(string log, string line) {
    if (string.IsNullOrEmpty(log)) return;
    try { File.AppendAllText(log, DateTime.Now.ToString("HH:mm:ss.fff") + "  taskkill " + line + Environment.NewLine); } catch { }
  }
}
