#!/bin/bash
cd /rig; pkill -f /rig/fakemodel.mjs; nohup node /rig/fakemodel.mjs > /rig/runs/model.log 2>&1 < /dev/null &
sleep 3; grep -o 'http://[^ ]*' /rig/runs/model.log | head -1 > /rig/runs/model.url; cat /rig/runs/model.url
