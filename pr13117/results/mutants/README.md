Contract mutants C0-C5 are applied by harness/mut.mjs (parse, change one response entry, re-serialize).
Their git diffs are omitted: re-serializing the JSON reflows every array, so the textual diff is ~1,800 lines
of whitespace. C0 is that re-serialization alone and passes 104/104, so every C1-C5 failure comes from the
one semantic change named in mut.mjs. Filter mutants F1-F7 and G3-G8 are included as git diffs.
