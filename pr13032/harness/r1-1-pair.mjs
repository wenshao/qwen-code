// R1-1's suggested pair, verbatim from the review, plus the anyInt import it needs.
import fs from 'node:fs';
const f = process.argv[2];
let s = fs.readFileSync(f, 'utf8');
if (!s.includes('import static org.mockito.ArgumentMatchers.anyInt;')) {
  s = s.replace('import static org.mockito.ArgumentMatchers.anyLong;', 'import static org.mockito.ArgumentMatchers.anyInt;\nimport static org.mockito.ArgumentMatchers.anyLong;');
}
const anchor = 'class HarnessCoordinatorTest {\n';
s = s.replace(anchor, anchor + `    @Test
    void recoverExpiredTurnsBacksOffWhileTheHarnessIsUnavailable() {
        AgentStateStore store = mock(AgentStateStore.class);
        HarnessConnector harness = mock(HarnessConnector.class);
        when(harness.isAvailable()).thenReturn(false);
        HarnessCoordinator coordinator = new HarnessCoordinator(store, harness,
                new HarnessEventProjector(), mock(RuntimeWarmer.class),
                directExecutor(), Clock.systemUTC(), new ManagedAgentProperties());
        try {
            coordinator.recoverExpiredTurns();
        } finally {
            coordinator.close();
        }
        verifyNoInteractions(store);
    }

    @Test
    void recoverExpiredTurnsScansWhileTheHarnessIsAvailable() {
        AgentStateStore store = mock(AgentStateStore.class);
        HarnessConnector harness = mock(HarnessConnector.class);
        when(harness.isAvailable()).thenReturn(true);
        when(store.findDispatchable(anyLong(), anyInt())).thenReturn(List.of());
        HarnessCoordinator coordinator = new HarnessCoordinator(store, harness,
                new HarnessEventProjector(), mock(RuntimeWarmer.class),
                directExecutor(), Clock.systemUTC(), new ManagedAgentProperties());
        try {
            coordinator.recoverExpiredTurns();
        } finally {
            coordinator.close();
        }
        verify(store).findDispatchable(anyLong(), anyInt());
    }

`);
fs.writeFileSync(f, s);
console.log('R1-1 pair applied');
