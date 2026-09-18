# PR #11889 — local verification assets

Screenshots and the harness used to verify
[QwenLM/qwen-code#11889](https://github.com/QwenLM/qwen-code/pull/11889) at head `5fd2460104`
on Linux, by reproducing the Windows directory-lock rule with real syscalls.

## How the Windows rule is reproduced

`harness/winlock.c` is an `LD_PRELOAD` interposer for `rename`/`renameat`/`renameat2`
(and, in strict mode, `rmdir`). For a path under `$WINLOCK_ROOT` it asks the kernel a
real question — *does any other live process hold an open handle on this directory or a
descendant?* — by scanning `/proc/<pid>/fd`, and if so makes the syscall fail with a
genuine `EPERM`. `harness/holder.py` is the holder: it opens one directory handle per
subdirectory, which is what a recursive watcher attaches on Windows.

Nothing inside the store, `node:fs` or `libuv` is mocked. `process.platform` is forced to
`win32` with `--import harness/win32.mjs`, after node's bootstrap has already chosen the
posix `path` implementation.

## Runs

| script | what it drives |
| --- | --- |
| `harness/store-lock-e2e.mjs` | the real `ExtensionStore`: install → update → uninstall under the lock |
| `harness/cli-e2e.sh` | the built `qwen` bundle: `extensions install/update/uninstall` |
| `harness/crash-driver.mjs` | `SIGKILL` mid-copy, then recovery; also the concurrent-reader window |
| `harness/blocked-rollback.mjs` | an apply copy *and* its rollback defeated by a real, permanent `EPERM` |
| `harness/shapes.mjs` | dropped directory, exec bit, symlink, file→directory kind change |
| `harness/enoent-probe.mjs` | whether `fsp.cp` makes a destination file transiently missing |
