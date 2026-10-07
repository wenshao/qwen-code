#!/bin/bash
# Print the key failure / observer lines for each round-3 cell log.
D=/private/tmp/claude-501/-Users-wenshao-git-qwen-code-x3/ce3ef24d-3ca1-4a59-829e-edeff297be66/scratchpad/r3/cells
for f in "$D"/*.log; do
  t=$(basename "$f" .log)
  echo "== $t"
  grep -a -h -o -E '(AssertionFailedError|AssertionError|IllegalStateException): [^]]{0,170}|Suppressed: [^]]{0,120}|OBSERVE .{0,250}|PINNING-MARKER streams-about-to-open.{0,60}' "$f" | awk '!seen[$0]++' | head -6 | sed 's/^/   /'
done
