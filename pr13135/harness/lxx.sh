#!/bin/bash
# host-side: run a command inside the rig container.  usage: lxx.sh <cmd...>
exec docker --context colima-pr13135 exec pr13135-lx bash -c "$*"
