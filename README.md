# PR #12462 verification assets

Screenshots and terminal captures for the maintainer-driven local verification
(round 3) of QwenLM/qwen-code#12462 (`fix(web-shell): keep mobile composer
controls reachable above a soft keyboard`), verified head `ae0f554319`.

- `imgs/pr12462-fig1-ab-cells.png` — A/B cells: 4 mobile tests head 4/4 green vs base 4/4 red (mobile-chromium and mobile-webkit), new desktop test head green vs base red
- `imgs/pr12462-fig2-mutation-matrix.png` — mutation matrix M0–M6 at head, 0 survivors, positive control live
- `imgs/pr12462-fig3-attachments-base.png` / `imgs/pr12462-fig4-attachments-head.png` — attachments strip at 412×450 with a wrapped workspace/Git row: collapsed to 0px on base, trailing card + remove button visible at head
- `imgs/pr12462-fig5-history-base.png` / `imgs/pr12462-fig6-history-head.png` — input history at 412×360: search field above the viewport on base, panel below the header overlapping the composer at head
- `imgs/pr12462-fig7-desktop-base.png` / `imgs/pr12462-fig8-desktop-head.png` — desktop Ctrl+R at 1280×300: search field covered on base, visible at head
- `imgs/pr12462-fig9-rows-base.png` / `imgs/pr12462-fig10-rows-head.png` — workspace/Git row (red outline) vs editing row (blue outline) at 412×450: 8px overlap on base, clean stack at head
