# PR #13107 — round 4 at 24b26f107d (#13037 merged in)

- r4-0*.png: figures in the round-4 comment; s13-*.png: raw screenshots of the itemId matching A/B (prev 9522974f9d / head / candidate).
- candidate-itemid-matching.patch: +40/-3, keeps the call ID on itemId-keyed rows and matches on it; one unit test (fails on the head, passes with the patch).
- candidate-r1-1-page-test.patch: the round-3 page test; still applies at this head and kills G9.
- results/scenarios: all scenarios at this head (s13-itemid-matching.log is the A/B).
