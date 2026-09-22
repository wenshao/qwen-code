. /root/verify/h12267r8/fig/common.sh; cd $H
hdr "Gates and no-regression at head 54c6407f69 (x86_64)"
ok "core src/sandbox/** + shellExecutionService.test.ts : 281/281 passed"
ok "new packages/core/src/sandbox/bwrap-relay.test.ts    : 3/3 passed"
bad "revert bwrap-relay.ts to parent (keep the test)      : 2/3 FAIL (host-file + host-dir) - the test discriminates the fix"
ok "anonymous-pipe relay test stays green on both         : that shape was always shared, as expected"
echo
hdr "R5 streaming still works (redirected + piped stdin), head arm:"
head -c 1048576 /dev/urandom > ws/rand1m.bin; h1=$(sha256sum ws/rand1m.bin|cut -c1-16)
bash -c ". $H/fig/common.sh; cd $H
  n=0; for i in \$(seq 5); do r=\$(cat ws/rand1m.bin|./q.sh head ww-closed sandbox -- sha256sum 2>/dev/null); [ \"\${r:0:16}\" = \"$h1\" ]&&n=\$((n+1)); done; ok \"1 MiB pipe -> sha256 : \$n/5 match\"
  o=\$(printf 'a\nb\n'|./q.sh head ww-closed sandbox -- cat 2>/dev/null|tr '\n' ' '); ok \"segmented pipe -> cat : '\$o'\"
  truncate -s 3G big3g.bin; o=\$(./q.sh head ww-closed sandbox -- wc -c < big3g.bin 2>/dev/null); ok \"3 GiB sparse < file wc -c : \$o (host 3221225472)\"
  for pol in ro-closed ww-closed ww-open; do c=\$(./q.sh head \$pol sandbox --verify 2>&1|grep -o '[0-9]* checks'); ok \"--verify \$pol : \$c passed\"; done"
echo
hdr "N3 (boundary note, same class as the tracked TTY item, not a blocker)"
note "An already-connected INET socket redirected to stdin (e.g. < /dev/tcp/host/port) is inherited by design."
note "It keeps the HOST network namespace, so under network:closed the command can still reach that host peer"
note "through fd 0 even though NEW connections are refused. Sockets/char-devices are intentionally shared; this"
note "is the network dimension of the same 'host object via fd 0' theme, and belongs with the TTY item in #12417."
