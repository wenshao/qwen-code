#!/usr/bin/env python3
"""R3 real-stack arms for PR #12250, applied to a copy of the head bundle AFTER
make-arms2.py <dist> obs (the R2 observation lines: dispatch/close probes).

  slowcd (both arms): the ACP child holds a cd whose target ends in /slowcd
         for PROBE_SLOW_CD_MS (default 12000) before handling it normally --
         the real-stack twin of the new table's unresolved `hangingCd`
  adm  : branch + fork admission `!!entry.backgroundTurn` terms off (M3+M6),
         and rewind's term moved from admission into its queue callback (M16);
         every queue-callback guard stays intact
Anchored on text; every anchor must match exactly once.
Usage: make-arms3.py <dist-copy> obs|adm
"""
import pathlib, sys, re
root = pathlib.Path(sys.argv[1]); mode = sys.argv[2]
chunks = root / 'chunks'
def find_chunk(marker):
    hits = [p for p in chunks.glob('*.js') if marker in p.read_text()]
    assert len(hits) == 1, (marker, hits)
    return hits[0]
def once(s, old, new, label):
    n = s.count(old)
    if n != 1: sys.exit(f'{label}: expected exactly 1 match, got {n}')
    print(f'patched {label}')
    return s.replace(old, new)

child = find_chunk('      case SERVE_CONTROL_EXT_METHODS.sessionCd: {\n        const sessionId = params["sessionId"];\n        const targetPath = params["path"];\n')
c = child.read_text()
c = once(c, '      case SERVE_CONTROL_EXT_METHODS.sessionCd: {\n        const sessionId = params["sessionId"];\n        const targetPath = params["path"];\n',
 '      case SERVE_CONTROL_EXT_METHODS.sessionCd: {\n        const sessionId = params["sessionId"];\n        const targetPath = params["path"];\n'
 '        if (typeof targetPath === "string" && targetPath.endsWith("/slowcd")) {\n'
 '          process.stderr.write("[probe-child] slow cd held sessionId=" + sessionId + " at=" + Date.now() + "\\n");\n'
 '          await new Promise((r) => setTimeout(r, Number(process.env.PROBE_SLOW_CD_MS || 12000)));\n'
 '          process.stderr.write("[probe-child] slow cd released sessionId=" + sessionId + " at=" + Date.now() + "\\n");\n'
 '        }\n', 'child slowcd')
child.write_text(c)

if mode == 'adm':
    b = find_chunk('function entryHasLocalWork(entry)')
    s = b.read_text()
    s = once(s, '      if (!isSideTask && (entry.pendingPromptCount > 0 || entry.promptActive || !!entry.backgroundTurn)) {\n        throw new BranchWhilePromptActiveError(sessionId);',
                '      if (!isSideTask && (entry.pendingPromptCount > 0 || entry.promptActive || false)) {\n        throw new BranchWhilePromptActiveError(sessionId);', 'adm branch admission (M3)')
    s = once(s, '      if (entry.pendingPromptCount > 0 || entry.promptActive || !!entry.backgroundTurn) {\n        throw new SessionBusyError(\n          sessionId,\n          "Cannot fork while',
                '      if (entry.pendingPromptCount > 0 || entry.promptActive || false) {\n        throw new SessionBusyError(\n          sessionId,\n          "Cannot fork while', 'adm fork admission (M6)')
    s = once(s, '      if (entry.pendingPromptCount > 0 || entry.promptActive || !!entry.backgroundTurn) {\n        throw new SessionBusyError(\n          sessionId,\n          "Cannot rewind while a prompt is running"\n        );\n      }\n      const rewindResult = entry.promptQueue.then(async () => {\n        if (entry.closing) {\n          throw new SessionNotFoundError(sessionId, "The session is closing");\n        }\n',
                '      if (entry.pendingPromptCount > 0 || entry.promptActive || false) {\n        throw new SessionBusyError(\n          sessionId,\n          "Cannot rewind while a prompt is running"\n        );\n      }\n      const rewindResult = entry.promptQueue.then(async () => {\n        if (entry.closing) {\n          throw new SessionNotFoundError(sessionId, "The session is closing");\n        }\n        if (entry.backgroundTurn) {\n          throw new SessionBusyError(sessionId, "Cannot rewind while a prompt is running");\n        }\n', 'adm rewind relocated (M16)')
    b.write_text(s)
