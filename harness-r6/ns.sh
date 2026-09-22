#!/bin/bash
# run "$@" in a private mount namespace where /usr/bin/bwrap exists (overlay; host untouched)
exec unshare -m --propagation private bash -c 'mount -t overlay overlay -o lowerdir=/usr/bin,upperdir=/root/verify/h12267r6/bwrap-private/upper,workdir=/root/verify/h12267r6/bwrap-private/work /usr/bin && exec "$@"' ns "$@"
