set -e
M=/m; mkdir -p $M
bt() { mount -o loop $1 $M; node -e "const s=require('fs').statSync('$M',{bigint:true}); console.log('$1'.padEnd(26), 'dev='+s.dev, 'ino='+s.ino, 'birthtimeNs='+s.birthtimeNs)"; umount $M; }
for i in 1 2; do dd if=/dev/zero of=/same$i.img bs=1M count=16 status=none; done
mkfs.ext4 -q -F /same1.img; mkfs.ext4 -q -F /same2.img
echo "# two fresh ext4 volumes made back to back"; bt /same1.img; bt /same2.img
dd if=/dev/zero of=/a.img bs=1M count=16 status=none; mkfs.ext4 -q -F /a.img; sleep 1.2
cp /a.img /clone.img
mount -o loop /clone.img $M; echo other > $M/marker; umount $M
echo "# a block-level clone of a.img (then written to)"; bt /a.img; bt /clone.img
tune2fs -l /a.img | grep -E "UUID"; tune2fs -l /clone.img | grep -E "UUID"
