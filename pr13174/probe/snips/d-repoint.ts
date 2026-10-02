        60_000,
        replacementSpring,
      );
      if (storeProxy) {
        storeProxyTarget = replacementSpringPort;
        console.log(JSON.stringify({ probe: 'store-proxy-repointed', to: replacementSpringPort }));
      }
