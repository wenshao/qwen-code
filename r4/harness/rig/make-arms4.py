#!/usr/bin/env python3
"""Real-stack arms for PR #12250 round 4, applied to a copy of the head bundle.

  obs  : (every arm) one stderr line each time the daemon projects
         activeWorkState for a Session that has an admitted backgroundTurn:
         which term answered (daemon-owned local work, or the child's report)
  m17  : entryActiveWorkState stops counting the background turn (M17 -- the
         mutant the new `activeWorkState` assertion kills); retention
         (entryHasLocalWork) stays intact
  ur   : the ACP child reports no active-work holds while its own background
         turn runs (the R2 add-on) -- the state the retention fixture models
Anchored on text; every anchor must match exactly once.
Usage: make-arms4.py <dist-copy> [m17] [ur]
"""
import pathlib, sys
root = pathlib.Path(sys.argv[1]); mods = set(sys.argv[2:])
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

b = find_chunk('function entryHasLocalWork(entry)')
s = b.read_text()
HEAD = ('  function entryActiveWorkState(entry) {\n'
        '    if (entryHasLocalWork(entry) || childReportsHeldWork(entry)) {\n'
        '      return "active";\n'
        '    }\n'
        '    const capability = channelInfoForEntry(entry)?.harness.activeWork;\n'
        '    if (!capability) return "unsupported";\n')
OBS = ('  function entryActiveWorkState(entry) {\n'
       '    if (entry.backgroundTurn) process.stderr.write("[probe-aws] " + JSON.stringify({ sessionId: entry.sessionId, at: Date.now(), turn: entry.backgroundTurn.turnId, local: entryHasLocalWork(entry), child: childReportsHeldWork(entry), holds: [...(entry.childHolds?.values?.() ?? [])] }) + "\\n");\n')
if 'm17' in mods:
    new = OBS + ('    if (entry.pendingPromptCount > 0 || entry.pendingAgentNotificationCount > 0 || childReportsHeldWork(entry)) {\n'
                 '      return "active";\n'
                 '    }\n'
                 '    const capability = channelInfoForEntry(entry)?.harness.activeWork;\n'
                 '    if (!capability) return "unsupported";\n')
    s = once(s, HEAD, new, 'obs + M17 entryActiveWorkState drops backgroundTurn')
else:
    s = once(s, HEAD, HEAD.replace('  function entryActiveWorkState(entry) {\n', OBS), 'obs entryActiveWorkState')
b.write_text(s)

if 'ur' in mods:
    child = find_chunk('  collectActiveWorkHolds() {\n    if (this.disposed) return [];\n')
    c = child.read_text()
    old = '  collectActiveWorkHolds() {\n    if (this.disposed) return [];\n'
    c = once(c, old, old + '    if (this.backgroundTurn) return [];\n', 'ur child collectActiveWorkHolds')
    child.write_text(c)
