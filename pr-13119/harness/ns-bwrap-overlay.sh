#!/bin/bash
# Run "$@" in a private mount namespace where /usr/bin/bwrap exists (read-only overlay).
# Host /usr/bin is untouched.
exec unshare -m --propagation private bash -c '
  mount -t overlay overlay -o lowerdir=/root/verify/pr13119/bwrap-private/lower:/usr/bin /usr/bin || exit 97
  exec "$@"' ns-bwrap "$@"
