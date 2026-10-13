import socket, sys, time
s = socket.socket(); s.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
s.bind(('127.0.0.1', int(sys.argv[1]))); s.listen(64)
conns = []
while True:
    c, _ = s.accept(); conns.append(c)  # accept, never read or write
