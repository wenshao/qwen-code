#!/usr/bin/env python3
"""Generate untracked sibling arm files for PR #13411 verification.

armbase     = merge-base test file (1s default waitFor)          -- exact git blob
armbaseinj  = armbase + identical model-delay injection
armheadinj  = PR head + identical model-delay injection
armprobe    = PR head + settle timer (10ms polls) before the unchanged waitFor,
              plus time-to-waitFor per attempt; repeatable via PR13411_REPS
Every edit is confined to the body of the one test under review.
"""
import subprocess, sys, pathlib, os
wt = pathlib.Path(sys.argv[1])
rel = 'packages/cli/src/serve/hosted-harness-session.test.ts'
d = wt / 'packages/cli/src/serve'
base = subprocess.check_output(['git', '-C', str(wt), 'show', f"{os.environ.get('BASE_REV', '9915c7ff8f')}:{rel}"], text=True)
head = (wt / rel).read_text()

NAME = "refuses a cold load when a settled file tool outcome is missing from its checkpoint"
IT = f"  it('{NAME}', async () => {{\n"

def region(s):
    assert s.count(IT) == 1
    a = s.index(IT)
    b = s.index("\n  it(", a + 1)
    return a, b

def edit(s, old, new, label):
    a, b = region(s)
    body = s[a:b]
    n = body.count(old)
    assert n == 1, f'{label}: anchor count {n} in test body'
    return s[:a] + body.replace(old, new) + s[b:]

MODEL = "    state.model.mockImplementationOnce(async ({ toolTurn, signal }) => {\n"
INJ = MODEL + """      // PR13411 harness: identical in both arms. Delays (or never resolves)
      // the one model call of this turn before it runs its file tool.
      {
        const raw = process.env['PR13411_MODEL_DELAY_MS'] ?? '0';
        if (raw !== '0')
          await new Promise<void>((resolve) => {
            if (raw !== 'hang') setTimeout(resolve, Number(raw));
            signal.addEventListener('abort', () => resolve(), { once: true });
          });
      }
"""

REPS_IT = ("  it.each(\n    Array.from(\n      { length: Number(process.env['PR13411_REPS'] ?? '1') },\n"
           "      (_, i) => i,\n    ),\n"
           f"  )('{NAME} (rep %i)', async () => {{\n    const __start = performance.now();\n")

POST = "      .expect(202);\n    await vi.waitFor(\n"
PROBE = """      .expect(202);
    {
      // PR13411 probe: time from test start to the prompt POST, and from the
      // POST to the settled status (10ms polls, 60s cap); then the unchanged
      // waitFor runs.
      const __post = performance.now();
      let polls = 0;
      for (;;) {
        polls++;
        const s = await headers(
          supertest(server).get(`/session/${SESSION_ID}/status`),
        ).set('X-Qwen-Client-Id', created.body.clientId as string);
        if (!s.body.hasActivePrompt && !s.body.recoveryBlocked) break;
        if (performance.now() - __post > 60_000) break;
        await new Promise((r) => setTimeout(r, 10));
      }
      const { appendFileSync } = await import('node:fs');
      appendFileSync(
        process.env['PR13411_PROBE_OUT'] ?? '/dev/null',
        JSON.stringify({ preWaitMs: Math.round(__post - __start), settleMs: Math.round(performance.now() - __post), polls, at: Date.now() }) + '\\n',
      );
    }
    await vi.waitFor(
"""

def reps(s, label):
    assert s.count(IT) == 1, label
    return s.replace(IT, REPS_IT)

(d / 'hosted-harness-session.armbase.test.ts').write_text(base)
(d / 'hosted-harness-session.armbaseinj.test.ts').write_text(edit(base, MODEL, INJ, 'baseinj'))
(d / 'hosted-harness-session.armheadinj.test.ts').write_text(edit(head, MODEL, INJ, 'headinj'))
(d / 'hosted-harness-session.armprobe.test.ts').write_text(reps(edit(head, POST, PROBE, 'probe'), 'probe'))
print('ok')
