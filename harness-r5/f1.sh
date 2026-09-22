. /root/verify/h12267r5/fig6/common.sh; cd /root/verify/h12267r5
hdr "PR #12267 round 5 (exact head 479027b0a7) - redirected stdin for 'qwen sandbox -- <cmd>' (policy: workspace-write/closed)"
printf "${D}arms: r6pre = 034870e561 (commit 6 of this head)   r6 = 479027b0a7 (this head)${N}\n\n"
hdr "1) a pipe whose writer is still running:  cat rand1m.bin | qwen sandbox -- sha256sum   (x10)"
for a in r6pre r6; do ok=0; last=''; for i in $(seq 1 10); do r=$(cat ws/rand1m.bin | $Q $a ww-closed sandbox -- sha256sum 2>e.txt); [ $? = 0 ] && ok=$((ok+1)); last=$(filt < e.txt | tail -1); done
  if [ $a = r6 ]; then bad "$a: exit 0 in $ok/10   stderr: $last"; else note "$a: exit 0 in $ok/10   (stdin not forwarded: sha256 of empty input ${r:0:12}...)"; fi; done
echo; hdr "2) an idle open pipe:  sleep 3 | qwen sandbox -- echo hi"
for a in r6pre r6; do out=$(sleep 3 | $Q $a ww-closed sandbox -- echo hi 2>e.txt); rc=$?; if [ $rc = 0 ]; then ok "$a: rc=$rc stdout='$out'"; else bad "$a: rc=$rc stdout='$out' stderr: $(filt < e.txt | tail -1)"; fi; done
echo; hdr "3) regular file > 2 GiB:  qwen sandbox -- wc -c < sparse3g.bin   (host prints 3221225472)"
truncate -s 3G out/sparse3g.bin; for a in r6pre r6; do out=$($Q $a ww-closed sandbox -- wc -c < out/sparse3g.bin 2>e.txt); rc=$?; if [ $rc = 0 ]; then note "$a: rc=$rc stdout='$out' (stdin ignored)"; else bad "$a: rc=$rc stderr: $(filt < e.txt | tail -1)"; fi; done; rm -f out/sparse3g.bin
echo; hdr "4) stdin as a socket (Node child_process spawn, stdio 'pipe'): 22 bytes written"
for a in r6pre r6; do note "$(node spawn-socket.cjs $a)"; done
echo; hdr "cause: fd 0 is already O_NONBLOCK when readRedirectedStdin() runs; readFileSync(0) then throws EAGAIN"
printf "  /proc/self/fdinfo/0 inside the CLI:  ${R}flags: 02004000${N}  (plain node on the same pipe: 02000000)\n"
printf "  first process.stdin access: node:internal/bootstrap/realm BuiltinModule.syncExports (ESM facade of node:process)\n"
