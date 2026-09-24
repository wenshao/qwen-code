import sys
src=open('/tmp/pr12466-TurnCallsPanel.orig').read()
m=sys.argv[1]
reps={
 'M1_no_adopt_effect':("    if (ownerMatches && (adoptedPromptId || adoptedRecordId))\n      onSelectPrompt?.(","    if (false && ownerMatches && (adoptedPromptId || adoptedRecordId))\n      onSelectPrompt?.("),
 'M2_no_prompt_adopt':("      : navigation.provisionalTurns.find((turn) => turn.blockId === turnId)\n          ?.promptId;","      : undefined;"),
 'M3_no_record_adopt':("          (location) => location.view === 'live' && location.blockId === turnId,\n        )?.turnId;","          (location) => false,\n        )?.turnId;"),
 'M4_no_owner_guard':("    if (ownerMatches && (adoptedPromptId","    if (true && (adoptedPromptId"),
 'M5_no_live_filter':("location.view === 'live' && location.blockId","location.blockId"),
 'M6_retarget_existing':("  const adoptedPromptId =\n    recordId || promptId\n      ? undefined\n      :","  const adoptedPromptId =\n    false\n      ? undefined\n      :"),
}
a,b=reps[m]; assert src.count(a)==1,(m,src.count(a))
open(sys.argv[2],'w').write(src.replace(a,b))
