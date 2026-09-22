#!/bin/bash
set -e
V=/root/verify/r7
mkdir -p $V/ws
pol() { # name fs net
  mkdir -p $V/home-$1
  printf '{"tools":{"executionSandbox":{"backend":"auto","filesystem":"%s","network":"%s"}}}\n' "$2" "$3" > $V/home-$1/settings.json
}
pol ro-closed read-only closed
pol ro-open   read-only open
pol ww-closed workspace-write closed
pol ww-open   workspace-write open
echo "homes ready:"; for p in ro-closed ro-open ww-closed ww-open; do echo "  home-$p: $(cat $V/home-$p/settings.json)"; done
