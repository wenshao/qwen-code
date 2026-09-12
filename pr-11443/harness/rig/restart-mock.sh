#!/usr/bin/env bash
# Restart the mock model. Pattern is assembled at runtime so it never matches the caller's argv.
P="rig/mock-""model.mjs"
pkill -f "$P" ; sleep 1
cd /root/git/pr11443-e2e && PORT=18443 LOG_FILE=/root/git/pr11443-e2e/out/mock-model.jsonl nohup node rig/mock-model.mjs > out/mock-model.stderr 2>&1 &
sleep 1; curl -s http://127.0.0.1:18443/v1/models
