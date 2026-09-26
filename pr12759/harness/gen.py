import html, os, re, sys

import unicodedata
def vis(t):
    return re.sub(r'\{[rgyd]:(.*?)\}', r'\1', t)
def vwidth(t):
    return sum(2 if unicodedata.east_asian_width(ch) in 'WF' or ord(ch) > 0xFFFF else 1 for ch in vis(t))
def row(widths, *cells):
    out = ''
    for i, c in enumerate(cells):
        out += c + (' ' * max(1, widths[i] - vwidth(c)) if i < len(cells) - 1 else '')
    return out
def colorize(esc):
    m = {'r': 'bad', 'g': 'ok', 'y': 'warn', 'd': 'dim'}
    return re.sub(r'\{([rgyd]):(.*?)\}', lambda x: f'<span class="{m[x.group(1)]}">{x.group(2)}</span>', esc)
OUT = os.path.dirname(os.path.abspath(__file__))
CSS = """
body{margin:0;background:#0d1117;color:#e6edf3;font-family:-apple-system,'Helvetica Neue',Arial,'PingFang SC',sans-serif}
.card{padding:28px 32px 26px;width:max-content;min-width:900px}
h1{font-size:22px;margin:0 0 6px;color:#f0f6fc;font-weight:600}
.sub{font-size:13.5px;color:#8b949e;margin:0 0 16px;max-width:1380px;line-height:1.45}
pre{margin:0;font:13.5px/1.55 'SF Mono',Menlo,'PingFang SC','Apple Color Emoji',monospace;white-space:pre;background:#161b22;border:1px solid #30363d;border-radius:8px;padding:14px 18px}
.h{color:#79c0ff;font-weight:600}.ok{color:#56d364}.bad{color:#f85149}.warn{color:#e3b341}.dim{color:#8b949e}
.note{margin-top:14px;border-left:3px solid #56d364;padding:6px 12px;font-size:14px;color:#c9d1d9;max-width:1380px;line-height:1.5}
.note.warn{border-color:#e3b341}
"""
def card(name, title, sub, lines, notes):
    body = []
    for l in lines:
        cls = ''
        for p, c in (('## ', 'h'), ('++ ', 'ok'), ('-- ', 'bad'), ('!! ', 'warn'), ('== ', 'dim')):
            if l.startswith(p): cls, l = c, l[3:]; break
        e = colorize(html.escape(l, quote=False))
        body.append(f'<span class="{cls}">{e}</span>' if cls else e)
    ns = ''.join(f'<div class="note{" warn" if w else ""}">{html.escape(t)}</div>' for w, t in notes)
    doc = f'<!doctype html><meta charset="utf-8"><style>{CSS}</style><div class="card"><h1>{html.escape(title)}</h1><div class="sub">{html.escape(sub)}</div><pre>{chr(10).join(body)}</pre>{ns}</div>'
    open(os.path.join(OUT, name + '.html'), 'w').write(doc)

card('01-bundle-identical', 'No behavior change in what ships',
  'PR head 8cc4ad55d0 vs main 9e60263fde (its merge base). Both trees built by pnpm install (prepare), macOS arm64, Node 24.',
  ['## dist/ (the shipped bundle: dist/cli.js, dist/chunks, dist/bundled)',
   '$ python3 dist-compare.py main/dist pr/dist 9e60263fde 8cc4ad55d0',
   'files                                  main 1315            pr 1315',
   'bytes                                  main 117,595,231     pr 117,595,231',
   'same path and same bytes               1127 of 1315',
   '++ after masking the build stamp          identical: True',
   '== the other 188 files differ only by GIT_COMMIT_INFO (9e60263fde vs 8cc4ad55d0)',
   '== and by the content-hash chunk names that the stamp changes',
   '',
   'compile-cache code present in the compared tree   failedTexts in dist/chunks/chunk-HPGQ5343.js',
   'the PR\'s new comments present in the bundle       0 matches (esbuild drops comments)',
   '',
   '## packages/core/dist/src/utils/schemaValidator.js (tsc output keeps comments)',
   '$ diff main/.../schemaValidator.js pr/.../schemaValidator.js',
   '109c109,111    the compileOnce catch comment gains two lines ($id note)',
   '237a240,242    the validate() JSDoc gains the "must not be changed" rule',
   '== no code line differs'],
  [(False, 'The only source changes are comments. The shipped bundle is byte-identical once the commit id it embeds is masked, so the PR cannot change runtime behavior.')])

W2 = (6, 62, 20)
F = lambda n: '{r:FAIL (' + str(n) + ')}'
card('02-mutants', 'Mutation matrix: are the new tests load-bearing?',
  'Each mutant is one exact-string edit of packages/core/src/utils/schemaValidator.ts at the PR head, applied only if its anchor matches exactly once. Each runs against the PR test file and against the pre-PR test file (9e60263fde, copied alongside). The source is restored from memory, not through git.',
  [row(W2, 'id', 'mutant', 'PR tests (146)', 'pre-PR tests (142)'),
   '## the six mutants in the PR description',
   row(W2, 'C3', 'compileOnce drops failedTexts.add(key)', F(1), '{g:pass}'),
   row(W2, 'B3c', 'a new object whose text failed gets an accept-all validator', F(2), '{g:pass}'),
   row(W2, 'M7', 'a new object whose text failed is not added to direct', F(1), '{g:pass}'),
   row(W2, 'F1', 'the catch drops direct.add(schema)', F(1), '{g:pass}'),
   row(W2, 'D1', 'compileOnce drops the early return for direct', F(3), '{g:pass}'),
   row(W2, 'A1', 'isExactJsonValue accepts an array of any prototype', F(1), '{g:pass}'),
   '## extra mutants, not in the PR table',
   row(W2, 'X1', 'an inexact schema is not added to direct', F(1), '{g:pass}'),
   row(W2, 'X2', 'failedTexts is never consulted', F(1), '{g:pass}'),
   row(W2, 'X3', 'the first failing object gets accept-all', F(2), F(1)),
   row(W2, 'X4', 'bySchema is never filled (control)', F(1), F(1)),
   row(W2, '{y:X5}', '{y:a direct object is serialized again from its third use}', '{y:pass (survives)}', '{y:pass (survives)}'),
   '',
   '== 11 distinct mutant hashes; source after restore 9ab2efd852 = original; tracked tree clean',
   '== baseline: PR file 146/146 passed, pre-PR file 142/142 passed'],
  [(False, 'All six mutants in the PR table fail the new tests and pass the old file, as the description says. X1 and X2 are also killed only by the new tests.'),
   (True, 'X5 survives both files. The author disclosed it as round 3 deferred item 2 ("never serialized a second time" is tested only on the second use). It affects only serialization cost, not results.')])

W3 = (6, 46, 22)
card('03-ajv-and-retry', 'The $id test pins Ajv ordering; CI retries cannot heal these tests',
  'Top: AjvCore.prototype.compile is patched inside the test process to drop the schema object from Ajv\'s _cache when compile throws, either on any throw or only on the duplicate-$id throw. Bottom: CI runs vitest with --retry=2 (ci.yml, VITEST_RETRY default "2").',
  ['## Ajv 8.20.0 and two emulated variants',
   row(W3, 'mode', '', 'PR tests (146)', 'pre-PR tests (142)'),
   row(W3, 'none', 'real Ajv', '{g:146 passed}', '{g:142 passed}'),
   row(W3, 'all', 'drop the object on any compile throw', '{r:3 failed}', '{r:1 failed}'),
   row(W3, 'dup', 'drop it only on the duplicate-$id throw', '{r:1 failed}', '{g:142 passed}'),
   '== dup = an Ajv that caches the object after _checkUnique instead of before',
   '== dup fails only: validates each rebuilt schema with an $id that fails to compile on its second use',
   '',
   '## vitest --retry=2 on: does not compile a copy for each rebuilt schema that fails to compile',
   row((26, 19), 'C3 mutant', 'attempts 1, 2, 3', 'expected "parse" to be called 1 times, but got 5 times'),
   row((26, 19), 'correct code, one', 'attempt 1', 'simulated one-off failure on attempt 1'),
   row((26, 19), '  injected failure', 'attempts 2, 3', '{r:expected "parse" to be called 1 times, but got 0 times}')],
  [(False, 'Only the new $id test notices the "dup" ordering change, so it adds coverage the old file lacked. A real regression still fails every retry with the right message.'),
   (True, 'After a one-off failure, attempts 2 and 3 fail on module state and report a misleading count. This is round 3 deferred item 3, disclosed. The tests are synchronous and deterministic, so the practical risk is low.')])

W4 = (16, 23, 17, 28)
card('04-cli-log-note', 'Real CLI: the logging note, three builds side by side',
  'node dist/cli.js -p (headless) with an isolated QWEN_HOME and QWEN_RUNTIME_DIR, a real stdio MCP server, and a scripted OpenAI-compatible model that calls the tool 3 times with {"count":0}. Tool schema: $schema draft-04, count must be an integer >= 1. The reason is read from the debug log (QWEN_DEBUG_LOG_FILE=1).',
  [row(W4, 'tool', 'build', 'call 1', 'calls 2 and 3', 'MCP server got'),
   row(W4, 'lookup04 ($id)', 'pre-cache 89b057befd', 'reached server', 'params/count must be >= 1', '1 call {"count":0}'),
   row(W4, '', 'main 9e60263fde', 'reached server', 'params/count must be >= 1', '1 call {"count":0}'),
   row(W4, '', 'PR 8cc4ad55d0', 'reached server', 'params/count must be >= 1', '1 call {"count":0}'),
   row(W4, 'lookup04_noid', 'all three builds', 'reached server', 'params/count must be >= 1', '1 call {"count":0}'),
   '',
   '## logged reason for the skipped first call ([WARN] [SchemaValidator] Failed to compile schema ...)',
   row((16, 12), 'lookup04', 'pre-cache', 'no schema with key or ref "http://json-schema.org/draft-04/schema#"'),
   row((16, 12), 'lookup04', 'main, PR', '{y:schema with key or id "urn:probe:lookup04-input" already exists}'),
   row((16, 12), 'lookup04_noid', 'all three', 'no schema with key or ref "http://json-schema.org/draft-04/schema#"')],
  [(False, 'Same results in all three builds. Only the logged reason differs, only for the schema with an $id, and only since the compile cache. This is what the new compileOnce comment and the design document now state.'),
   (True, 'The duplicate-$id reason can mislead an operator, because the server declares that $id only once. Restoring the original reason would change behavior, so it stays deferred, as the PR body says.')])

W5 = (24, 10)
card('05-project-dir', 'Real worker: the corrected project-directory sentence',
  'node dist/cli.js managed-runtime-worker (PR head), boot v2. One Session per effective directory under mountRoot $B/ws; each runs echo "$QWEN_CODE_PROJECT_DIR" through the real Shell tool, whose PWD is $B/ws/<directory>. macOS, so no lowercasing (paths.ts:390 lowercases only on win32).',
  [row(W5, 'QWEN_CODE_PROJECT_DIR', 'install', 'directory'),
   row(W5, '...-ws-svc-a-b', '200', 'svc/a-b'),
   row(W5, '...-ws-svc-a-b', '200', 'svc/a/b'),
   row(W5, '{g:...-ws-svc---}', '200', 'svc/数据'),
   row(W5, '{g:...-ws-svc---}', '200', 'svc/日志'),
   row(W5, '{g:...-ws-svc---}', '200', 'svc/😀'),
   row(W5, '{g:...-ws-svc---}', '200', 'svc/--'),
   row(W5, '...-ws-svc--', '200', 'svc/数'),
   '',
   '++ svc/数据 and svc/日志 share one; the old text said only punctuation collides',
   '++ svc/😀 and svc/-- share one; an emoji is two UTF-16 code units, so "--"',
   '++ svc/😀 and svc/数 do not; one BMP character is one "-"'],
  [(False, 'The new wording in both languages matches the real worker. The old sentence ("differ only in punctuation") understated which directories share a project directory.')])

card('06-consequences', 'What the pinned rules protect, on the built core module',
  'packages/core/dist/src/utils/schemaValidator.js from the PR build, each mutant an exact-string edit of a copy placed next to it, one process per build, --expose-gc. Rebuilt: a new draft-04 schema object per call, used twice (as a rediscovery or a per-call tool build hands it over).',
  ['## rebuilt x3000, each object used twice                              one object used 5 times',
   'build   heap/object   JSON.parse/obj   object serialized   2nd use validated   results             serialized',
   'PR      +4.62 KiB     0                1x                  3000/3000           skip,err,err,err,err  1x',
   'C3      +5.27 KiB     1                1x                  3000/3000           skip,err,err,err,err  1x',
   '!! B3c     +0.01 KiB     0                2x                  0/3000              skip,err,err,err,err  1x',
   'M7      +4.58 KiB     0                2x                  3000/3000           skip,err,err,err,err  1x',
   'F1      +4.62 KiB     0                1x                  3000/3000           skip,err,err,err,err  2x',
   'D1      +4.62 KiB     0                2x                  3000/3000           skip,err,err,err,err  5x',
   '',
   '## rebuilt x4000, each object used once (the #12747 scenario), run twice',
   'PR      +0.54 KiB/call   0.012 ms/call        C3   +1.08 KiB/call   0.025 ms/call',
   'PR      +0.54 KiB/call   0.013 ms/call        C3   +1.07 KiB/call   0.022 ms/call'],
  [(False, 'C3 reproduces the #12747 verification: heap growth per call doubles (0.54 to 1.08 KiB). M7, F1 and D1 cost only extra serialization.'),
   (True, 'B3c looks like a memory win (+0.01 KiB) but silently stops validating every rebuilt failing schema. The new rebuilt-schema test is what catches it.'),
   (False, 'A failing schema rebuilt and used twice still keeps about 4.6 KiB per object. So the retention paragraph needs its new qualifier "and that compiles the first time".')])

rows = [l.rstrip('\n') for l in open(sys.argv[1])]
lines = ['case                         call pattern        pre-cache 89b057befd  PR 8cc4ad55d0         same?']
for l in rows[1:-1]:
    lines.append(('!! ' if 'DIFFERS' in l else '') + l)
lines.append('== ' + rows[-1])
card('07-results-diff', 'Which results the compile cache changes, against the validator before it',
  'Built core modules: 89b057befd (before the compile cache) vs the PR head. Each row runs in a fresh process per build and validates { n: "x" } 4 times, either with one object or with a new object per call. err = validation error returned, skip = compile failed and validation was skipped.',
  lines,
  [(False, 'Only the two rows the updated Changes section names differ: a text that compiles the first time and carries an $id (top-level or nested), rebuilt. There the PR head validates where the old validator skipped. Every failing schema, with or without an $id, gives the same results in both builds.')])
print('ok')
