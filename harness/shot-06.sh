echo "### Why #11412 is strictly weaker than what main already has"
echo "### (spy call count at the positive toHaveBeenCalled() guard)"
echo
cat /root/git/h11412/logs/census.txt
echo
echo "  #11412  : 6-7 calls at the guard -- only 1 is the rerender; the rest are setup leftovers."
echo "  main    : exactly 1 -- #11406's extra mockClear() makes the guard measure the rerender."
echo
echo "----------------------------------------------------------------------------"
cat /root/git/h11412/logs/gates.txt
