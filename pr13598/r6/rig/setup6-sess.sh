#!/bin/bash
cd /Users/wenshao/git/pr13598-rig; source mk4.sh
for s in "a6 A1" "a6 A2" "a6 A3" "s6 S1" "s6 S2" "s6 S3" "f6 F1" "f6 F2"; do set -- $s; mks $1 $2 2>&1 | tail -1; done
