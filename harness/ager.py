# Keeps one file's mtime pinned 60 days in the past, re-applying every 200ms so
# that concurrent appends by the live session cannot keep it looking fresh.
import os, sys, time
path, logpath = sys.argv[1], sys.argv[2]
t = time.time() - 60 * 24 * 3600
n = 0
with open(logpath, 'w') as log:
    while True:
        try:
            os.utime(path, (t, t))
            n += 1
        except FileNotFoundError:
            log.write(f'gone after {n} utimes at {time.strftime("%H:%M:%S")}\n')
            log.flush()
            break
        except Exception as e:
            log.write(f'error {e!r}\n'); log.flush(); break
        time.sleep(0.2)
