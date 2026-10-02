# PR #13136 real-stack verification evidence (macOS arm64, MySQL 8.4.7)

- PR head a5a94d5d78, baseline main 3f56f74a6a.
- Figures: 01-store-cost.png, 02-upgrade-race.png, 03-integrity-tests.png (built by rig/fig36.mjs from results/).
- results/p36 (PR scale), b36 (main scale), up36 (V27 -> V29 upgrade), rc36 (restart controls on main),
  tmp36/tmb36 (cold-load tamper matrix PR/main, race), unit36 (unit tests and pins).
- rig/: probes (s24..s29c), lib/manifest/handlers from the #13129 rig, launch and test scripts.
