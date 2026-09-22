. /root/verify/h12267r6/fig/common.sh; cd /root/verify/h12267r6
hdr "PR #12267 round 6 - R5-1 closure: redirected stdin for 'qwen sandbox -- <cmd>'   (policy workspace-write / closed)"
printf "${D}rig: Linux $(uname -r), Node $(node --version), bubblewrap $(/usr/bin/bwrap --version | cut -d" " -f2)${N}\n"
printf "${D}arms: r6 = 479027b0a7 (previous head, round 5)   r7 = 05f6d76332 (this head)${N}\n\n"
H1=$(sha256sum ws/rand1m.bin | cut -c1-16)
hdr "1) cat rand1m.bin | qwen sandbox -- sha256sum   (x10, host sha256 ${H1}...)"
for a in r6 r7; do n=0; last=''; for i in $(seq 1 10); do r=$(cat ws/rand1m.bin | $Q $a ww-closed sandbox -- sha256sum 2>e.txt); if [ "${r:0:16}" = "$H1" ]; then n=$((n+1)); else [ -z "$last" ] && last=$(filt < e.txt | tail -1); fi; done
  if [ $n = 10 ]; then ok "$a: sha256 matches in $n/10"; else bad "$a: sha256 matches in $n/10   stderr: $last"; fi; done
echo; hdr "2) sleep 3 | qwen sandbox -- echo hi"
for a in r6 r7; do out=$(sleep 3 | $Q $a ww-closed sandbox -- echo hi 2>e.txt); rc=$?; if [ $rc = 0 ]; then ok "$a: rc=$rc stdout='$out'"; else bad "$a: rc=$rc stderr: $(filt < e.txt | tail -1)"; fi; done
echo; hdr "3) (printf 'first\\n'; sleep 1; printf 'second\\n') | qwen sandbox -- cat"
for a in r6 r7; do out=$( (printf 'first\n'; sleep 1; printf 'second\n') | $Q $a ww-closed sandbox -- cat 2>e.txt | tr '\n' ' '); rc=$?; if [ -n "$out" ]; then ok "$a: stdout='$out'"; else bad "$a: no output   stderr: $(filt < e.txt | tail -1)"; fi; done
echo; hdr "4) qwen sandbox -- wc -c < 3 GiB sparse file   (host prints 3221225472)"
for a in r6 r7; do out=$(/usr/bin/time -o t.txt -f 'maxrss=%MkB' $Q $a ww-closed sandbox -- wc -c < big3g.bin 2>e.txt); rc=$?; if [ "$out" = 3221225472 ]; then ok "$a: rc=$rc stdout=$out   CLI $(tail -1 t.txt)"; else bad "$a: rc=$rc stderr: $(filt < e.txt | tail -1)"; fi; done
echo; hdr "5) stdin as a socket (Node spawn, stdio 'pipe'); payload runs: readlink /proc/self/fd/0; cat | wc -c"
for a in r6 r7; do r=$(node spawn-socket.cjs $a); case "$r" in *'\n22"'*) ok "$r";; *) bad "$r";; esac; done
echo; hdr "6) the child's fd 0 is blocking (libuv clears O_NONBLOCK on inherited stdio)"
out=$( (sleep 1) | $Q r7 ww-closed sandbox -- sh -c 'grep flags /proc/self/fdinfo/0' 2>/dev/null); ok "r7: /proc/self/fdinfo/0 in the payload -> $out"
