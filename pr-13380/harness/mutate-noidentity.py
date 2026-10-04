# Mutant used for the live-writer negative control: drop the PR branch's
# `killedWriters.has(fields.writerId)` guard from the instrumented PR driver.
s = open('a2-pr.inst.ts').read()
old = "        store &&\n        killedWriters.has(fields.writerId)\n      ) {\n        // A write the killed"
assert s.count(old) == 1
open('a2-mut-noidentity.inst.ts', 'w').write(s.replace(old, "        store\n      ) {\n        // A write the killed"))
