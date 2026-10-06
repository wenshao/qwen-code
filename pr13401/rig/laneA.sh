$SCRATCH/run-cell.sh F-PS $SCRATCH/wt-mut PS qwencode ALL
$SCRATCH/run-cell.sh F-WCPS $SCRATCH/wt-mut WCPS qwencode ALL
$SCRATCH/run-cell.sh F-PBR $SCRATCH/wt-mut PBR runtime-broker ALL
$SCRATCH/run-cell.sh H-PS-cp1 $SCRATCH/wt-mut PS qwencode HarnessEventStreamPinningTest -Djava.util.concurrent.ForkJoinPool.common.parallelism=1
$SCRATCH/run-cell.sh H-PS-p16 $SCRATCH/wt-mut PS qwencode HarnessEventStreamPinningTest -Djdk.virtualThreadScheduler.parallelism=16
