// Writes one arm of managed-context-worker.test.ts.
// Usage: node probe/transform.mjs <arm> <repeats>
//   base-full     the test file at the PR's merge base, unchanged
//   head-full     the test file at the PR head, unchanged
//   base-repeat   base file, the old test repeated <repeats> times
//   head-repeat   head file, the first new test repeated (second stays skipped)
//   head-unskip   head file, the second new test unskipped and repeated
//   probe         head file plus two measuring probes, repeated
// Every replacement must land exactly once, or the script exits 1.
import fs from 'node:fs';

const [arm, repeatsArg = '20'] = process.argv.slice(2);
const repeats = Number(repeatsArg);
const TARGET = 'packages/cli/src/serve/managed-context-worker.test.ts';
const ITER = `Array.from({ length: ${repeats} }, (_, i) => i)`;

function replaceOnce(text, from, to) {
  const count = text.split(from).length - 1;
  if (count !== 1) {
    console.error(`TRANSFORM_FAILED ${arm}: expected 1 match, found ${count}: ${from.slice(0, 80)}`);
    process.exit(1);
  }
  return text.replace(from, to);
}

const base = fs.readFileSync('probe/base.test.ts', 'utf8');
const head = fs.readFileSync('probe/head.test.ts', 'utf8');
const OLD = "it('refuses release while an invocation is active, and retains status/cancel after directory loss', async () => {";
const NEW1 = "it('refuses release while an invocation is active, and allows it once the invocation settles', async () => {";
const NEW2 = "it.skipIf(process.platform === 'win32')(\n    'retains status and cancel for an active invocation after its directory is lost',";
const ANCHOR = "  it('rechecks a closed gate after an asynchronous tool resolver returns'";

const PROBES = `  // --- PR 12815 probes: measure, never assert ---
  it.each(Array.from({ length: 5 }, (_, i) => i))('PROBE natural lifetime of the slow command #%i', async () => {
    const { getShellConfiguration } = await import('@qwen-code/qwen-code-core');
    const root = workspace();
    fs.mkdirSync(path.join(root, 'child'));
    const origin = await startWorker({
      ...BOOT,
      mountRoot: root,
      capabilityDigest: WORKSPACE_CAPABILITY_DIGEST,
    });
    const request = fixedInstallation('probe-session', 'child');
    expect((await post(origin, CONTEXT, request)).status).toBe(200);
    expect((await post(origin, ACTIVATION, activation(request))).status).toBe(200);
    const call = shell(
      request.sessionId,
      'probe',
      'echo started > started.txt && sleep 30 # intentional-sleep: in-flight release test',
    );
    const t0 = performance.now();
    const running = post(origin, EXECUTE, call).then((r) => r.json());
    running.catch(() => undefined);
    // Waits up to 5 s for the call to end by itself, then cancels it.
    let body = await Promise.race([
      running,
      new Promise((resolve) => setTimeout(() => resolve(null), 5_000)),
    ]);
    const elapsedMs = body === null ? '>5000' : Math.round(performance.now() - t0);
    if (body === null) {
      await post(origin, CANCEL, { protocolVersion: 2, reference: call.reference });
      body = await running;
    }
    console.log('PROBE_JSON ' + JSON.stringify({
      probe: 'lifetime',
      shell: getShellConfiguration(),
      env: {
        MSYSTEM: process.env['MSYSTEM'] ?? null,
        TERM: process.env['TERM'] ?? null,
        ComSpec: process.env['ComSpec'] ?? null,
      },
      elapsedMs,
      executionStatus: body.result?.executionStatus,
      marker: fs.existsSync(path.join(root, 'child', 'started.txt')),
      output: JSON.stringify(body.result).slice(0, 700),
    }));
  }, 45_000);

  it.each(${ITER})('PROBE rename while the call runs #%i', async () => {
    const { root, status, cancel, release } = await startSlowCall();
    const t0 = performance.now();
    let markerMs: number | null = null;
    try {
      await vi.waitFor(
        () => {
          expect(fs.existsSync(path.join(root, 'child', 'started.txt'))).toBe(true);
        },
        { timeout: 10_000, interval: 5 },
      );
      markerMs = Math.round(performance.now() - t0);
    } catch {
      // recorded as null
    }
    const releaseBefore = await release();
    const before = await status();
    let rename = 'ok';
    try {
      fs.renameSync(path.join(root, 'child'), path.join(root, 'moved'));
    } catch (error) {
      rename = (error as NodeJS.ErrnoException).code ?? String(error);
    }
    const after = await status();
    let cancelOutcome = 'ok';
    const tc = performance.now();
    try {
      await cancel();
    } catch (error) {
      cancelOutcome = String((error as Error).message).split('\\n')[0].slice(0, 200);
    }
    const cancelMs = Math.round(performance.now() - tc);
    console.log('PROBE_JSON ' + JSON.stringify({
      probe: 'rename', markerMs, releaseBefore, before, rename, after, cancelOutcome, cancelMs,
      releaseAfter: await release(),
    }));
  }, 45_000);

`;

let out;
switch (arm) {
  case 'base-full':
    out = base;
    break;
  case 'head-full':
    out = head;
    break;
  case 'base-repeat':
    out = replaceOnce(base, OLD, OLD.replace("it('", `it.each(${ITER})('`).replace("', async", " #%i', async"));
    break;
  case 'head-repeat':
    out = replaceOnce(head, NEW1, NEW1.replace("it('", `it.each(${ITER})('`).replace("', async", " #%i', async"));
    break;
  case 'head-unskip':
    out = replaceOnce(
      head,
      NEW2,
      `it.each(${ITER})(\n    'retains status and cancel for an active invocation after its directory is lost #%i',`,
    );
    break;
  case 'probe':
    out = replaceOnce(head, ANCHOR, PROBES + ANCHOR);
    break;
  default:
    console.error(`TRANSFORM_FAILED unknown arm ${arm}`);
    process.exit(1);
}
fs.writeFileSync(TARGET, out);
console.log(`ARM_WRITTEN ${arm} repeats=${repeats}`);
