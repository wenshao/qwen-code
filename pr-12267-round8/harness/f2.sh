. /root/verify/h12267r8/fig/common.sh; cd $H
hdr "N1 (new regression, introduced by this commit) - qwen sandbox -- <cmd> over-reads a redirected regular file"
dim "The relay copies fd 0 with createReadStream, reading ahead bytes the command never consumes."
dim "Because bash shares one file offset across the redirect, a later reader of the same fd loses them."
echo
hdr "\$ while read -r x; do qwen sandbox -- echo \"got \$x\"; done < list.txt      (list.txt has 5 lines)"
printf 'alpha\nbravo\ncharlie\ndelta\necho\n' > list.txt
for ARM in pre head; do
  printf "  ${B}arm=%-4s${N}\n" $ARM
  while read -r x; do printf '    %s\n' "$($Q $ARM ww-closed sandbox -- echo "got $x" 2>/dev/null)"; done < list.txt
  if [ "$ARM" = pre ]; then ok "pre: all 5 lines reach the loop (fd inherited; echo reads nothing, offset unchanged)"
  else bad "head: only the 1st line survives - the relay drained the file to EOF on the first iteration"; fi
done
echo
hdr "\$ { qwen sandbox -- true; wc -c; } < big.txt        (measures the caller's REMAINING stdin)"
seq 1 2000000 > big.txt; sz=$(stat -c %s big.txt)
dim "  big.txt = $sz bytes;  the command 'true' reads nothing, so a correct sandbox leaves all $sz for wc"
for ARM in pre head; do
  left=$(bash -c "exec 9<big.txt; ./q.sh $ARM ww-closed sandbox -- true <&9 >/dev/null 2>&1; wc -c <&9")
  lost=$((sz-left))
  if [ $lost = 0 ]; then ok "arm=$ARM  remaining=$left  lost=0"
  else bad "arm=$ARM  remaining=$left  lost=$lost bytes  (silently consumed by the relay)"; fi
done
