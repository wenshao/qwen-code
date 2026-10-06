      if (serialized.includes('PROBE_LATER_TURN')) {
        return { content: 'LATER_TURN_OK' };
      }
      if (serialized.includes(failoverSecondMarker)) {
