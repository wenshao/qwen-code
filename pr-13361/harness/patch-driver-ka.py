#!/usr/bin/env python3
"""Env-gated: VERIFY_PROXY_KA=<ms> sets the driver Store proxy's keepAliveTimeout (local only)."""
import sys
p = sys.argv[1]
s = open(p).read()
old = "const storeProxyUrl = await listen(storeProxy);"
assert s.count(old) == 1
s = s.replace(old, "if (process.env['VERIFY_PROXY_KA'])\n  storeProxy.keepAliveTimeout = Number(process.env['VERIFY_PROXY_KA']);\n" + old)
open(p, 'w').write(s)
print('patched ka')
