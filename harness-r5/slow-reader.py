import sys, time, hashlib
h = hashlib.sha256(); n = 0
delay = float(sys.argv[1]) if len(sys.argv) > 1 else 0.002
time.sleep(float(sys.argv[2]) if len(sys.argv) > 2 else 0)
while True:
    b = sys.stdin.buffer.read1(65536)
    if not b: break
    h.update(b); n += len(b); time.sleep(delay)
print(n, h.hexdigest()[:16])
