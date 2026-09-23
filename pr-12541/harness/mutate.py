import sys
src=open(sys.argv[1]).read(); m=sys.argv[2]
A="""        const extensions = catalog.map((extension) => {"""
muts={
 'M1_drop_guard': ("""          await manager.refreshCatalogSnapshot();
        runtime.generationGuard?.assertOpen();""","""          await manager.refreshCatalogSnapshot();"""),
 'M2_dedupe_by_name': (A,"""        const byName = new Map<string, (typeof catalog)[number]>();
        for (const e of catalog) byName.set(e.name, e);
        const extensions = [...byName.values()].map((extension) => {"""),
 'M3_empty_rows': (A,"""        const extensions = catalog.slice(0, 0).map((extension) => {"""),
 'M4_drop_unpolicied': (A,"""        const extensions = catalog.filter((e) => snapshot.extensions[e.id]).map((extension) => {"""),
 'M5_blank_identity_name': ("""              { id: extension.id, name: extension.name },""","""              { id: extension.id, name: '' },"""),
 'M6_primary_cwd': ("""              snapshot,
              runtime.workspaceCwd,
            );
          return {""","""              snapshot,
              undefined,
            );
          return {"""),
 'M7_first_row_only': (A,"""        const extensions = catalog.slice(0, 1).map((extension) => {"""),
}
a,b=muts[m]; assert src.count(a)>=1,(m); open(sys.argv[1],'w').write(src.replace(a,b,1))
