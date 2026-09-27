// Writes one arm of managed-context-worker.test.ts (and, for mutant arms, one
// mutant of the worker). Usage: node probe/transform.mjs <arm> <repeats>
//   base-full / head-full   the test file at the merge base / PR head
//   base-repeat             base file, its release test repeated
//   head-repeat             head file, both changed tests repeated (the
//                           directory-loss test keeps its skip condition)
//   probe                   head file plus measuring probes (never assert)
//   <base|head>-M1          release allowed while an invocation is active
//   <base|head>-M2          cancel marks cancel_requested without abort()
//   <base|head>-M3          status/cancel answer `unknown` once the call's
//                           directory is gone
// Every replacement must land exactly as often as expected, or exit 1.
import fs from 'node:fs';

const [arm, repeatsArg = '20'] = process.argv.slice(2);
const repeats = Number(repeatsArg);
const TARGET = 'packages/cli/src/serve/managed-context-worker.test.ts';
const ITER = `Array.from({ length: ${repeats} }, (_, i) => i)`;

function replaceN(text, from, to, n = 1) {
  const count = text.split(from).length - 1;
  if (count !== n) {
    console.error(`TRANSFORM_FAILED ${arm}: expected ${n} match(es), found ${count}: ${from.slice(0, 90)}`);
    process.exit(1);
  }
  return text.split(from).join(to);
}
function mutate(file, from, to, n = 1) {
  fs.writeFileSync(file, replaceN(fs.readFileSync(file, 'utf8'), from, to, n));
  console.log(`MUTANT_APPLIED ${file}`);
}

const base = fs.readFileSync('probe/base.test.ts', 'utf8');
const head = fs.readFileSync('probe/head.test.ts', 'utf8');
const RELEASE = "  it('refuses release while an invocation is active, and allows it once the invocation settles', async () => {";
const HEAD_DIRLOSS = "  )(\n    'retains status and cancel for an active invocation after its directory is lost',";
const ANCHOR = "  it('rechecks a closed gate after an asynchronous tool resolver returns'";
const RETURN = '    return { root, status, cancel, release };';

const PROBES = `  // --- PR 12818 probes: measure, never assert ---
  const PROBE_OLD =
    'echo started > started.txt && sleep 30 # intentional-sleep: in-flight release test';
  const PROBE_DIRLOSS = 'echo started > started.txt && sleep 30';
  function probeProcesses() {
    const cp = process.getBuiltinModule(
      'node:child_process',
    ) as typeof import('node:child_process');
    let lines: string[] = [];
    try {
      lines =
        process.platform === 'win32'
          ? cp
              .execFileSync(
                'powershell.exe',
                ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', path.resolve(process.cwd(), '../../probe/procs.ps1')],
                { encoding: 'utf8', timeout: 30_000 },
              )
              .split(/\\r?\\n/)
          : cp.execFileSync('ps', ['-axo', 'pid=,command='], { encoding: 'utf8' }).split('\\n');
    } catch (error) {
      return { error: String(error).slice(0, 200) };
    }
    const timers = lines.filter((l) => l.includes('setTimeout(String, 30000)'));
    const sleeps = lines.filter((l) => /\\|sleep\\.exe\\|/i.test(l) || /^\\s*\\d+\\s+sleep 30\\s*$/.test(l));
    return { timers: timers.length, sleeps: sleeps.length, sample: [...timers, ...sleeps].slice(0, 4).map((l) => l.trim().slice(0, 160)) };
  }

  it.each([
    ...Array.from({ length: 3 }, (_, i) => ({ label: 'old-sleep-hash', command: PROBE_OLD, i })),
    ...Array.from({ length: 3 }, (_, i) => ({ label: 'new-node-timer', command: WAIT_30_SECONDS, i })),
    ...Array.from({ length: 3 }, (_, i) => ({ label: 'new-dirloss-sleep', command: PROBE_DIRLOSS, i })),
  ])('PROBE lifetime $label #$i', async ({ label, command }) => {
    const shellUtils = await import('@qwen-code/qwen-code-core/utils/shell-utils.js');
    const { root, status, cancel, running } = await startSlowCall(command);
    const t0 = performance.now();
    let endedMs: number | null = null;
    let during: unknown = null;
    while (performance.now() - t0 < 3_000) {
      if ((await status()) === 'settled') {
        endedMs = Math.round(performance.now() - t0);
        break;
      }
      if (during === null && performance.now() - t0 > 1_500) during = probeProcesses();
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    let cancelMs: number | null = null;
    let cancelOutcome = 'not-needed';
    let output = '';
    if (endedMs === null) {
      const tc = performance.now();
      try {
        await cancel();
        cancelOutcome = 'ok';
      } catch (error) {
        cancelOutcome = String((error as Error).message).split('\\n')[0].slice(0, 200);
      }
      cancelMs = Math.round(performance.now() - tc);
    } else {
      output = JSON.stringify((await (await running).json()).result).slice(0, 300);
    }
    await new Promise((resolve) => setTimeout(resolve, 1_000));
    const config = shellUtils.getShellConfiguration();
    console.log('PROBE_JSON ' + JSON.stringify({
      probe: 'lifetime', label,
      shell: config.shell, executable: config.executable,
      nodePty: shellUtils.shouldDefaultToNodePty(), osRelease: os.release(),
      env: { MSYSTEM: process.env['MSYSTEM'] ?? null, TERM: process.env['TERM'] ?? null, ComSpec: process.env['ComSpec'] ?? null },
      marker: fs.existsSync(path.join(root, 'child', 'started.txt')),
      endedMs, output, during, cancelOutcome, cancelMs, after: probeProcesses(),
    }));
  }, 60_000);

  it.each(${ITER})('PROBE rename attempts #%i', async () => {
    if (process.platform === 'win32' && getShellConfiguration().shell !== 'bash') {
      console.log('PROBE_JSON ' + JSON.stringify({ probe: 'rename', skipped: getShellConfiguration().shell }));
      return;
    }
    const { root, status, cancel } = await startSlowCall(PROBE_DIRLOSS);
    const t0 = performance.now();
    await vi.waitFor(
      () => {
        expect(fs.existsSync(path.join(root, 'child', 'started.txt'))).toBe(true);
      },
      { timeout: 10_000, interval: 5 },
    );
    const markerMs = Math.round(performance.now() - t0);
    const codes: string[] = [];
    let renamed = false;
    const tr = performance.now();
    while (performance.now() - tr < 3_000) {
      try {
        fs.renameSync(path.join(root, 'child'), path.join(root, 'moved'));
        renamed = true;
        break;
      } catch (error) {
        codes.push((error as NodeJS.ErrnoException).code ?? 'ERR');
        await new Promise((resolve) => setTimeout(resolve, 50));
      }
    }
    const renameMs = Math.round(performance.now() - tr);
    const after = await status();
    let cancelOutcome = 'ok';
    try {
      await cancel();
    } catch (error) {
      cancelOutcome = String((error as Error).message).split('\\n')[0].slice(0, 200);
    }
    console.log('PROBE_JSON ' + JSON.stringify({
      probe: 'rename', markerMs, renamed, failedAttempts: codes.length,
      codes: [...new Set(codes)], renameMs, after, cancelOutcome,
    }));
  }, 60_000);

`;


const QUOTING = `  it('PROBE quoting through the Shell tool', async () => {
    const root = workspace();
    fs.mkdirSync(path.join(root, 'child'));
    const origin = await startWorker({ ...BOOT, mountRoot: root, capabilityDigest: WORKSPACE_CAPABILITY_DIGEST });
    const request = fixedInstallation('quoting-session', 'child');
    expect((await post(origin, CONTEXT, request)).status).toBe(200);
    expect((await post(origin, ACTIVATION, activation(request))).status).toBe(200);
    const node = process.execPath;
    const cases = [
      ['q1 starts+ends with "', \`"\${node}" -e "console.log(1+1)"\`],
      ['q2 ends without "', \`"\${node}" -e "console.log(1+2)" && echo tail\`],
      ['q3 starts without "', \`echo head && "\${node}" -e "console.log(1+3)"\`],
      ['q4 single quotes', \`'\${node}' -e 'console.log(1+4)'\`],
      ['q5 all args quoted', \`"\${node}" "-p" "6"\`],
    ];
    for (const [label, command] of cases) {
      const body = await (await post(origin, EXECUTE, shell(request.sessionId, label.slice(0, 2), command))).json();
      const text = JSON.stringify(body.result?.responseParts ?? body).replace(/\\\\\\\\/g, '\\\\');
      console.log('PROBE_JSON ' + JSON.stringify({ probe: 'quoting', label, shell: getShellConfiguration().shell, status: body.result?.executionStatus, command, text: text.slice(0, 900) }));
    }
  }, 60_000);

`;

let out;
const [file, mutant] = arm.split('-');
switch (arm) {
  case 'base-full':
    out = base;
    break;
  case 'head-full':
    out = head;
    break;
  case 'base-repeat':
    out = replaceN(base, RELEASE, RELEASE.replace("it('", `it.each(${ITER})('`).replace("', async", " #%i', async"));
    break;
  case 'head-repeat':
    out = replaceN(head, RELEASE, RELEASE.replace("it('", `it.each(${ITER})('`).replace("', async", " #%i', async"));
    out = replaceN(out, HEAD_DIRLOSS, HEAD_DIRLOSS.replace('  )(', `  ).each(${ITER})(`).replace("lost',", "lost #%i',"));
    break;
  case 'quoting':
    out = replaceN(head, ANCHOR, QUOTING + ANCHOR);
    break;
  case 'probe':
    out = replaceN(head, ANCHOR, PROBES + ANCHOR);
    out = replaceN(out, RETURN, '    return { root, status, cancel, release, running };');
    break;
  default:
    if (!['base', 'head'].includes(file) || !['M1', 'M2', 'M3'].includes(mutant)) {
      console.error(`TRANSFORM_FAILED unknown arm ${arm}`);
      process.exit(1);
    }
    out = file === 'base' ? base : head;
    if (mutant === 'M1') {
      mutate(
        'packages/cli/src/serve/managed-workspace-activation.ts',
        '(!active && executor.hasActiveSession(sessionId))',
        '(!active && false)',
      );
    } else if (mutant === 'M2') {
      mutate(
        'packages/cli/src/serve/managed-runtime-tool-executor.ts',
        "      entry.state = 'cancel_requested';\n      entry.lastSequence += 1;\n      entry.controller.abort();\n",
        "      entry.state = 'cancel_requested';\n      entry.lastSequence += 1;\n",
      );
    } else {
      const EXECUTOR = 'packages/cli/src/serve/managed-runtime-tool-executor.ts';
      mutate(
        EXECUTOR,
        '    this.entries.set(reference.callId, entry);\n',
        '    this.entries.set(reference.callId, entry);\n    (entry as any).probeDir = (tool as any).config?.getTargetDir?.();\n',
      );
      mutate(
        EXECUTOR,
        '    if (!entry || !sameReference(entry.reference, reference)) {\n',
        "    if (!entry || !sameReference(entry.reference, reference) || ((entry as any).probeDir && !(process.getBuiltinModule('node:fs') as typeof import('node:fs')).existsSync((entry as any).probeDir))) {\n",
        2,
      );
    }
}
// PROBE_FIX swaps in a candidate WAIT_30_SECONDS (A3: per-shell quoting;
// A4: a leading command so the string does not start with a quote).
const WAIT_DEF = '  const WAIT_30_SECONDS = `"${process.execPath}" -e "setTimeout(String, 30000)"`;';
const FIXES = {
  A3: "  const WAIT_30_SECONDS =\n    getShellConfiguration().shell === 'cmd'\n      ? `\"${process.execPath}\" -e \"setTimeout(String, 30000)\"`\n      : `'${process.execPath}' -e 'setTimeout(String, 30000)'`;",
  A4: '  const WAIT_30_SECONDS = `echo started > started.txt && "${process.execPath}" -e "setTimeout(String, 30000)"`;',
};
if (process.env.PROBE_FIX && out.includes(WAIT_DEF)) {
  out = replaceN(out, WAIT_DEF, FIXES[process.env.PROBE_FIX]);
  console.log('FIX_APPLIED ' + process.env.PROBE_FIX);
}

// Lanes: PROBE_UNSET_GITBASH drops the Git Bash markers in-process (the MSYS2
// layers between a Git Bash step and vitest restore them otherwise), and
// PROBE_COMSPEC points ComSpec at another shell.
out = replaceN(
  out,
  'interface Expected {',
  "if (process.env['PROBE_UNSET_GITBASH'] === '1') {\n  delete process.env['MSYSTEM'];\n  delete process.env['TERM'];\n}\nif (process.env['PROBE_COMSPEC']) {\n  process.env['ComSpec'] = process.env['PROBE_COMSPEC'];\n}\n\ninterface Expected {",
);
fs.writeFileSync(TARGET, out);
console.log(`ARM_WRITTEN ${arm} repeats=${repeats}`);
