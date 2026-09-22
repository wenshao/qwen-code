. /root/verify/h12267r8/fig/common.sh; cd $H
hdr "N2 (new regression, introduced by this commit) - a redirected named FIFO hangs the CLI until the writer closes"
dim "Copied descriptors are read with createReadStream; the libuv blocking read cannot be cancelled when the"
dim "command exits, so the CLI stays alive until the FIFO's writer closes - long after the output is produced."
echo
hdr "\$ qwen sandbox -- head -n1 < f.fifo      (background writer sends 'first\\n', then holds the FIFO open)"
row(){ local hold=$1 arm=$2; rm -f f.fifo; mkfifo f.fifo
  python3 -c 'import os,sys,time; fd=os.open(sys.argv[1],os.O_WRONLY); os.write(fd,b"first\n"); time.sleep(float(sys.argv[2]))' f.fifo $hold & local wp=$!
  local t0=$(date +%s%N); out=$(timeout -k2 40 $Q $arm ww-closed sandbox -- head -n1 < f.fifo 2>/dev/null); local ms=$(( ($(date +%s%N)-t0)/1000000 ))
  if [ "$arm" = pre ]; then ok "$(printf 'writer holds %ss  arm=%-4s  out=%-6s  CLI returned in %6s ms  (returns as soon as head exits)' $hold $arm "$out" $ms)"
  else note "$(printf 'writer holds %ss  arm=%-4s  out=%-6s  CLI returned in %6s ms  (blocks until the writer closes)' $hold $arm "$out" $ms)"; fi
  kill $wp 2>/dev/null; }
bash -c "$(declare -f row ok note); . $H/fig/common.sh; cd $H; for hold in 3 6; do for a in pre head; do row \$hold \$a; done; done"
rm -f f.fifo
echo
note "The return time on head tracks the writer's hold time exactly (3s->3.0s, 6s->6.0s); pre is flat at ~0.6s."
dim  "Root cause: relay's createReadStream(fd:0) leaves a blocking read in the libuv threadpool; child-close"
dim  "fires source.destroy() but cannot interrupt the in-flight kernel read on the FIFO."
