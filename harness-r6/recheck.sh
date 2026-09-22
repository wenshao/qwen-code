cd /root/verify/h12267r6
E=$(python3 -c "import hashlib;print(hashlib.sha256(open('ws/text50m.txt','rb').read()).hexdigest()[:16])")
for i in 1 2 3; do r=$(timeout -k 2 120 ./q.sh r7 ww-closed sandbox -- cat text50m.txt 2>/dev/null | python3 slow-reader.py 0.002); echo "slow consumer run $i: $r (expected 50000000 $E)"; done
echo "fixture: $(od -An -tx1 ws/weird.bin)"
echo "stdout:  $(./q.sh r7 ww-closed sandbox -- cat weird.bin 2>/dev/null | od -An -tx1)"
echo "stderr:  $(./q.sh r7 ww-closed sandbox -- sh -c 'cat weird.bin >&2' 2>&1 >/dev/null | tail -c 8 | od -An -tx1)"
H=$(sha256sum ws/rand1m.bin | cut -c1-16); echo "rand1m stdout sha: $(./q.sh r7 ww-closed sandbox -- cat rand1m.bin 2>/dev/null | sha256sum | cut -c1-16) expected $H"
