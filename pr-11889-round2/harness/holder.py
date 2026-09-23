import os, sys, time, signal
# Holds an open directory handle on the root and every descendant directory,
# exactly like a recursive watcher on Windows (ReadDirectoryChangesW attaches
# one native handle per subdirectory).
root = sys.argv[1]
fds = []
for dirpath, dirnames, _ in os.walk(root):
    fds.append(os.open(dirpath, os.O_RDONLY))
print(f"holding {len(fds)} directory handles under {root}", flush=True)
signal.pause()
