#!/bin/bash
# daemon workers scrub NODE_OPTIONS, so the preload can't reach them: point the QQ hosts at the
# harness loopback via /etc/hosts for the duration of the run, and always remove the entries.
set -u
MARK="# pr13250-harness"
cleanup() { sed -i "/$MARK/d" /etc/hosts; }
trap cleanup EXIT
for h in bots.qq.com api.sgroup.qq.com sandbox.api.sgroup.qq.com multimedia.nt.qq.com.cn; do echo "127.13.250.1 $h $MARK" >> /etc/hosts; done
getent hosts bots.qq.com
for arm in "$@"; do timeout 300 node scenarios/s4-daemon.cjs $arm 2>&1 | grep -v "DAEMON\]" | tail -16; done
