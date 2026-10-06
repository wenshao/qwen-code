$SCRATCH/run-cell.sh F-WCPVR $SCRATCH/wt-mut3 WCPV+WCPR runtime-broker ALL
$SCRATCH/run-cell.sh T-HCP $SCRATCH/wt-mut3 HCP runtime-broker CarrierCountTest,BrokerVirtualThreadPinningTest,BrokerRenewalPinningTest
$SCRATCH/run-cell.sh T-HAP $SCRATCH/wt-mut3 HAP runtime-broker CarrierCountTest,BrokerVirtualThreadPinningTest,BrokerRenewalPinningTest
$SCRATCH/run-cell.sh T-HGI $SCRATCH/wt-mut3 HGI runtime-broker CarrierCountTest,BrokerVirtualThreadPinningTest,BrokerRenewalPinningTest
$SCRATCH/run-cell.sh H-NONE-cp1 $SCRATCH/wt-mut3 NONE runtime-broker BrokerVirtualThreadPinningTest,BrokerRenewalPinningTest -Djava.util.concurrent.ForkJoinPool.common.parallelism=1
$SCRATCH/run-cell.sh H-NONE-p16 $SCRATCH/wt-mut3 NONE runtime-broker BrokerVirtualThreadPinningTest,BrokerRenewalPinningTest -Djdk.virtualThreadScheduler.parallelism=16
