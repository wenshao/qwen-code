git -C $1 apply $SCRATCH/candidate-route-guard.patch
bash $SCRATCH/mut/m5-automations-no-method.sh $1
