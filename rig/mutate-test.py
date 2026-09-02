"""Applies one named mutation to the TEST file, or exits 2.

Used to ask whether the round-3 additions are real witnesses: if a mutant that
strips the observed state from the gate's failure message survives, the new
test is decoration.
"""
import hashlib
import sys

path, name = sys.argv[1], sys.argv[2]
src = open(path).read()
before = hashlib.sha256(src.encode()).hexdigest()

RICH = ("      `expected >= 2 'gh config mint failed; skipping this tick' log "
        "lines within ${timeoutMs}ms, saw ${skips}; last log line: "
        "${JSON.stringify(lastLine)}`,")

if name == 'msg_bare':
    # The pre-round-3 message: a bare sentence, no observed state.
    old, new = RICH, "      'a failed mint must log a skipped tick',"
elif name == 'msg_nocount':
    # Keeps the last line, drops the observed skip count.
    old = RICH
    new = ("      `expected >= 2 'gh config mint failed; skipping this tick' log "
           "lines within ${timeoutMs}ms; last log line: "
           "${JSON.stringify(lastLine)}`,")
elif name == 'msg_nolastline':
    # Keeps the count, drops the quoted last line.
    old = RICH
    new = ("      `expected >= 2 'gh config mint failed; skipping this tick' log "
           "lines within ${timeoutMs}ms, saw ${skips}`,")
elif name == 'gate_one':
    # Weaken the occurrence count the first round proved load-bearing.
    old = ("        (readLog().match(/gh config mint failed; skipping this tick/g)"
           " ?? [])\n          .length >= 2,")
    new = ("        (readLog().match(/gh config mint failed; skipping this tick/g)"
           " ?? [])\n          .length >= 1,")
elif name == 'count_const':
    # Report a constant count instead of the observed one. The witness's
    # fixture happens to produce 1, so a mutant hardcoding 1 is only caught
    # if the witness also pins a DIFFERENT observed count somewhere.
    old = ("    const skips = (\n"
           "      logText.match(/gh config mint failed; skipping this tick/g) ?? []\n"
           "    ).length;")
    new = "    const skips = 1;"
elif name == 'lastline_first':
    # Report the FIRST log line instead of the last.
    old = "    const lastLine = logText.trim().split('\\n').at(-1);"
    new = "    const lastLine = logText.trim().split('\\n').at(0);"
else:
    sys.exit(f'unknown test mutation {name}')

if src.count(old) != 1:
    sys.exit(f'anchor for {name} matched {src.count(old)} times, expected 1')
out = src.replace(old, new)
after = hashlib.sha256(out.encode()).hexdigest()
if after == before:
    sys.exit(f'mutation {name} was a no-op')
open(path, 'w').write(out)
print(f'test-mutation={name} sha {before[:12]} -> {after[:12]}')
