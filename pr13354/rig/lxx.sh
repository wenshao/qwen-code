#!/bin/bash
# host-side: run a command inside the rig container.  usage: lxx.sh <cmd...>
exec docker --context colima-pr13354 exec pr13354-lx bash -c "$*"
