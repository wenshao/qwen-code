#!/usr/bin/env python3
"""Generate untracked sibling arm files for PR #13399 verification.

All arms live next to the tracked test in ONE built worktree (PR head a0dce616).
  armorig    = file before #13380 (bare vi.waitFor -> vitest 1s default)  exact blob a6a4b0baa4^
  armmain    = current main / PR merge-base (timeout: 5_000)             exact blob 9915c7ff8f
  (tracked)  = PR head (timeout: 10_000), run unmodified
  *inj       = the arm above + ONE identical delay injection (see INJ)
  armprobe   = PR head + a 10ms settle probe inside requested(), before the unchanged waitFor
"""
import subprocess, pathlib, sys
wt = pathlib.Path(sys.argv[1] if len(sys.argv) > 1 else '/root/verify/pr13399/qwen-head')
rel = 'packages/cli/src/serve/hosted-workspace-tool-turn.test.ts'
d = wt / 'packages/cli/src/serve'
show = lambda rev: subprocess.check_output(['git', '-C', str(wt), 'show', f'{rev}:{rel}'], text=True)
orig, main, head = show('a6a4b0baa4^'), show('9915c7ff8f'), (wt / rel).read_text()

ANCHOR = ("it('reports an answer that loses the race to the expiry as expired', async () => {\n"
          "  turn = createTurn(false, { mode: 'default', timeoutMs: 60_000 });\n")
INJ = ANCHOR + """  {
    // PR13399 harness, identical in every arm: hold the exact window the
    // main-CI failure landed in. The Action request is committed (visible and
    // 'requested'), the await_action checkpoint commit has not run yet.
    const raw = process.env['PR13399_CKPT_DELAY_MS'] ?? '0';
    if (raw !== '0') {
      const requestToolAction = session.authority.requestToolAction.bind(
        session.authority,
      );
      vi.spyOn(session.authority, 'requestToolAction').mockImplementationOnce(
        async (...args: Parameters<typeof requestToolAction>) => {
          const result = await requestToolAction(...args);
          await new Promise<void>((resolve) => {
            if (raw !== 'hang') setTimeout(resolve, Number(raw));
          });
          return result;
        },
      );
    }
  }
"""

REQ = "async function requested(count = 1): Promise<string> {\n  let requestId = '';\n"
PROBE = REQ + """  {
    // PR13399 probe: from the call (made right after turn.execute starts) to
    // (a) the Action visible+requested and (b) the await_action checkpoint,
    // polled every 50ms (the vi.waitFor default interval) with a 60s cap; then the unchanged waitFor runs.
    const t0 = performance.now();
    let visible = -1;
    let ckpt = -1;
    while (performance.now() - t0 < 60_000) {
      const ids = actionIds();
      const id = ids.at(-1);
      if (
        visible < 0 &&
        ids.length === count &&
        id &&
        session.authority.action(id)?.state === 'requested'
      )
        visible = performance.now() - t0;
      if (visible >= 0) {
        let phase = '';
        try {
          phase = (await checkpoint()).continuation.phase;
        } catch {
          phase = '';
        }
        if (phase === 'await_action') {
          ckpt = performance.now() - t0;
          break;
        }
      }
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    const out = process.env['PR13399_PROBE_OUT'];
    if (out)
      (await import('node:fs')).appendFileSync(
        out,
        JSON.stringify({
          test: expect.getState().currentTestName,
          count,
          visibleMs: Math.round(visible),
          ckptMs: Math.round(ckpt),
          gapMs: Math.round(ckpt - visible),
        }) + '\\n',
      );
  }
"""

def sub(text, a, b, label):
    assert text.count(a) == 1, (label, text.count(a))
    return text.replace(a, b)

arms = {
    'armorig': orig, 'armmain': main,
    'armoriginj': sub(orig, ANCHOR, INJ, 'orig'),
    'armmaininj': sub(main, ANCHOR, INJ, 'main'),
    'armheadinj': sub(head, ANCHOR, INJ, 'head'),
    'armprobe': sub(head, REQ, PROBE, 'probe'),
}
for name, text in arms.items():
    (d / f'hosted-workspace-tool-turn.{name}.test.ts').write_text(text)
    print('wrote', name, len(text.splitlines()))
