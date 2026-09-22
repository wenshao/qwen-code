#!/usr/bin/env python3
"""Build the real-stack arms for PR #12250 R2 from a copy of the PR-head bundle.

  obs : observation only -- one stderr line before each branch/fork/rewind/cd
        dispatch to the child, at each auto-close final check, and around each
        conditional close (close_if_unheld) the daemon sends
  mut : obs + the seven `backgroundTurn` guard terms this PR pins turned off
  ur  : (add-on) the ACP child reports no active-work holds while its own
        background turn is running -- the state the new retention fixture models

Anchored on text, not line numbers: every anchor must match exactly once (the
fork/rewind admission lines are told apart by the message two lines below).
Usage: make-arms2.py <dist-copy> obs|mut [ur]
"""
import pathlib, sys, re

root = pathlib.Path(sys.argv[1]); mode = sys.argv[2]; ur = 'ur' in sys.argv[3:]
chunks = root / 'chunks'

def find_chunk(marker):
    hits = [p for p in chunks.glob('*.js') if marker in p.read_text()]
    assert len(hits) == 1, (marker, hits)
    return hits[0]

bridge = find_chunk('function entryHasLocalWork(entry)')
s = bridge.read_text()

def once(old, new, label):
    global s
    n = s.count(old)
    if n != 1:
        sys.exit(f'{label}: expected exactly 1 match, got {n}')
    s = s.replace(old, new)
    print(f'patched {label}')

P = 'process.stderr.write('
# --- observation lines (both arms)
once('    return !childReportsHeldWork(entry);\n  }\n  __name(entryIsAutoCloseCandidate',
     '    ' + P + '"[probe-autoclose] " + JSON.stringify({ sessionId: entry.sessionId, reachedFinalCheck: true, backgroundTurn: entry.backgroundTurn?.turnId ?? null, childReportsHeldWork: childReportsHeldWork(entry), childHolds: [...(entry.childHolds?.values?.() ?? [])] }) + "\\n");\n'
     '    return !childReportsHeldWork(entry);\n  }\n  __name(entryIsAutoCloseCandidate', 'obs autoclose')
once('    try {\n      const response = await withTimeout(\n        entry.connection.extMethod(SERVE_CONTROL_EXT_METHODS.sessionClose, {\n          sessionId: entry.sessionId,\n          [ACTIVE_WORK_CLOSE_IF_UNHELD_PARAM]: true,',
     '    const __probeT0 = Date.now();\n    ' + P + '"[probe-close-if-unheld-send] " + JSON.stringify({ sessionId: entry.sessionId, backgroundTurn: entry.backgroundTurn?.turnId ?? null, at: __probeT0 }) + "\\n");\n'
     '    try {\n      const response = await withTimeout(\n        entry.connection.extMethod(SERVE_CONTROL_EXT_METHODS.sessionClose, {\n          sessionId: entry.sessionId,\n          [ACTIVE_WORK_CLOSE_IF_UNHELD_PARAM]: true,', 'obs close-if-unheld send')
once('        SERVE_CONTROL_EXT_METHODS.sessionClose\n      );\n      entry.activeWorkCloseFailures = 0;\n      entry.activeWorkCloseRetryAt = null;\n',
     '        SERVE_CONTROL_EXT_METHODS.sessionClose\n      );\n      ' + P + '"[probe-close-if-unheld-answer] " + JSON.stringify({ sessionId: entry.sessionId, closed: response["closed"] ?? null, holds: response["holds"] ?? null, ms: Date.now() - __probeT0 }) + "\\n");\n'
     '      entry.activeWorkCloseFailures = 0;\n      entry.activeWorkCloseRetryAt = null;\n', 'obs close-if-unheld answer')
once('      return channel.connection.extMethod(SERVE_CONTROL_EXT_METHODS.sessionCd, {',
     '      ' + P + '"[probe-dispatch] cd -> child sessionId=" + sessionId + "\\n");\n      return channel.connection.extMethod(SERVE_CONTROL_EXT_METHODS.sessionCd, {', 'obs cd dispatch')
once('          const mutation = entry.connection.extMethod(\n            isSideTask ? SERVE_CONTROL_EXT_METHODS.sessionSideTask : SERVE_CONTROL_EXT_METHODS.sessionBranch,',
     '          ' + P + '"[probe-dispatch] branch -> child sessionId=" + sessionId + "\\n");\n          const mutation = entry.connection.extMethod(\n            isSideTask ? SERVE_CONTROL_EXT_METHODS.sessionSideTask : SERVE_CONTROL_EXT_METHODS.sessionBranch,', 'obs branch dispatch')
for op, method in (('fork', 'SERVE_CONTROL_EXT_METHODS.sessionForkAgent'), ('rewind', 'SERVE_CONTROL_EXT_METHODS.sessionRewind')):
    pat = re.compile(r'(\n)(          response = await Promise\.race\(\[\n(?:[^\n]*\n){0,3}?[^\n]*' + re.escape(method) + ')')
    m = list(pat.finditer(s))
    if len(m) != 1:
        sys.exit(f'{op} dispatch anchor: {len(m)} matches')
    s = s[:m[0].start(2)] + '          ' + P + f'"[probe-dispatch] {op} -> child sessionId=" + sessionId + "\\n");\n' + s[m[0].start(2):]
    print(f'patched obs {op} dispatch')

if mode == 'mut':
    once('    return entry.pendingPromptCount > 0 || entry.pendingAgentNotificationCount > 0 || !!entry.backgroundTurn;',
         '    return entry.pendingPromptCount > 0 || entry.pendingAgentNotificationCount > 0 || false;', 'mut entryHasLocalWork')
    once('      if (!isSideTask && (entry.pendingPromptCount > 0 || entry.promptActive || !!entry.backgroundTurn)) {',
         '      if (!isSideTask && (entry.pendingPromptCount > 0 || entry.promptActive || false)) {', 'mut branch admission')
    once('        if ((entry.promptActive || entry.backgroundTurn) && !isSideTask) {',
         '        if ((entry.promptActive || false) && !isSideTask) {', 'mut branch callback')
    once('          if (entry.promptActive || entry.backgroundTurn) {\n            throw new CdWhilePromptActiveError(sessionId);',
         '          if (entry.promptActive || false) {\n            throw new CdWhilePromptActiveError(sessionId);', 'mut cd guard')
    for label, indent, msg in (('fork admission', '      ', 'Cannot fork while'), ('fork callback', '        ', 'Cannot fork while'), ('rewind admission', '      ', 'Cannot rewind while')):
        line = indent + 'if (entry.pendingPromptCount > 0 || entry.promptActive || !!entry.backgroundTurn) {\n'
        idx = [m.start() for m in re.finditer(re.escape(line), s) if msg in s[m.start():m.start() + 300] and s[m.start()-1] == '\n']
        if len(idx) != 1:
            sys.exit(f'{label}: {len(idx)} matches')
        i = idx[0]
        s = s[:i] + line.replace('!!entry.backgroundTurn', 'false') + s[i + len(line):]
        print(f'patched mut {label}')
bridge.write_text(s)

if ur:
    child = find_chunk('  collectActiveWorkHolds() {\n    if (this.disposed) return [];')
    c = child.read_text()
    old = '  collectActiveWorkHolds() {\n    if (this.disposed) return [];\n'
    assert c.count(old) == 1
    c = c.replace(old, old + '    if (this.backgroundTurn) return [];\n')
    child.write_text(c)
    print('patched ur child collectActiveWorkHolds')
