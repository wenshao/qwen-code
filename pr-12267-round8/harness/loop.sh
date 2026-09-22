#!/bin/bash
# N1: the relay copies a redirected regular file even when the confined command never reads stdin
H=/root/verify/h12267r8; cd $H; Q=$H/q.sh
printf 'alpha\nbravo\ncharlie\ndelta\necho\n' > list.txt
hdr() { printf '\033[1;36m%s\033[0m\n' "$*"; }
arms=${ARMS:-pre head}
hdr '$ while read -r x; do echo "got $x"; done < list.txt                         # no sandbox'
while read -r x; do echo "got $x"; done < list.txt
for ARM in $arms; do
  hdr "\$ while read -r x; do qwen sandbox -- echo \"got \$x\"; done < list.txt    # arm=$ARM"
  while read -r x; do $Q $ARM ww-closed sandbox -- echo "got $x" 2>/dev/null; done < list.txt
done
echo
hdr '$ { head -n1; head -n1; } < list.txt                                          # no sandbox'
{ head -n1; head -n1; } < list.txt
for ARM in $arms; do
  hdr "\$ { qwen sandbox -- head -n1; head -n1; } < list.txt                        # arm=$ARM"
  { $Q $ARM ww-closed sandbox -- head -n1 2>/dev/null; head -n1 || echo '(second head: EOF)'; } < list.txt
done
echo
seq 1 2000000 > big.txt; sz=$(stat -c %s big.txt)
hdr "\$ { qwen sandbox -- true; wc -c; } < big.txt     # big.txt = $sz bytes; bytes left for wc"
printf '  no sandbox: %s\n' "$({ true; wc -c; } < big.txt)"
for ARM in $arms; do for i in 1 2 3; do
  printf '  arm=%-4s run %s: %s\n' $ARM $i "$({ $Q $ARM ww-closed sandbox -- true 2>/dev/null; wc -c; } < big.txt)"
done; done
