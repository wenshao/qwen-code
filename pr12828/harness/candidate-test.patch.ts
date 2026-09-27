
  it.each([
    ['a parent', { parentSessionId: 'parent-session' }, false],
    ['a channel source', { sourceType: 'channel' }, false],
    [
      'a scheduled run source',
      { sourceType: 'default', sourceId: 'scheduled_task_run:task-1' },
      false,
    ],
    ['daemon-owned standalone restore', {}, true],
  ] as const)(
    'restores a Managed owner with %s on Managed without re-checking its purpose',
    async (_name, metadata, daemonOwnedStandalone) => {
      await writeTranscript([owner(SESSION_ID, 'managed'), record(SESSION_ID)]);
      const managed = managedEngine(COMPATIBLE);
      await expect(
        createSessionExecutionEngineSelector({ runtimeBaseDir, managed })({
          operation: 'load',
          request: { workspaceCwd, sessionId: SESSION_ID, ...metadata },
          daemonOwnedStandalone,
        }),
      ).resolves.toBe('managed');
    },
  );
