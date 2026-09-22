import sys, time, hashlib
# read the first `first` bytes promptly, then stall `stall` seconds, then read the rest
first = int(sys.argv[1]); stall = float(sys.argv[2])
h = hashlib.sha256(); n = 0; stalled = False
while True:
    if not stalled and n >= first:
        time.sleep(stall); stalled = True
    b = sys.stdin.buffer.read1(65536)
    if not b: break
    h.update(b); n += len(b)
print(n)
