$SCRATCH/run-cell.sh B-PSC-cp1 $SCRATCH/wt-base PSC runtime-broker BrokerVirtualThreadPinningTest -Djava.util.concurrent.ForkJoinPool.common.parallelism=1
$SCRATCH/run-cell.sh B-PSC-p16 $SCRATCH/wt-base PSC runtime-broker BrokerVirtualThreadPinningTest -Djdk.virtualThreadScheduler.parallelism=16
$SCRATCH/run-cell.sh B-PSC-def $SCRATCH/wt-base PSC runtime-broker BrokerVirtualThreadPinningTest
$SCRATCH/run-cell.sh B-PS-cp1 $SCRATCH/wt-base PS qwencode HarnessEventStreamPinningTest -Djava.util.concurrent.ForkJoinPool.common.parallelism=1
$SCRATCH/run-cell.sh B-PS-p16 $SCRATCH/wt-base PS qwencode HarnessEventStreamPinningTest -Djdk.virtualThreadScheduler.parallelism=16
$SCRATCH/run-cell.sh B-PS-def $SCRATCH/wt-base PS qwencode HarnessEventStreamPinningTest
$SCRATCH/run-cell.sh B-NONE-cp1 $SCRATCH/wt-base NONE runtime-broker BrokerVirtualThreadPinningTest -Djava.util.concurrent.ForkJoinPool.common.parallelism=1
$SCRATCH/run-cell.sh F-B-PBR $SCRATCH/wt-base PBR runtime-broker ALL
