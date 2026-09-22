. /root/verify/h12267r6/fig/common.sh; cd /root/verify/h12267r6
hdr "PR #12267 round 6 - R6-1 (new): redirected stdin reaches the payload as the host descriptor"
printf "${D}rig: Linux $(uname -r), Node $(node --version), bubblewrap $(/usr/bin/bwrap --version | cut -d" " -f2)${N}\n"
printf "${D}arms: r6 = 479027b0a7 (previous head)   r7 = 05f6d76332 (this head)   r7+patch = this head + relay patch below${N}\n"
printf "${D}policy: filesystem read-only, network closed (the report line says 'Filesystem: read-only')${N}\n\n"
reset() { rm -rf hostdir; mkdir -p hostdir/sub; printf 'original\n' > hostdir/victim.txt; chmod 644 hostdir/victim.txt; printf 'ws-original\n' > ws/ws-victim.txt; }
name() { case $1 in r7fix) echo "r7+patch";; *) echo $1;; esac; }
hdr "1) qwen sandbox -- sh -c 'echo direct > \$HOST_FILE; echo via-fd0 > /proc/self/fd/0' < \$HOST_FILE   (file outside the workspace)"
for a in r6 r7 r7fix; do reset; out=$($Q $a ro-closed sandbox -- sh -c 'echo direct > /root/verify/h12267r6/hostdir/victim.txt 2>/dev/null || echo "direct write: EROFS"; echo via-fd0 > /proc/self/fd/0 2>/dev/null && echo "fd0 write: ok" || echo "fd0 write: denied"' < hostdir/victim.txt 2>/dev/null | tr '\n' ';'); c=$(cat hostdir/victim.txt)
  m="$(name $a): ${out}  host file now: '$c'"; [ "$c" = original ] && ok "$m" || bad "$m"; done
echo; hdr "2) same, file inside the read-only workspace:  ... < ws/ws-victim.txt"
for a in r6 r7 r7fix; do reset; $Q $a ro-closed sandbox -- sh -c 'echo via-fd0 > /proc/self/fd/0' < ws/ws-victim.txt >/dev/null 2>&1; c=$(cat ws/ws-victim.txt); m="$(name $a): workspace file now: '$c'"; [ "$c" = ws-original ] && ok "$m" || bad "$m"; done
echo; hdr "3) a directory on stdin:  ... sh -c 'echo x > /proc/self/fd/0/planted.txt; echo y > /proc/self/fd/0/../escaped-up.txt' < hostdir/sub"
for a in r6 r7 r7fix; do reset; $Q $a ro-closed sandbox -- sh -c 'echo x > /proc/self/fd/0/planted.txt; echo y > /proc/self/fd/0/../escaped-up.txt' < hostdir/sub >/dev/null 2>&1; f=$(cd hostdir && ls sub/planted.txt escaped-up.txt 2>/dev/null | tr '\n' ' '); m="$(name $a): created on the host: ${f:-nothing}"; [ -z "$f" ] && ok "$m" || bad "$m"; done
echo; hdr "4) uid 65534, directory on stdin, walk '..' to the host root and write a file the user owns elsewhere"
for a in r6 r7 r7fix; do rm -f nobody/victims/from-host-root.txt
  (cd nobody/ws && setpriv --reuid=65534 --regid=65534 --clear-groups env HOME=/root/verify/h12267r6/nobody QWEN_HOME=/root/verify/h12267r6/nobody/home-ro-closed QWEN_CODE_SYSTEM_SETTINGS_PATH=/nonexistent/sys.json QWEN_CODE_SYSTEM_DEFAULTS_PATH=/nonexistent/sysdef.json node /root/verify/pr12267-$a/dist/cli.js sandbox -- sh -c 'echo rooted > /proc/self/fd/0/../../../../../../../../../root/verify/h12267r6/nobody/victims/from-host-root.txt' < /root/verify/h12267r6/nobody/victims/sub >/dev/null 2>&1)
  if [ -f nobody/victims/from-host-root.txt ]; then bad "$(name $a): /root/verify/h12267r6/nobody/victims/from-host-root.txt written (owner $(stat -c %U nobody/victims/from-host-root.txt))"; else ok "$(name $a): nothing written"; fi; done
rm -f nobody/victims/from-host-root.txt
echo; hdr "5) chmod through the descriptor:  ... sh -c 'chmod 666 /proc/self/fd/0' < \$HOST_FILE   (host mode was 644)"
for a in r6 r7 r7fix; do reset; $Q $a ro-closed sandbox -- sh -c 'chmod 666 /proc/self/fd/0' < hostdir/victim.txt >/dev/null 2>&1; m=$(stat -c %a hostdir/victim.txt); [ $m = 644 ] && ok "$(name $a): host mode $m" || bad "$(name $a): host mode $m"; done
reset
echo; note "stdout/stderr already travel through relay-owned pipes; stdin now hands over the caller's own fd 0."
note "/proc/self/fd/0 is a magic link: it resolves to the host mount, which is writable, not to the read-only bind."
