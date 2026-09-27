#!/bin/bash
S=<RIG>
for f in $S/logs/$1/*.pid; do [ -f "$f" ] && kill $(cat $f) 2>/dev/null && echo "killed $(basename $f) $(cat $f)"; rm -f $f; done
