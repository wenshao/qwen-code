# End-to-end stdin/stdout checks through the installed CLI: `qwen sandbox -- ...`
# usage: python3 rig-stdio.py <arm-label> <cli-entry.js>   (run as uid 1000, cwd = workspace)
import hashlib, json, os, socket, subprocess, sys, tempfile, threading, time

ARM, CLI = sys.argv[1], sys.argv[2]
QW = ['node', CLI, 'sandbox', '--']
rows = []

def rec(case, **kw):
    kw.update(arm=ARM, case=case)
    rows.append(kw)
    print(json.dumps(kw), flush=True)

def run(cmd, stdin, timeout=30, **kw):
    t = time.time()
    try:
        p = subprocess.run(QW + cmd, stdin=stdin, capture_output=True, timeout=timeout, **kw)
        return p.returncode, p.stdout, p.stderr, round(time.time() - t, 2)
    except subprocess.TimeoutExpired as e:
        return 'TIMEOUT', e.stdout or b'', e.stderr or b'', round(time.time() - t, 2)

def payload_tail(out):
    # drop the report lines the subcommand prints to stderr; payload output is stdout
    return out

data = bytes((i * 7 + 3) % 251 for i in range(1 << 20))  # 1 MiB, position-identifiable
with tempfile.NamedTemporaryFile(dir=os.getcwd() + '/../', delete=False) as f:
    f.write(data); src = f.name

# 1) regular-file stdin: payload consumes N bytes, then the caller continues from the shared offset
for n in [0, 7, 4096 + 5]:
    with open(src, 'rb') as fh:
        fh.seek(17)
        prog = f'import os,sys; b=os.read(0,{n}) if {n} else b""; sys.stdout.write(str(len(b)))'
        rc, out, err, dt = run(['python3', '-c', prog], fh)
        after = fh.tell()
        nxt = fh.read(8)
    rec('regular-offset', consumed=n, exit=rc, payloadRead=out.decode(), offsetAfter=after,
        expectedOffset=17 + n, nextBytesMatch=nxt == data[17 + n:17 + n + 8], secs=dt,
        err=err.decode()[-160:] if rc else '')

# 2) `head -n 1` on regular stdin: native vs sandbox offset (pipe cannot seek back)
lines = b''.join(b'line-%04d\n' % i for i in range(2000))
with tempfile.NamedTemporaryFile(dir=os.getcwd() + '/../', delete=False) as f:
    f.write(lines); lsrc = f.name
with open(lsrc, 'rb') as fh:
    subprocess.run(['head', '-n', '1'], stdin=fh, capture_output=True); native = fh.tell()
with open(lsrc, 'rb') as fh:
    rc, out, err, dt = run(['head', '-n', '1'], fh); sandboxed = fh.tell()
rec('head-n1-offset', exit=rc, out=out.decode().strip(), nativeOffset=native, sandboxOffset=sandboxed)

# 3) full-consumption integrity of 1 MiB
with open(src, 'rb') as fh:
    rc, out, err, dt = run(['sha256sum'], fh); after = fh.tell()
rec('sha256-1MiB', exit=rc, match=out.split()[0].decode() == hashlib.sha256(data).hexdigest() if out else False,
    offsetAfter=after, size=len(data), secs=dt)

# 4) named FIFO with an idle writer that never closes: command must not wait for EOF
d = tempfile.mkdtemp(dir=os.getcwd() + '/../')
fifo = os.path.join(d, 'in'); os.mkfifo(fifo)
w = os.open(fifo, os.O_RDWR)  # keeps a writer open
os.write(w, b'hello-from-fifo\n')
r = os.open(fifo, os.O_RDONLY)
rc, out, err, dt = run(['sh', '-c', 'read l; echo got:$l'], r, timeout=20)
rec('fifo-idle-writer-reads', exit=rc, out=out.decode().strip(), secs=dt, err=err.decode()[-160:] if rc != 0 else '')
rc, out, err, dt = run(['echo', 'no-read'], r, timeout=20)
rec('fifo-idle-writer-noread', exit=rc, out=out.decode().strip(), secs=dt, err=err.decode()[-160:] if rc != 0 else '')
os.close(r); os.close(w)

# 5) connected TCP socket as stdin under network: closed -> retained; fresh connect denied
ls = socket.socket(); ls.bind(('127.0.0.1', 0)); ls.listen(4); port = ls.getsockname()[1]
caller = socket.create_connection(('127.0.0.1', port)); peer, _ = ls.accept()
peer.sendall(b'capability')
prog = f'''
import os, socket
d = os.read(0, 10); os.write(0, b"reply")
s = socket.socket(); s.settimeout(2)
try:
    s.connect(("127.0.0.1", {port})); fresh = "connected"
except OSError as e:
    fresh = "denied:" + type(e).__name__
print(d.decode(), fresh)
'''
rc, out, err, dt = run(['python3', '-c', prog], caller)
peer.settimeout(2)
try: back = peer.recv(5).decode()
except Exception as e: back = 'ERR ' + str(e)
rec('socket-stdin-closed-net', exit=rc, out=out.decode().strip(), peerGot=back)
caller.close(); peer.close(); ls.close()

# 6) directory as stdin must not reach the payload as a host descriptor
rc, out, err, dt = run(['sh', '-c', 'ls -la /proc/self/fd/0; cat >/dev/null; echo rc=$?'], os.open('/tmp', os.O_RDONLY | os.O_DIRECTORY), timeout=20)
rec('directory-stdin', exit=rc, out=out.decode().strip()[-200:], err=err.decode()[-200:] if rc else '')

# 7) slow independent stdout/stderr readers; distinct short trailing writes must arrive
prog = 'import os,sys\nfor i in range(200):\n    os.write(1, b"o"*65536); os.write(2, b"e"*16384)\nos.write(1, b"TAIL-OUT"); os.write(2, b"TAIL-ERR")\n'
p = subprocess.Popen(QW + ['python3', '-c', prog], stdin=subprocess.DEVNULL, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
bufs = {'out': b'', 'err': b''}
def slow(name, stream):
    time.sleep(1.5)
    while True:
        chunk = stream.read(8192)
        if not chunk: break
        bufs[name] += chunk
        time.sleep(0.0005)
ts = [threading.Thread(target=slow, args=('out', p.stdout)), threading.Thread(target=slow, args=('err', p.stderr))]
[t.start() for t in ts]; rc = p.wait(timeout=120); [t.join() for t in ts]
rec('slow-readers', exit=rc, stdoutBytes=len(bufs['out']), stdoutExpected=200 * 65536 + 8,
    stdoutTail=bufs['out'][-8:].decode(), stderrTail=bufs['err'][-8:].decode())

# 8) downstream closes early: exit 141
rc = subprocess.run(['bash', '-c', 'node ' + CLI + ' sandbox -- yes 2>/dev/null | head -n 1 >/dev/null; echo ${PIPESTATUS[0]}'],
                    capture_output=True, timeout=60).stdout.decode().strip()
rec('epipe-exit', qwenExit=rc)

os.unlink(src); os.unlink(lsrc)
