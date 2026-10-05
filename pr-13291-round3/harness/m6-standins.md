# Bundle patches used in round 3

All patches are applied to a hard-linked copy of each arm's own `dist/`
(`cp -al dist dist-m6sim`, then `cp --remove-destination` of the one chunk
before editing it), so the arm's real `dist/` is untouched. Each patch is
env-gated; without the env var the chunk behaves exactly as built.

## M6 stand-ins (identical on every arm)

1. `loadCliConfig` (chunk with `if(sessionId){sessionService.assertLegacySessionExecution(sessionId)}`):

   ```
   - if(sessionId){sessionService.assertLegacySessionExecution(sessionId)}
   + if(sessionId&&process.env.R3_SIM_M6_MANAGED_LOAD!=="1"){sessionService.assertLegacySessionExecution(sessionId)}
   ```

   The design's "Risks for later slices" already says the M6 host must
   restore Managed sessions without this Legacy check.

2. `acpAgent` writer reclaim policy for a trusted Managed parent:

   ```
   - setSessionWriterReclaimPolicy(this.conversationsRuntimeProvenance?"local":"never")
   + setSessionWriterReclaimPolicy(this.conversationsRuntimeProvenance||process.env.R3_SIM_M6_RECLAIM==="1"?"local":"never")
   ```

   Without it, every crash-shaped reopen fails with `session_writer_conflict`
   (figure 2A).

## Mutant (new head only): F3 re-read disabled

```
- if(this.sessionRestoreProjectionSource&&this.managedSession.authority.committedSequence!==sequenceBeforeRepair){
+ if(process.env.R3_MUT_NO_REREAD!=="1"&&this.sessionRestoreProjectionSource&&this.managedSession.authority.committedSequence!==sequenceBeforeRepair){
```

## R1-24 variant (new head only): digest before ensureCheckpoint

```
- await this.harness.ensureCheckpoint();const inputDigest=managedToolDigest(input.params);
+ const inputDigest=managedToolDigest(input.params);await this.harness.ensureCheckpoint();
```

## Driving

`node run.mjs <armDir> <s14|s6|s4|s7|clean|oversize> <outDir>` with
`R3_ENTRY_DIR=dist-m6sim` (or `dist-mut` + `R3_MUT=1`, or `dist-digest`),
`R3_RECLAIM=1`, `R3_SECOND_OPEN=1`. `matrix.sh 3 s14 s6 s4 s7 clean` runs the
figure-1 matrix. `probe.cjs` is loaded into the Managed child through
`NODE_OPTIONS=--require` and SIGKILLs the child right after a named commit
line has been fsynced.
