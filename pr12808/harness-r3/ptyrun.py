import os, pty, subprocess, sys, select
master, slave = pty.openpty()
env = dict(os.environ, TERM='xterm-256color')
env.pop('NO_COLOR', None); env.pop('FORCE_COLOR', None); env.pop('CI', None)
p = subprocess.Popen(sys.argv[1:], stdout=slave, stderr=slave, stdin=subprocess.DEVNULL, env=env)
os.close(slave)
out = b''
while True:
    r, _, _ = select.select([master], [], [], 0.5)
    if r:
        try:
            chunk = os.read(master, 65536)
        except OSError:
            break
        if not chunk:
            break
        out += chunk
    elif p.poll() is not None:
        break
p.wait()
sys.stdout.write(out.decode(errors='replace').replace('\r', ''))
print(f'[exit {p.returncode}]')
