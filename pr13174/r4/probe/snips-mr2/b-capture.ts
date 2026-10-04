      if (r.status !== 202) throw new Error(`probe Turn 2 submit returned ${r.status}: ${await r.text()}`);
      probeTurn2Id = ((await r.json()) as { turn_id: string }).turn_id;
