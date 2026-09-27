# A stuck SSE client: a tiny receive buffer (set before connect, so macOS does
# not auto-tune it), reads the response head, then stops reading until the
# resume file exists, then drains until the server closes or goes idle.
#   python3 stuck_client.py <host> <port> <path> <tenant> <resumeFile> <outFile> [Header: v ...]
import socket, sys, os, time

host, port, path, tenant, resume, out = sys.argv[1:7]
extra = sys.argv[7:]
s = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
s.setsockopt(socket.SOL_SOCKET, socket.SO_RCVBUF, 4096)
s.connect((host, int(port)))
req = [f"GET {path} HTTP/1.1", f"Host: {host}:{port}", "Accept: text/event-stream",
       f"X-Qwen-Tenant-Id: {tenant}", *extra, "Connection: close", "", ""]
s.sendall("\r\n".join(req).encode())
data = b""
while b"\r\n\r\n" not in data:
    data += s.recv(4096)
print("HEAD", data.split(b"\r\n", 1)[0].decode(), "rcvbuf", s.getsockopt(socket.SOL_SOCKET, socket.SO_RCVBUF), flush=True)
paused_at = time.time()
while not os.path.exists(resume):
    time.sleep(0.05)
print("RESUME after %.1fs" % (time.time() - paused_at), flush=True)
s.settimeout(8.0)
why = "idle"
try:
    while True:
        chunk = s.recv(65536)
        if not chunk:
            why = "server"
            break
        data += chunk
except socket.timeout:
    pass
except OSError as e:
    why = "error " + str(e)
with open(out, "wb") as f:
    f.write(data)
print("DONE", why, len(data), flush=True)
