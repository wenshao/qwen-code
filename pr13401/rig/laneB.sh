$SCRATCH/run-cell.sh F-PSC $SCRATCH/wt-mut2 PSC runtime-broker ALL
$SCRATCH/run-cell.sh F-PDR $SCRATCH/wt-mut2 PDR runtime-broker ALL
$SCRATCH/run-cell.sh H-PSC-cp1 $SCRATCH/wt-mut2 PSC runtime-broker BrokerVirtualThreadPinningTest -Djava.util.concurrent.ForkJoinPool.common.parallelism=1
$SCRATCH/run-cell.sh H-PSC-p16 $SCRATCH/wt-mut2 PSC runtime-broker BrokerVirtualThreadPinningTest -Djdk.virtualThreadScheduler.parallelism=16
