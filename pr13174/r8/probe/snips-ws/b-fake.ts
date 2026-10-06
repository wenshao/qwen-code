      if (inflightFailover && serialized.includes(inflightMarker)) {
        if (!serialized.includes('"role":"tool"') && !wsHoldReleased) {
          return {
            contentChunks: ['WS_MODEL_PARTIAL'],
            holdAfterChunks: 1,
            holdUntil: wsHold,
          };
        }
