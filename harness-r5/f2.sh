. /root/verify/h12267r5/fig6/common.sh; cd /root/verify/h12267r5
hdr "PR #12267 round 5 (exact head 479027b0a7) - stdout of 'qwen sandbox -- <cmd>'"
printf "${D}r6pre = 034870e561   r6 = 479027b0a7 (head)   r6flush = head + 1-line flush before return${N}\n\n"
hdr "fixed: byte-exact output (NUL + invalid UTF-8 on stdout and stderr, 1 MiB random)"
for a in r6pre r6; do o=$($Q $a ww-closed sandbox -- cat weird.bin 2>/dev/null | od -An -tx1 | tr -s ' '); s=$($Q $a ww-closed sandbox -- cat rand1m.bin 2>/dev/null | sha256sum | cut -c1-16)
  if [ $a = r6 ]; then ok "$a: weird.bin ->$o   rand1m sha=$s (file: $(sha256sum ws/rand1m.bin | cut -c1-16))"; else bad "$a: weird.bin ->${o:- (nothing)}   rand1m sha=$s (empty)"; fi; done
echo; hdr "fixed: slow consumer, 50,000,000 bytes of text  (reader: 64 KiB then 2 ms sleep)"
for a in r6pre r6; do for i in 1 2; do r=$($Q $a ww-closed sandbox -- cat text50m.txt 2>/dev/null | python3 slow-reader.py 0.002); set -- $r
  if [ "$1" = 50000000 ]; then ok "$a run$i: received $1 bytes sha=$2"; else bad "$a run$i: received $1 bytes sha=$2"; fi; done; done
echo; hdr "still open: short tail after a drain  (1 MiB, pause 1 s, then T bytes; reader stalls 3 s after 1 MiB)"
for a in r6 r6flush; do for t in 70000 81919 90000 200000; do exp=$((1048576+t)); r=$($Q $a ww-closed sandbox -- sh -c "head -c 1048576 text50m.txt; sleep 1; head -c $t text50m.txt" 2>/dev/null | python3 burst-reader.py 1048576 3)
  if [ "$r" = "$exp" ]; then ok "$a T=$t: $r / $exp"; else bad "$a T=$t: $r / $exp   lost $((exp-r)) bytes"; fi; done; done
note "cause: only writes that returned false are awaited; a queued tail below highWaterMark is dropped by process.exit() (config.ts:950)"
