import sys
src = open(sys.argv[2]).read()
M = {
 "M1_connect_desc": ("                    .contentDescription = getString(R.string.connect_profile, profile.name)\n", ""),
 "M6_delete_desc": ("                }.contentDescription = getString(R.string.delete_named_profile, profile.name)\n", "                }\n"),
 "M2_labelFor": ("                caption.labelFor = id\n", ""),
 "M3_error_live": ("TextView(this).apply { accessibilityLiveRegion = View.ACCESSIBILITY_LIVE_REGION_POLITE }", "TextView(this)"),
 "M4_storage_live": ("                .accessibilityLiveRegion = View.ACCESSIBILITY_LIVE_REGION_POLITE\n", ""),
 "M5_storage_scroll": ("        setContentView(ScrollView(this).apply { addView(content) })\n    }\n\n    private fun cancelDialog", "        setContentView(content)\n    }\n\n    private fun cancelDialog"),
}
old, new = M[sys.argv[1]]
assert src.count(old) == 1, (sys.argv[1], src.count(old))
open(sys.argv[3], "w").write(src.replace(old, new))
