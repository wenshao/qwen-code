# PR #13107 — round 5 at 72608f2c03

- r5-0*.png: figures in the round-5 comment; raw/: unmodified page screenshots (prev = 24b26f107d, head = 72608f2c03, fix = head + candidate-r1-6).
- candidate-r1-6-reload-budget.patch (+36/-1): reset the read retry budget when a reload makes the capability unknown; one test (fails on the head, passes with the patch).
- candidate-r5-tests.patch (+55, tests only): pins action_already_resolved as an ended code and the Action-Turn guard for both row kinds; kills N1, A3, A8.
- results/scenarios-72608f2c03: every scenario at the final head; scenarios-9fedb263a0: the same suite at the head before the late-reply commits.
- results/mutation: 77 mutants at the head, the N5 anchor rerun, paired mutants, and the candidate tests against N1/A3/A8.
