#!/bin/bash
# usage: waitfile.sh <file> <timeoutSeconds>
for i in $(seq 1 $(( $2 * 4 ))); do [ -f "$1" ] && exit 0; sleep 0.25; done; exit 1
