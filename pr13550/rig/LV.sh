#!/bin/bash
# Run a script inside the local colima-pr13550 rig container; the script travels on stdin.
printf '%s\n' "$1" | docker --context colima-pr13550 exec -i pr13550-rig bash -c 'cd /rig && exec bash -s'
