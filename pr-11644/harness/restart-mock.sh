#!/bin/bash
for p in $(pgrep -f "node mock-openai.mjs"); do kill $p; done
sleep 1
cd /root/git/h11644 && exec node mock-openai.mjs >> mock.log 2>&1
