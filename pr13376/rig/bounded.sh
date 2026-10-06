#!/bin/bash
# usage: bounded.sh <seconds> cmd... — SIGALRM after the bound (probe-waits-need-a-bound)
s=$1; shift
exec perl -e 'alarm shift; exec @ARGV or die "exec: $!"' "$s" "$@"
