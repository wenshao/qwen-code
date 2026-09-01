import sys, io, re
target, mid = sys.argv[1], sys.argv[2]
s = open(target).read()
orig = s

def once(old, new):
    global s
    assert s.count(old) == 1, f"expected 1 occurrence of {old!r}, got {s.count(old)}"
    s = s.replace(old, new)

ROT_BLOCK = """    // ACP session rotation runs inside sessionIdContext; only the
    // single-session CLI owns the process-wide fallback.
    if (sessionIdContext.getStore() === undefined) {
      setDebugLogSession(this);
    }
"""
CTOR_BLOCK = """    // Daemon Configs use sessionIdContext and must not replace the
    // single-session CLI fallback with whichever session was created last.
    if (sessionIdContext.getStore() === undefined) {
      setDebugLogSession(this);
    }
"""

if mid == 'C-M1':   # author-claimed: delete the rotation-path claim entirely
    once(ROT_BLOCK, "")
elif mid == 'C-M2': # rotation claim becomes unconditional (guard dropped)
    once(ROT_BLOCK, "    setDebugLogSession(this);\n")
elif mid == 'C-M3': # rotation guard inverted
    once(ROT_BLOCK, ROT_BLOCK.replace("=== undefined", "!== undefined"))
elif mid == 'C-M4': # constructor claim becomes unconditional
    once(CTOR_BLOCK, "    setDebugLogSession(this);\n")
elif mid == 'D-M1': # author-claimed: never-attempt-again latch
    once("""  const key = path.join(Storage.getGlobalDebugDir(), sessionId);""",
         """  if (aliasFailureStreak >= MAX_CONSECUTIVE_ALIAS_FAILURES) return;
  const key = path.join(Storage.getGlobalDebugDir(), sessionId);""")
elif mid == 'D-M2': # success no longer resets the streak
    once("""    if (updated) {
      aliasFailureStreak = 0;
      return;
    }""", """    if (updated) {
      return;
    }""")
elif mid == 'D-M3': # off-by-one: cap 3 -> 4
    once("aliasFailureStreak < MAX_CONSECUTIVE_ALIAS_FAILURES",
         "aliasFailureStreak <= MAX_CONSECUTIVE_ALIAS_FAILURES")
elif mid == 'D-M4': # streak never increments (cap unreachable)
    once("    aliasFailureStreak += 1;\n", "")
elif mid == 'D-M5': # reset helper no longer clears the streak
    once("""  aliasFailureStreak = 0;
  aliasChain = Promise.resolve();""", """  aliasChain = Promise.resolve();""")
elif mid == 'D-M6': # generation guard dropped from the retry condition
    once("""      aliasFailureStreak < MAX_CONSECUTIVE_ALIAS_FAILURES &&
      aliasGeneration === generation""", """      aliasFailureStreak < MAX_CONSECUTIVE_ALIAS_FAILURES""")
elif mid == 'D-M7': # cap constant 3 -> 2
    once("const MAX_CONSECUTIVE_ALIAS_FAILURES = 3;",
         "const MAX_CONSECUTIVE_ALIAS_FAILURES = 2;")
else:
    raise SystemExit(f"unknown mutant {mid}")

assert s != orig, "mutation was a no-op"
open(target, 'w').write(s)
print(f"applied {mid} to {target}")
