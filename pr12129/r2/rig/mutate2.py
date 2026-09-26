"""Round-2 mutants for #12129. usage: mutate2.py <mutant> <repo-root>; edits in place, asserts each anchor matches once."""
import sys, os
M = {
 # production changes of the PR (one revert each)
 "P1_connect_desc": ("MainActivity.kt", "                    .contentDescription = getString(R.string.connect_profile, profile.name)\n", ""),
 "P2_edit_desc": ("MainActivity.kt", "                    .contentDescription = getString(R.string.edit_named_profile, profile.name)\n", ""),
 "P3_delete_desc": ("MainActivity.kt", "                }.contentDescription = getString(R.string.delete_named_profile, profile.name)\n", "                }\n"),
 "P4_labelFor": ("MainActivity.kt", "                caption.labelFor = id\n", ""),
 "P5_error_live": ("MainActivity.kt", "TextView(this).apply { accessibilityLiveRegion = View.ACCESSIBILITY_LIVE_REGION_POLITE }", "TextView(this)"),
 "P6_storage_live": ("MainActivity.kt", "                .accessibilityLiveRegion = View.ACCESSIBILITY_LIVE_REGION_POLITE\n", ""),
 "P7_storage_scroll": ("MainActivity.kt", "        setContentView(ScrollView(this).apply { addView(content) })\n    }\n\n    private fun cancelDialog", "        setContentView(content)\n    }\n\n    private fun cancelDialog"),
 "P8_error_reveal": ("MainActivity.kt", "            error.post { error.requestRectangleOnScreen(Rect(0, 0, error.width, error.height), false) }\n", ""),
 # regressions the bot says the tests cannot see
 "B5_token_in_description": ("MainActivity.kt", "        val keep = CheckBox(this).apply {\n", "        token.contentDescription = previous?.token.orEmpty()\n        val keep = CheckBox(this).apply {\n"),
 "B5b_token_prefilled": ("MainActivity.kt", "val token = field(R.string.daemon_token, \"\",", "val token = field(R.string.daemon_token, previous?.token.orEmpty(),"),
 "B6_browser_id_rotates": ("ConnectionProfile.kt", "if (sameConnection) previous!!.browserId else UUID.randomUUID().toString(),", "UUID.randomUUID().toString(),"),
 "B7_nested_scrollview": ("MainActivity.kt", "        setContentView(ScrollView(this).apply { addView(content) })\n    }\n\n    private fun cancelDialog", "        setContentView(ScrollView(this).apply { addView(ScrollView(context).apply { addView(content) }) })\n    }\n\n    private fun cancelDialog"),
 "B8_cancel_resets": ("MainActivity.kt", "                    .setNegativeButton(android.R.string.cancel, null)\n                    .setPositiveButton(R.string.reset_profiles) { _, _ ->",
     "                    .setNegativeButton(android.R.string.cancel) { _, _ ->\n                        (store ?: AndroidProfileStore(this@MainActivity).also { store = it }).reset()\n                        loadProfiles()\n                    }\n                    .setPositiveButton(R.string.reset_profiles) { _, _ ->"),
}
f, old, new = M[sys.argv[1]]
p = os.path.join(sys.argv[2], "packages/mobile-shell/app/src/main/java/com/qwen/mobileshell", f)
src = open(p).read()
assert src.count(old) == 1, (sys.argv[1], src.count(old))
open(p, "w").write(src.replace(old, new))
print("applied", sys.argv[1], "to", f)
