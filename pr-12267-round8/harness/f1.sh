. /root/verify/h12267r8/fig/common.sh; cd $H
hdr "PR #12267 round 8 - R6-1 stays closed on x86_64  (redirected host descriptor cannot bypass the policy)"
dim "rig: Linux $(uname -r) x86_64, Node $(node --version), bubblewrap $(bwrap --version|cut -d' ' -f2) (private overlay)"
dim "arms:  pre = 0b4349f088 (rebased round-6 head, HAD the escape)     head = 54c6407f69 (the R6-1 fix)"
dim "policy: filesystem=read-only, network=closed   |   payload:  qwen sandbox -- sh -c '<probe>'  <redirect>"
reset(){ rm -rf hostdir; mkdir -p hostdir/sub; printf 'original\n'>hostdir/victim.txt; chmod 644 hostdir/victim.txt; }
run(){ local arm=$1 redir=$2 cmd=$3; $Q $arm ro-closed sandbox -- sh -c "$cmd 2>/dev/null && echo WROTE || echo REFUSED" < $redir 2>&1|filt|tr '\n' ' '; }
echo; hdr "\$ qwen sandbox -- sh -c 'echo via-fd0 > /proc/self/fd/0'      < host file (outside workspace)"
for arm in pre head; do reset; o=$(run $arm hostdir/victim.txt 'echo via-fd0 > /proc/self/fd/0'); s=$(cat hostdir/victim.txt)
  [ "$s" = via-fd0 ] && bad "$arm : $o ->  host file is now '$s'   [ESCAPED - host file overwritten]" || ok "$arm : $o ->  host file is still '$s'   [blocked]"; done
echo; hdr "\$ qwen sandbox -- sh -c 'echo up > /proc/self/fd/0/../escaped-up.txt'      < host directory"
for arm in pre head; do reset; o=$(run $arm hostdir/sub 'echo up > /proc/self/fd/0/../escaped-up.txt'); s=$(ls hostdir/escaped-up.txt 2>/dev/null||echo '(nothing planted)')
  case "$s" in *escaped-up*) bad "$arm : $o ->  on host: $s   [ESCAPED - walked .. out of the dir fd]";; *) ok "$arm : $o ->  on host: $s   [blocked]";; esac; done
echo; hdr "\$ qwen sandbox -- sh -c 'chmod 666 /proc/self/fd/0'      < host file"
for arm in pre head; do reset; o=$(run $arm hostdir/victim.txt 'chmod 666 /proc/self/fd/0'); s=$(stat -c %a hostdir/victim.txt)
  [ "$s" = 666 ] && bad "$arm : $o ->  host file mode is now $s   [ESCAPED - host file chmod'd]" || ok "$arm : $o ->  host file mode still $s   [blocked - chmod hit the relay pipe]"; done
reset; echo
note "head: fd 0 is a relay-owned pipe, so /proc/self/fd/0 no longer names the host object. All three escapes are closed."
