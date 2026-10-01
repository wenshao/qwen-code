#!/bin/sh
# Install base/head as root into separate global prefixes; *-rel prefixes mirror
# the published release tarball (every file mode normalized to 0644).
set -e
cd /tmp
for arm in base head; do
  rm -rf /tmp/norm-$arm && mkdir -p /tmp/norm-$arm
  tar -xzf $arm-local.tgz -C /tmp/norm-$arm
  find /tmp/norm-$arm -type f -exec chmod 0644 {} +
  find /tmp/norm-$arm -type d -exec chmod 0755 {} +
  tar --owner=0 --group=0 --numeric-owner -czf /tmp/$arm-rel.tgz -C /tmp/norm-$arm package
  for shape in local rel; do
    rm -rf /opt/$arm-$shape
    npm i -g --omit=optional --no-audit --no-fund --loglevel=error --prefix /opt/$arm-$shape ./$arm-$shape.tgz
    P=/opt/$arm-$shape/lib/node_modules/@qwen-code/qwen-code
    echo "$arm-$shape: $(stat -c '%U %a' $P/vendor/landlock-run/arm64-linux/qwen-landlock-run) relay=$(ls $P/sandboxBwrapRelay.js)"
  done
done
