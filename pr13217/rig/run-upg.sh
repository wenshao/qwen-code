#!/bin/bash
cd /Users/wenshao/pr13217-rig
for c in upg-1-main upg-2-pr upg-3-main upg-4-pr; do echo "=== $(date +%T) $c"; node rig.mjs configs/$c.json > runs-$c.out 2>&1; grep -E "RESULT" runs-$c.out; done
echo "=== $(date +%T) UPG-DONE"
