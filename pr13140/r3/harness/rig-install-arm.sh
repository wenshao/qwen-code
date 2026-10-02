#!/bin/sh
# usage: rig-install-arm.sh <arm>  — installs /tmp/<arm>-local.tgz as root in two shapes (repo-packed, release-shaped 0644)
set -e
arm=$1; cd /tmp
rm -rf /tmp/norm-$arm && mkdir -p /tmp/norm-$arm && tar -xzf $arm-local.tgz -C /tmp/norm-$arm
find /tmp/norm-$arm -type f -exec chmod 0644 {} + && find /tmp/norm-$arm -type d -exec chmod 0755 {} +
tar --owner=0 --group=0 --numeric-owner -czf /tmp/$arm-rel.tgz -C /tmp/norm-$arm package
for shape in local rel; do
  rm -rf /opt/$arm-$shape
  npm i -g --omit=optional --no-audit --no-fund --loglevel=error --prefix /opt/$arm-$shape ./$arm-$shape.tgz >/dev/null
  P=/opt/$arm-$shape/lib/node_modules/@qwen-code/qwen-code
  echo "$arm-$shape: $(stat -c '%U %a' $P/vendor/landlock-run/arm64-linux/qwen-landlock-run) $(node -e 'console.log(require(process.argv[1]).version)' $P/package.json)"
done
