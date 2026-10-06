      if (serialized.includes('PROBE_LATER_TURN')) {
        return { content: 'LATER_TURN_OK' };
      }
      if (serialized.includes('PROBE_D4_TURN')) {
        return { content: 'D4_TURN_ANSWER' };
      }
      if (serialized.includes(failoverSecondMarker)) {
