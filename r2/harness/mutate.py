#!/usr/bin/env python3
"""Build the three red-control helper variants for PR 15035 on the Linux host.

Each replacement is asserted by content so a mutant can never silently run
against an unmodified helper.
"""
import shutil
from pathlib import Path

ROOT = Path("/root/Work/pr15035")
SRC = ROOT / "head"


def variant(name: str, old: str, new: str) -> None:
    src_text = (SRC / ".github/scripts/sdk-java-lock.sh").read_text()
    assert src_text.count(old) == 1, f"{name}: anchor count {src_text.count(old)}"
    dst = ROOT / name
    if dst.exists():
        shutil.rmtree(dst)
    shutil.copytree(SRC, dst, symlinks=True)
    helper = dst / ".github/scripts/sdk-java-lock.sh"
    helper.write_text(src_text.replace(old, new))
    assert helper.read_text() != src_text, name
    print(f"{name}: helper mutated at {helper}")


variant(
    "m1-fast-rank",
    "  if [[ ${priority} == 'fast' ]]; then\n    rank=0\n  fi",
    "  if [[ ${priority} == 'fast' ]]; then\n    rank=1\n  fi",
)
variant(
    "m2-no-promotion",
    "    if ((!promoted && SECONDS - start >= promote_after)); then",
    "    if false; then",
)
variant(
    "m3-no-keepalive",
    """      (
        exec 9>&-
        while sleep 2 && kill -0 $$ 2>/dev/null; do
          touch -c "${ticket}"
        done
      ) </dev/null >/dev/null 2>&1 &
      keepalive=$!""",
    "      keepalive=''",
)