#!/usr/bin/env python3
"""Minimal dm-log-writes reader/replayer (format of drivers/md/dm-log-writes.c, as used by xfstests replay-log).

  replay.py index <log.img> <index.json>          parse the log once: one record per entry (offsets, flags, mark)
  replay.py apply <log.img> <index.json> <img> <first> <last>
                                                  apply entries [first, last] (inclusive, 0-based) onto <img> in place

The replay target must start as a copy of the device's initial contents (here: an all-zero sparse file) or as an
image already replayed through entry first-1. Self-check used by the rig: replaying every entry must reproduce the
real data device byte for byte.
"""
import json
import os
import struct
import sys

MAGIC = 0x6A736677736872
FLUSH, FUA, DISCARD, MARK, METADATA = 1, 2, 4, 8, 16


def index(log_path, out_path):
    with open(log_path, 'rb') as log:
        magic, version, nr_entries, sectorsize = struct.unpack('<QQQI', log.read(28))
        assert magic == MAGIC and version == 1, (hex(magic), version)
        pos = sectorsize
        entries = []
        for i in range(nr_entries):
            log.seek(pos)
            head = log.read(sectorsize)
            sector, nr_sectors, flags, data_len = struct.unpack('<QQQQ', head[:32])
            rec = {'i': i, 'sector': sector, 'nr': nr_sectors, 'flags': flags, 'data': None}
            pos += sectorsize
            if flags & MARK:
                rec['mark'] = head[32:32 + data_len].decode('utf-8', 'replace')
            elif flags & DISCARD:
                pass
            elif data_len:
                rec['data'] = pos
                rec['len'] = data_len
                pos += (data_len + sectorsize - 1) // sectorsize * sectorsize
            elif nr_sectors:
                rec['data'] = pos
                rec['len'] = nr_sectors * sectorsize
                pos += nr_sectors * sectorsize
            entries.append(rec)
    with open(out_path, 'w') as out:
        json.dump({'sectorsize': sectorsize, 'entries': entries}, out)
    marks = [(e['i'], e['mark']) for e in entries if 'mark' in e]
    flushes = sum(1 for e in entries if e['flags'] & (FLUSH | FUA))
    print(f'entries={nr_entries} sectorsize={sectorsize} flush_or_fua={flushes} marks={marks}')


def apply(log_path, index_path, img_path, first, last):
    idx = json.load(open(index_path))
    ss = idx['sectorsize']
    with open(log_path, 'rb') as log, open(img_path, 'r+b') as img:
        for e in idx['entries'][first:last + 1]:
            if e['flags'] & DISCARD:
                img.seek(e['sector'] * ss)
                img.write(b'\0' * (e['nr'] * ss))
            elif e['data'] is not None:
                log.seek(e['data'])
                img.seek(e['sector'] * ss)
                img.write(log.read(e['len']))
        img.flush()
        os.fsync(img.fileno())


if __name__ == '__main__':
    cmd = sys.argv[1]
    if cmd == 'index':
        index(sys.argv[2], sys.argv[3])
    elif cmd == 'apply':
        apply(sys.argv[2], sys.argv[3], sys.argv[4], int(sys.argv[5]), int(sys.argv[6]))
    else:
        raise SystemExit(__doc__)
