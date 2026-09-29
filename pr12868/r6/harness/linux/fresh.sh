#!/bin/sh
# Stops the server and every worker in this container, then starts on a new database.
kill -9 $(cat /rig/spring.pid 2>/dev/null) 2>/dev/null
for p in $(pgrep -f 'managed-runtime-[w]orker'); do kill -9 $p; done
sleep 1
exec /rig/start.sh "$1" "$2"
