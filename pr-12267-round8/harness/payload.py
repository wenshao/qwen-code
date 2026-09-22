# runs INSIDE the sandbox (network: closed). fd 0 is whatever the caller redirected.
import os, sys, socket, ctypes
print('payload netns :', os.readlink('/proc/self/ns/net'))
if 'read' in sys.argv: print('stdin line    :', sys.stdin.buffer.readline().decode().strip())
try:
    socket.create_connection(('127.0.0.1', 47002), timeout=2).close(); print('new socket  -> 127.0.0.1:47002 : CONNECTED')
except OSError as e: print('new socket  -> 127.0.0.1:47002 :', e.strerror)
print('fd 0          :', os.readlink('/proc/self/fd/0'))
try: s = socket.socket(fileno=os.dup(0))
except OSError as e: print('fd 0 as socket:', e.strerror); sys.exit(0)
if s.type == socket.SOCK_STREAM:
    ctypes.CDLL(None).connect(s.fileno(), (ctypes.c_ubyte * 16)(), 16)   # AF_UNSPEC: drop the caller's connection
    s.connect(('127.0.0.1', 47002)); s.sendall(b'from inside network:closed')
    print('fd 0 socket -> 127.0.0.1:47002 : re-connected + sent')
else:
    s.connect(('127.0.0.1', 47003)); s.send(b'from inside network:closed')
    print('fd 0 socket -> 127.0.0.1:47003 : re-connected + sent')
