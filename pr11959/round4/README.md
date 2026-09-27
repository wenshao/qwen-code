# PR #11959 round 4: head `4d9bbdef4c` (autofix round 8)

Arms: base3 = merge-base `700620f4d0` (unchanged since round 3), r3 = `1bb0e56e57`, r4 = `4d9bbdef4c`.
Every cell drives a real bundled `dist/cli.js` with an isolated `QWEN_HOME`; each PNG has a plain-text
transcript in `evidence/`.

| file | what |
| --- | --- |
| `r4-01-loader-hardening.png` | the three `loadModelCatalog()` changes: planted caches (all-invalid, `deepseek-v3` key, 1,048,576 approximation), first session after a poisoned cache, bundled windows |
| `r4-02-dashscope-real-endpoint.png` | real DashScope endpoint, base3 vs r4: defaults, explicit budget, image input |
| `r4-03-regression.png` | F1, F2, F3 re-checked on r4, plus the two open items |
| `rig/plant.sh` | seeds `$QWEN_HOME/model-registry.json` with a far-future `fetchedAt` and reads the result through `/context -d` or the wire |
