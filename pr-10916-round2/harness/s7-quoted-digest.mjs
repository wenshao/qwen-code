// S7 — R4-2 in practice: three DIFFERENT failures (different message, different
// exit code) whose output happens to contain a line starting with the digest
// label (e.g. a script echoing a previously persisted tool-output stub). The
// consumer takes the FIRST line-anchored digest in the block, i.e. the quoted
// one, so the three failures fingerprint identically.
const Q = 'Full output sha256: ' + '0'.repeat(64);
const cmds = [
  `printf 'step 1\\n${Q}\\nerror: disk full\\n'; exit 1`,
  `printf 'step 1\\n${Q}\\nerror: permission denied on /var/lib/x\\n'; exit 2`,
  `printf 'step 1\\n${Q}\\nerror: network unreachable (10.0.0.7:443)\\n'; exit 3`,
  `printf 'step 1\\n${Q}\\nerror: out of memory\\n'; exit 4`,
];
export function respond({ step }) {
  const c = cmds[step];
  if (!c) return { content: 'DONE: four different failures.' };
  return { toolCalls: [{ id: `call_s7_${step}`, name: 'run_shell_command', args: { command: c, description: 'run the build step' } }] };
}
