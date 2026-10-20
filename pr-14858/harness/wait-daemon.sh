#!/bin/bash
for i in $(seq 1 90); do c=$(curl -s --noproxy '*' -o /dev/null -w '%{http_code}' -H 'authorization: Bearer tok14858' http://127.0.0.1:$1/capabilities); [ "$c" = 200 ] && break; python3 -c "import time;time.sleep(1)"; done; echo "port $1 cap=$c"
