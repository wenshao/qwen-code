#!/bin/bash
cd /Users/wenshao/pr13217-rig
for c in ab-main ab-pr ab-pr0; do echo "=== $(date +%T) $c"; node rig.mjs configs/$c.json > runs-$c.out 2>&1; grep -E "RESULT" runs-$c.out; done
echo "=== $(date +%T) AB-DONE"
