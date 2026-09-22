# host-namespace listeners: 47001 = the peer handed to stdin (sends a greeting, then stays idle 20 s);
# 47002/tcp and 47003/udp = oracles that nothing inside network:closed should reach
import socket, threading, sys, time
log = open(sys.argv[1], 'a', buffering=1)
def hold(c):
    try: c.sendall(b'greeting-from-peer\n'); time.sleep(20); c.close()
    except OSError: pass
def tcp(port, oracle):
    s = socket.socket(); s.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1); s.bind(('127.0.0.1', port)); s.listen(8)
    while True:
        c, a = s.accept()
        if oracle:
            data = c.recv(200); log.write(f'[host listener 127.0.0.1:{port}/tcp] accepted from {a[0]}:{a[1]} data={data!r}\n'); c.close()
        else: threading.Thread(target=hold, args=(c,), daemon=True).start()
def udp(port):
    s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM); s.bind(('127.0.0.1', port))
    while True:
        data, a = s.recvfrom(200); log.write(f'[host listener 127.0.0.1:{port}/udp] datagram from {a[0]}:{a[1]} data={data!r}\n')
threading.Thread(target=tcp, args=(47001, False), daemon=True).start()
threading.Thread(target=tcp, args=(47002, True), daemon=True).start()
threading.Thread(target=udp, args=(47003,), daemon=True).start()
log.write('ready\n'); threading.Event().wait()
