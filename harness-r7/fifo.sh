#!/bin/bash
# Named FIFO is a host inode. The fix's readlink pipe: check must copy it (not share),
# so payload bytes are intact but it cannot chmod the host FIFO. Parent shares the fd -> chmod works.
V=/root/verify/r7; cd $V
Q=$V/q.sh
filt() { grep -v -e '^Boundary' -e '^Filesystem' -e '^Command network' -e '^Model,' -e '^Host reads' -e '^Backend probe' -e '^Requested' -e '^Effective' -e '^Workspace'; }
echo "=== named FIFO edge (policy read-only/closed) ==="
for ARM in "$@"; do
  rm -f myfifo; mkfifo -m 644 myfifo
  ( printf 'fifo-payload-bytes\n' > myfifo ) &
  out=$($Q $ARM ro-closed sandbox -- sh -c 'echo "link=$(readlink /proc/self/fd/0)"; echo "data=[$(cat)]"; chmod 666 /proc/self/fd/0 2>&1 && echo "chmod=ok" || echo "chmod-blocked"' < myfifo 2>&1 | filt | tr '\n' ' ')
  wait
  printf '%-2s | named FIFO | %s|| host FIFO mode now: %s\n' $ARM "$out" "$(stat -c %a myfifo)"
  rm -f myfifo
done
