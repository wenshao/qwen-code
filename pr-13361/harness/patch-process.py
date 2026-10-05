#!/usr/bin/env python3
"""Env-gated (neutral when unset): tee the Hosted CLI's output to $VERIFY_DAEMON_LOG and
preload $VERIFY_DAEMON_PRELOAD into the daemon. Local verification only."""
import sys
p = sys.argv[1]
s = open(p).read()
def rep(old, new):
    global s
    assert s.count(old) == 1, old[:60]
    s = s.replace(old, new)
rep("""      const append = (data: Buffer) => {
        this.output = (this.output + data.toString()).slice(-16_384);
      };""", """      const append = (data: Buffer) => {
        this.output = (this.output + data.toString()).slice(-16_384);
        if (process.env['VERIFY_DAEMON_LOG'])
          appendFileSync(process.env['VERIFY_DAEMON_LOG'], data);
      };""")
rep("""        options.args ?? [
          HOSTED_CLI,""", """        options.args ?? [
          ...(process.env['VERIFY_DAEMON_PRELOAD']
            ? ['--import', process.env['VERIFY_DAEMON_PRELOAD']]
            : []),
          HOSTED_CLI,""")
s = "import { appendFileSync } from 'node:fs';\n" + s
open(p, 'w').write(s)
print('patched process')
