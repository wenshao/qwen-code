#!/bin/bash
# In-container boot (round 7): MySQL 8.0 + scripted model (boot6.sh) + the fake Aliyun OSS on :443 / admin 18657.
cd /rig; ./boot6.sh
if ! (exec 3<>/dev/tcp/127.0.0.1/18657) 2>/dev/null; then setsid node /rig/oss/fake-oss.mjs > /rig/runs/fake-oss.log 2>&1 < /dev/null & sleep 2; fi
head -2 /rig/runs/fake-oss.log
