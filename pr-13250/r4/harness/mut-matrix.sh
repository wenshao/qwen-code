#!/bin/bash
# Mutation matrix witness run: Finding-2's four guards + three sampled post-round-3
# area mutants + one liveness control on index.ts. Prints only verdict lines.
set -u
PKG=/Users/cici/git/qwen-code-x6/tmp/pr13250-head/packages/channels/qqbot
cd "$PKG"

apply() { python3 - "$1" "$2" <<'EOF'
import sys
path, mid = sys.argv[1], sys.argv[2]
src = open(path).read()
M = {
 'm06': ("    // own, so this clear is the only guard against that alias.\n    this.completedTurns.delete(sessionId);",
         "    // own, so this clear is the only guard against that alias.\n"),
 'm07': ("    const stashed = this.streamOrphanBuffer.get(sessionId);\n    if (stashed) {\n      this.dropOrphanStash(sessionId, stashed);\n    }",
         "    const stashed = this.streamOrphanBuffer.get(sessionId);\n    if (stashed && false) {\n      this.dropOrphanStash(sessionId, stashed);\n    }"),
 'm09': ("    if ((this.inFlightMsgSeqSends.get(msgId) ?? 0) > 0) return true;\n", ""),
 'm12': ("        if (this.flushingSessions.get(sessionId) !== state) return;\n        this.flushingSessions.delete(sessionId);",
         "        this.flushingSessions.delete(sessionId);"),
 'm01': ("  defaultSessionScope: 'thread',\n", ""),
 'm05': ("    const turn = (this.turnCounter.get(sessionId) ?? 0) + 1;\n    this.turnCounter.set(sessionId, turn);",
         "    const turn = this.turnCounter.get(sessionId) ?? 1;\n    this.turnCounter.set(sessionId, turn);"),
 'm08': ("    } else if (current !== undefined && current.msgId === expectedMsgId) {",
         "    } else if (true) {"),
 'm16': ("    if (flushing === state && liveResidual !== undefined) {\n      flushing.boundaryClearedInFlight = 'residual';",
         "    if (false) {\n      flushing.boundaryClearedInFlight = 'residual';"),
}
old, new = M[mid]
assert src.count(old) == 1, f'{mid}: anchor count {src.count(old)}'
open(path, 'w').write(src.replace(old, new))
EOF
}

NAMES=$(cat <<'EOF'
m06 F2:completedTurns-clear-onPromptStart
m07 F2:orphan-stash-drop-onPromptStart
m09 F2:inflight-msg_seq-holder
m12 F2:flushingSessions-ownership-release
m05 delta:turnCounter-bump-onPromptStart
m08 delta:anchor-identity-gate
m16 delta:boundary-residual-upgrade
m01 control:defaultSessionScope-thread
EOF
)

echo "mutant | gate | result | killing tests"
echo "control (unmutated): $(npx vitest run src/ 2>&1 | grep -E '^ *Tests ' | tr -s ' ')"
echo "$NAMES" | while read -r m gate; do
  f=src/QQChannel.ts; [ "$m" = m01 ] && f=src/index.ts
  if ! apply "$f" "$m"; then echo "$m | $gate | ANCHOR-DRIFT |"; git checkout -- "$f"; continue; fi
  out=$(npx vitest run src/ 2>&1)
  fails=$(echo "$out" | grep -c "FAIL " || true)
  names=$(echo "$out" | grep "FAIL " | sed 's/.*> //' | cut -c1-60 | paste -sd ' ;; ' -)
  total=$(echo "$out" | grep -E "^ *Tests " | tr -s ' ')
  if [ "$fails" -gt 0 ]; then echo "$m | $gate | KILLED ($fails) | $names"; else echo "$m | $gate | SURVIVED | $total"; fi
  git checkout -- "$f"
done
echo "git status clean: $(git status --porcelain | wc -l | tr -d ' ')"
