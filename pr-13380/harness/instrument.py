#!/usr/bin/env python3
"""Apply the identical PR #13380 verification hooks to one crash-driver arm.

usage: instrument.py <pristine-driver.ts> <out.ts>
Every anchor must match exactly once, so all arms get byte-identical hooks.
"""
import sys

src, dst = sys.argv[1], sys.argv[2]
text = open(src).read()

EDITS = [
    # import + init
    ("import { HostedHarnessProcess, waitUntil } from './hosted-harness-process.js';\n",
     "import { HostedHarnessProcess, waitUntil } from './hosted-harness-process.js';\n"
     "import * as V from './verify13380.js';\n"),
    ("let cli = new HostedHarnessProcess();\n",
     "let cli = new HostedHarnessProcess();\nV.init(() => cli.bootId);\n"),
    # record which boots the driver killed (logging only)
    ("  const pid = cli.child.pid;\n",
     "  const pid = cli.child.pid;\n  V.noteKill(cli.bootId);\n"),
    # per-request handle
    ("const proxy = createServer(async (req, res) => {\n  try {\n",
     "const proxy = createServer(async (req, res) => {\n  // eslint-disable-next-line @typescript-eslint/no-explicit-any\n  let __held: any;\n  try {\n"),
    # hold point: after the request body is parsed, before forwarding
    ("      : Object.fromEntries(url.searchParams);\n",
     "      : Object.fromEntries(url.searchParams);\n"
     "    __held = await V.maybeHold(store, url.pathname, fields);\n"),
    # harness-result: forward the intercepted commit late instead of dropping it
    ("      await killHarness();\n      injected = true;\n      res.destroy();\n      return;\n    }\n    const headers = new Headers();\n",
     "      await killHarness();\n      injected = true;\n"
     "      __held = await V.holdCommit(fields);\n"
     "      if (!__held) {\n        res.destroy();\n        return;\n      }\n"
     "    }\n    const headers = new Headers();\n"),
    # observe upstream answer
    ("      ? JSON.parse(bytes.toString())\n      : undefined;\n",
     "      ? JSON.parse(bytes.toString())\n      : undefined;\n"
     "    V.observe(store, url.pathname, fields, upstream.status, json);\n"
     "    if (__held) V.upstream(__held, upstream.status, bytes.toString(), fields.writerId);\n"),
    # classification survived (the 409 handling block did not throw)
    ("    if (restoring && store && url.pathname.endsWith('/transactions'))\n",
     "    if (__held) {\n      V.classified(__held, 'accepted');\n"
     "      if (__held.path.endsWith('/transactions:commit')) {\n        res.destroy();\n        return;\n      }\n    }\n"
     "    if (restoring && store && url.pathname.endsWith('/transactions'))\n"),
    # classification threw -> proxyFailure
    ("  } catch (cause) {\n    if (!serviceKilled",
     "  } catch (cause) {\n"
     "    if (__held)\n      V.classified(\n        __held,\n"
     "        'proxyFailure: ' + String((cause as Error)?.message ?? cause).slice(0, 400),\n      );\n"
     "    if (!serviceKilled"),
    # worker-* faults: arm the renew hold just before the driver SIGKILLs
    ("      cursor = page.nextCursor;\n    }\n    await killHarness();\n  }\n",
     "      cursor = page.nextCursor;\n    }\n    await V.beforeWorkerKill(cli.bootId);\n    await killHarness();\n  }\n"),
    # wait for the held request to be classified before the last failure check
    ("  if (proxyFailure) throw proxyFailure;\n  await writeFile(`${configPath}.results`",
     "  await V.beforeFinish(cli.bootId, report);\n"
     "  if (proxyFailure) throw proxyFailure;\n  await writeFile(`${configPath}.results`"),
]

for old, new in EDITS:
    n = text.count(old)
    if n != 1:
        sys.exit(f"anchor matched {n} times in {src}: {old[:70]!r}")
    text = text.replace(old, new)

open(dst, "w").write(text)
print(f"{dst}: {len(EDITS)} hooks applied")
