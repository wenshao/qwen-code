# PR #13682 real-stack verification, round 1 (VERIFICATION RIG ONLY)

- Heads: 785dc863 (all probes), 6c66366a (key probes re-run); base = merge base 2ebbd4e1 (main).
- figures/: rendered evidence cards (HTML sources included); raw/: WebShell screenshots from Playwright.
- probe/: probe scripts (p1–p9, c19/c21/c23) and helpers; rig/: start/stop scripts and per-arm runners.
- logs/: per-arm transcripts (arm-h = 785dc863, arm-b = base, arm-h2 = 6c66366a; extra = mixed/upgrade; p3c = lease; p9 = restart/peer controls; ui = WebShell; mj = real-stack replay of unit-test survivors).
- mut/: mutant definitions, runners and results (focused, full-suite survivors, TS).
These scripts drive a disposable local rig; they are not product code.
