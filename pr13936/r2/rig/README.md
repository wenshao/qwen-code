# PR 13936 round-2 rig notes

- Arms: `merge` = head 045cd84f merged into main e9789d09 (Vite 18936); `cand` = the same merge with
  045cd84f reverted (Vite 18938) for the A/B runs, later replaced by the same merge + `candidate-alert.patch`
  for S16/S14 (`alert-candidate` in results); `base` = main e9789d09 (Vite 18937).
- One backend for all arms: Spring jar + Hosted Harness (`dist/cli.js`) built from the merge, MySQL 8.4.7,
  scripted model, gw.mjs in front of Spring. Team-lead profile trigger: `../../rig/teamlead-trigger.sql` (round 1).
- gw.mjs knobs added this round: `/stale?path=&ms=` delays only replies that carry no terminal task state;
  `/fail?path=&status=` answers without forwarding (read outage). `/nodelay` clears all.
- Results files named `*-cand*` in S2/S10/S11/S15/S17 are the fix-reverted arm.
