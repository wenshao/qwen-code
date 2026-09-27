#!/bin/bash
# A cache already on disk (written by an older build, a hand edit, or a
# pre-guard refresh) with a far-future fetchedAt: which one wins at startup?
R=${R:?}
RIG=/Users/wenshao/git/qwen-11959/pr11959-rig
. $RIG/arms.sh
D=$R/plant; rm -rf $D; mkdir -p $D
BUNDLED=/Users/wenshao/git/qwen-11959-r3/packages/core/src/models/generated/model-registry.json
seed() { # seed <home> <kind>
  mkdir -p $1
  node -e '
    const fs=require("fs"); const [home, kind, bundledPath]=process.argv.slice(1);
    const bundled=JSON.parse(fs.readFileSync(bundledPath,"utf8"));
    let models;
    if (kind==="all-invalid") models={ bad: { context: "x" } };
    else if (kind==="deepseek-v3-key") models={ ...bundled.models, "deepseek-v3": { context: 163840, output: 163840 } };
    else if (kind==="refreshed-approx") models={ ...bundled.models, "qwen3-coder-plus": { context: 1048576, output: 65536 } };
    fs.writeFileSync(home+"/model-registry.json", JSON.stringify({ source: "https://models.dev/api.json", fetchedAt: "2099-01-01T00:00:00.000Z", models }));
  ' $1 $2 $BUNDLED
}
ctx() { # ctx <arm> <kind> <model>
  local h=$D/$1-$2-$3; seed $h/home $2
  (cd $RIG && npx tsx run-cli.ts --cli $(arm_cli $1) --home $h/home --cwd $h/proj --model $3 --prompt "/context -d" --env QWEN_CODE_MODELS_DEV_REFRESH=off --out $h/ctx.json >/dev/null 2>&1)
  node -e 'const s=require(process.argv[1]); const m=/Context window: ([0-9.]+k?) tokens/.exec(s.stdout); process.stdout.write(m?m[1]:"?")' $h/ctx.json
}
wire() { # wire <arm> <kind> <model>
  local h=$D/$1-$2-$3-wire; seed $h/home $2
  (cd $RIG && npx tsx run-cli.ts --cli $(arm_cli $1) --home $h/home --cwd $h/proj --model $3 --prompt "say hi" --env QWEN_CODE_MODELS_DEV_REFRESH=off --out $h/wire.json >/dev/null 2>&1)
  node -e 'const s=require(process.argv[1]); process.stdout.write(String(s.requests[0]?.max_tokens ?? "?"))' $h/wire.json
}
printf "%-44s %-20s %-20s\n" "planted cache (fetchedAt 2099) -> observable" "${A1:-r3}" "${A2:-r4}"
printf "%-44s %-20s %-20s\n" "all-invalid entries: claude-fable-5 window" "$(ctx ${A1:-r3} all-invalid claude-fable-5)" "$(ctx ${A2:-r4} all-invalid claude-fable-5)"
printf "%-44s %-20s %-20s\n" "deepseek-v3 key: deepseek-v3-0324 window" "$(ctx ${A1:-r3} deepseek-v3-key deepseek-v3-0324)" "$(ctx ${A2:-r4} deepseek-v3-key deepseek-v3-0324)"
printf "%-44s %-20s %-20s\n" "deepseek-v3 key: deepseek-v3-0324 max_tokens" "$(wire ${A1:-r3} deepseek-v3-key deepseek-v3-0324)" "$(wire ${A2:-r4} deepseek-v3-key deepseek-v3-0324)"
printf "%-44s %-20s %-20s\n" "refreshed 1,048,576: qwen3-coder-plus window" "$(ctx ${A1:-r3} refreshed-approx qwen3-coder-plus)" "$(ctx ${A2:-r4} refreshed-approx qwen3-coder-plus)"
