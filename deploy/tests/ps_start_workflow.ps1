cd D:\flyte-work
bash -lc "cd /mnt/d/flyte-work && IMAGE='rancher/mirrored-library-busybox:1.37.0' COMMAND='echo ml task started; sleep 3600' bash deploy/tests/start_ml_task.sh"
