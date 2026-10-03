#!/bin/bash
# PR #13243: remaining arms, sequential. Head f877 extra scenarios on a fresh DB; base full; ffc4 S2/S7; mutant S6.
cd /Users/wenshao/pr13129-rig
./run-r43.sh h43f r43f2 s2b,s2c
./run-r43.sh b43 r43b
./run-r43.sh h43 r43h s2,s7
./run-r43.sh h43m r43m s6
echo "ALL-ARMS-DONE $(date -u +%T)"
