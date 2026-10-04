#!/usr/bin/env python3
"""Generate untracked sibling arm files for PR #13323 verification.

armbase     = merge-base test file (1s default waitFor)          -- exact git blob
armbaseinj  = armbase + identical model-delay injection
armheadinj  = PR head + identical model-delay injection
armprobe    = PR head + a 10ms-resolution settle timer (before the unchanged waitFor)
"""
import subprocess, sys, pathlib
wt = pathlib.Path(sys.argv[1])
rel = 'packages/cli/src/serve/hosted-harness-session.test.ts'
d = wt / 'packages/cli/src/serve'
import os
base = subprocess.check_output(['git', '-C', str(wt), 'show', f"{os.environ.get('BASE_REV', '5ddfacc9d4')}:{rel}"], text=True)
head = (wt / rel).read_text()

ANCHOR = "      known = true;\n      await owner(\n        supertest(current).get(\n          `/session/${SESSION_ID}/hooks/operations/${operationId}`,"
INJ = """      known = true;
      // PR13323 harness: identical in both arms. Delays (or never resolves)
      // the one model call of this turn, which runs after the fence clears.
      {
        const raw = process.env['PR13323_MODEL_DELAY_MS'] ?? '0';
        if (raw !== '0')
          state.model.mockImplementationOnce(
            async ({ signal }: { signal: AbortSignal }) => {
              await new Promise<void>((resolve) => {
                if (raw !== 'hang') setTimeout(resolve, Number(raw));
                signal.addEventListener('abort', () => resolve(), { once: true });
              });
              return { text: 'hello back', model: 'test-model' };
            },
          );
      }
      await owner(
        supertest(current).get(
          `/session/${SESSION_ID}/hooks/operations/${operationId}`,"""

SUBMIT = "      await submit().expect(202);\n      await vi.waitFor(\n        async () => {\n          const status = await owner("
PROBE = """      const __t0 = performance.now();
      await submit().expect(202);
      {
        // PR13323 probe: time from the prompt POST to the settled status,
        // polled every 10ms (60s cap), then the unchanged waitFor runs.
        let polls = 0;
        for (;;) {
          polls++;
          const s = await owner(
            supertest(current).get(`/session/${SESSION_ID}/status`),
          );
          if (!s.body.hasActivePrompt && !s.body.recoveryBlocked) break;
          if (performance.now() - __t0 > 60_000) break;
          await new Promise((r) => setTimeout(r, 10));
        }
        const { appendFileSync } = await import('node:fs');
        appendFileSync(
          process.env['PR13323_PROBE_OUT'] ?? '/dev/null',
          JSON.stringify({ reload, settleMs: Math.round(performance.now() - __t0), polls, at: Date.now() }) + '\\n',
        );
      }
      await vi.waitFor(
        async () => {
          const status = await owner("""

EACH = "  it.each([false, true])(\n    'reports and clears the unknown Hook fence (reload: %s)',"
REPS = "  it.each(\n    Array.from(\n      { length: Number(process.env['PR13323_REPS'] ?? '1') },\n      () => [false, true],\n    ).flat(),\n  )(\n    'reports and clears the unknown Hook fence (reload: %s)',"

def once(s, a, b, name):
    n = s.count(a)
    assert n == 1, f'{name}: anchor count {n}'
    return s.replace(a, b)

(d / 'hosted-harness-session.armbase.test.ts').write_text(base)
reps = lambda s, n: once(s, EACH, REPS, n)
(d / 'hosted-harness-session.armbaseinj.test.ts').write_text(reps(once(base, ANCHOR, INJ, 'baseinj'), 'baseinj'))
(d / 'hosted-harness-session.armheadinj.test.ts').write_text(reps(once(head, ANCHOR, INJ, 'headinj'), 'headinj'))
(d / 'hosted-harness-session.armprobe.test.ts').write_text(reps(once(head, SUBMIT, PROBE, 'probe'), 'probe'))
print('ok')
