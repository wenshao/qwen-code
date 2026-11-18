# PR #17676 — sidebar background-work indicator, round 1 evidence

Real browser captures for https://github.com/QwenLM/qwen-code/pull/17676.

## How these were produced

One Web Shell dev server pointed at a live local daemon, two real sessions in the two shapes under test:

- `#17676 | Web Shell…` — a turn in flight **and** a background shell running.
- `🧵 bg-status-probe` — turn finished, background shell still running.

Both arms were captured from the **same page, same daemon, same two DOM rows**. The only difference between arms is the code: the After arm is the PR branch, the Before arm is the PR base (`origin/main` `b9da38c7bd6f`) swapped in for the three production files, followed by a fresh page load. The files were restored from the PR commit afterwards and the working tree verified clean.

CSS animations were disabled for every capture, and the pointer was parked outside the sidebar so no row was hovered — otherwise a hover highlight would swamp the comparison.

## Files

| File | What it shows |
| --- | --- |
| `before-context.png` | Base: both rows. Top row has a grey spinner; the background-only row has nothing on the right. |
| `after-context.png` | PR: same two rows. Both carry an amber spinner. |
| `before-turn-row.png` | Base, turn + background: grey spinner, no background wording. |
| `after-turn-row.png` | PR, turn + background: amber spinner (accessible name stays `Running`, tooltip `Running · Background tasks running`). |
| `before-bgonly-row.png` | Base, background only: amber dot on the left, empty trailing slot — reads as idle. |
| `after-bgonly-row.png` | PR, background only: amber dot plus amber spinner named `Background tasks running`. |

## Pixel diff (same-size pairs, animations disabled)

| Pair | Size | Changed pixels | Diff bounding box |
| --- | --- | --- | --- |
| `bgonly-row` | 550×68 | 216 (0.58%) | x 506–530, y 22–46 — exactly the trailing 12×12 CSS marker |
| `turn-row` | 550×68 | 398 (1.06%) | x 260–530, y 22–46 — the marker plus the title's truncation fade |
| `context` | 582×220 | 614 (0.48%) | x 276–546, y 82–178 — both rows' trailing markers |

The background-only pair is the discriminating one: on the base there is no marker at all, so the whole changed region is the newly rendered spinner.

## DOM facts recorded at capture time

| Arm | Shape | Busy marker | Left dot |
| --- | --- | --- | --- |
| Before | turn + background | `aria-label="Running"`, no `title`, `border-top-color: oklch(0.708 0 0)` | `data-web-shell-session-running` |
| Before | background only | absent | `data-web-shell-session-background-running` |
| After | turn + background | `aria-label="Running"`, `title="Running · Background tasks running"`, `border-top-color: rgb(236, 201, 75)` | `data-web-shell-session-running` |
| After | background only | `aria-label="Background tasks running"`, `title="Background tasks running"`, `border-top-color: rgb(236, 201, 75)` | `data-web-shell-session-background-running` |

No page errors in either arm.
