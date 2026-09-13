#!/bin/bash
/root/git/h11644/killd.sh
for p in $(pgrep -f "node mock-openai.mjs"); do kill $p; done
echo "mock stopped"
