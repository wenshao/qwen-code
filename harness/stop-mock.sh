#!/bin/bash
source /root/git/h11576/env.sh
pid=$(ss -lptnH "sport = :$PORT" 2>/dev/null | grep -o 'pid=[0-9]*' | head -1 | cut -d= -f2)
[ -n "${pid:-}" ] && kill "$pid" 2>/dev/null && echo "killed $pid" || echo "not running"
