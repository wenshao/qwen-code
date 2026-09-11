# PR #11417 — maintainer verification assets

Terminal captures and the full bilingual report from a real local A/B of
[QwenLM/qwen-code#11417](https://github.com/QwenLM/qwen-code/pull/11417).

| file | what it shows |
| --- | --- |
| `01-forced-race-ab.png` | forced-race A/B: without the PR the leaked `openBrowserSecurely` breaks the next test's existing assertion; with it, 70/70 |
| `02-11414-signature.png` | the `#11414` unattributed-failure signature reproduces only with the already-merged #11362 wait removed |
| `03-baseline-and-leakwindow.png` | clean suite on both arms, plus the 25/25 measurement showing the new wait is already satisfied today |
| `04-body-vs-diff.png` | the shipped diff next to the change the PR body describes |
| `05-risk-probes.png` | hang bound (`vi.waitFor` 1000 ms) and the sibling-scope check |

Reports: [English](REPORT-en.md) · [中文](REPORT-zh.md)
