      if (inflightFailover && process.env['PROBE_WS_SECOND'] === '1' && serialized.includes('PROBE_WS_TURN2')) {
        if (!wsHoldReleased) {
          return {
            contentChunks: ['WS_TURN2_PARTIAL'],
            holdAfterChunks: 1,
            holdUntil: wsHold,
          };
        }
        return { content: 'WS_TURN2_AFTER_RELEASE' };
      }
      if (inflightFailover && serialized.includes(inflightMarker)) {
        if (!serialized.includes('"role":"tool"') && !wsHoldReleased && process.env['PROBE_WS_SECOND'] !== '1') {
          return {
            contentChunks: ['WS_MODEL_PARTIAL'],
            holdAfterChunks: 1,
            holdUntil: wsHold,
          };
        }
