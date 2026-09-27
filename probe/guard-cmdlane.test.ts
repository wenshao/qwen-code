// The guard suite on a real win32 host with the Git Bash markers removed, so
// getShellConfiguration() picks cmd.exe. Used only to fingerprint skip counts.
for (const key of ['MSYSTEM', 'TERM'] as const) {
  delete process.env[key];
}
await import('./daemon-git-worktree-guard.test.js');
