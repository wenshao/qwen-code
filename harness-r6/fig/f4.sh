. /root/verify/h12267r6/fig/common.sh; cd /root/verify/h12267r6
hdr "PR #12267 round 6 - relay patch keeps every stdin shape working   (policy workspace-write / closed)"
printf "${D}rig: Linux $(uname -r), Node $(node --version), bubblewrap $(/usr/bin/bwrap --version | cut -d" " -f2)${N}\n"
printf "${D}r7 = 05f6d76332 (this head)   r7+patch = same bundle, sandboxBwrapRelay.js patched as in the report${N}\n\n"
H1=$(sha256sum ws/rand1m.bin | cut -c1-16)
row() { printf "  %-50s  " "$1"; shift; for a in r7 r7fix; do r=$("$@" $a); [ "$r" = PASS ] && printf "${G}%-9s${N}" "$r" || printf "${R}%-9s${N}" "$r"; done; echo; }
printf "  %-50s  %-9s%-9s\n" "" "r7" "r7+patch"
t_cat() { n=0; for i in 1 2 3 4 5; do r=$(cat ws/rand1m.bin | $Q $1 ww-closed sandbox -- sha256sum 2>/dev/null); [ "${r:0:16}" = "$H1" ] && n=$((n+1)); done; [ $n = 5 ] && echo PASS || echo "FAIL $n/5"; }
t_file() { r=$($Q $1 ww-closed sandbox -- sha256sum < ws/rand1m.bin 2>/dev/null); [ "${r:0:16}" = "$H1" ] && echo PASS || echo FAIL; }
t_idle() { r=$(sleep 2 | $Q $1 ww-closed sandbox -- echo hi 2>/dev/null); [ "$r" = hi ] && echo PASS || echo FAIL; }
t_seg() { r=$( (printf 'first\n'; sleep 1; printf 'second\n') | $Q $1 ww-closed sandbox -- cat 2>/dev/null | tr '\n' ' '); [ "$r" = "first second " ] && echo PASS || echo FAIL; }
t_big() { r=$($Q $1 ww-closed sandbox -- wc -c < big3g.bin 2>/dev/null); [ "$r" = 3221225472 ] && echo PASS || echo FAIL; }
t_unread() { r=$(timeout -k 2 20 $Q $1 ww-closed sandbox -- echo hi < big3g.bin 2>/dev/null); [ "$r" = hi ] && echo PASS || echo FAIL; }
t_sock() { r=$(node spawn-socket.cjs $1); case "$r" in *'\n22"'*) echo PASS;; *) echo FAIL;; esac; }
t_null() { r=$($Q $1 ww-closed sandbox -- wc -c < /dev/null 2>/dev/null); [ "$r" = 0 ] && echo PASS || echo FAIL; }
t_yes() { r=$(yes | timeout -k 2 20 $Q $1 ww-closed sandbox -- head -n1 2>/dev/null); [ "$r" = y ] && echo PASS || echo FAIL; }
t_epipe() { timeout -k 2 20 $Q $1 ww-closed sandbox -- yes 2>/dev/null | head -n1 >/dev/null; [ ${PIPESTATUS[0]} = 141 ] && echo PASS || echo FAIL; }
t_fifo() { rm -f nf; mkfifo -m 600 nf; ( (printf 'one\n'; sleep 1; printf 'two\n') > nf & ); r=$($Q $1 ww-closed sandbox -- sh -c 'cat; chmod 666 /proc/self/fd/0 2>/dev/null' < nf 2>/dev/null | tr '\n' ' '); m=$(stat -c %a nf); rm -f nf; [ "$r" = "one two " ] && [ $m = 600 ] && echo PASS || echo "FAIL:$m"; }
row "cat 1 MiB | sha256sum  (x5)" t_cat
row "sha256sum < 1 MiB file" t_file
row "sleep 2 | echo hi" t_idle
row "segmented writer | cat" t_seg
row "wc -c < 3 GiB sparse file" t_big
row "echo hi < 3 GiB file (input never read)" t_unread
row "socket stdin (Node spawn), 22 bytes" t_sock
row "wc -c < /dev/null" t_null
row "yes | head -n1" t_yes
row "yes | head -n1 on the output side -> rc 141" t_epipe
row "named FIFO: data intact, host FIFO mode unchanged" t_fifo
echo
hdr "model tool path (scripted model -> run_shell_command), prompt piped on the CLI's stdin"
for a in r7 r7fix; do rm -f tool-outside.txt; echo 'echo x > /root/verify/h12267r6/tool-outside.txt 2>/dev/null || echo EROFS; echo "pids=$(ls /proc | grep -cE "^[0-9]+$") stdin=$(readlink /proc/self/fd/0) bytes=$(timeout 2 cat | wc -c)"' > fake-tool-cmd.txt
  echo "PROMPT-ON-STDIN" | timeout -k 2 90 $Q $a ww-closed --approval-mode yolo --auth-type openai --openai-api-key dummy --openai-base-url http://127.0.0.1:18461/v1 --model dummy -o stream-json -p "run the probe" > out/fig-tool-$a.jsonl 2>/dev/null
  r=$(grep '"tool_result"' out/fig-tool-$a.jsonl | head -1 | python3 -c 'import sys,json
for l in sys.stdin:
  for c in json.loads(l).get("message",{}).get("content",[]):
    if c.get("type")=="tool_result": print(str(c.get("content")).replace(chr(10)," "))') ; r=$(echo "$r" | sed 's#/bin/bash: line 1: /root/verify/h12267r6/tool-outside.txt: Read-only file system##')
  m="$(case $a in r7fix) echo r7+patch;; *) echo $a;; esac): outside write -> $r  host file: $([ -f tool-outside.txt ] && echo WRITTEN || echo absent)"; [ -f tool-outside.txt ] && bad "$m" || ok "$m"; done; rm -f fake-tool-cmd.txt tool-outside.txt
