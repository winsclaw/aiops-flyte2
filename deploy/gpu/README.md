# Flyte GPU Runtime Setup

This directory contains the committed GPU Operator configuration for the
single-node `aione-flyte2` k3s deployment.

## Host driver and kernel

Install the Ubuntu 22.04 HWE kernel and NVIDIA 580 server driver packages on
`aione-flyte2` before installing the operator:

```bash
apt-get update
DEBIAN_FRONTEND=noninteractive apt-get install -y \
  linux-generic-hwe-22.04 \
  linux-headers-generic-hwe-22.04 \
  linux-modules-nvidia-580-server-generic-hwe-22.04 \
  nvidia-headless-580-server \
  nvidia-utils-580-server
reboot
```

After reboot, verify the host:

```bash
uname -r
nvidia-smi
systemctl is-active k3s
```

Expected: the kernel is the Ubuntu 22.04 HWE kernel, `nvidia-smi` shows the
Tesla T4, and k3s is active.

If the HWE kernel fails to boot, select the previous `5.15.0-181-generic`
kernel from grub and install the matching NVIDIA module package instead:

```bash
apt-get update
DEBIAN_FRONTEND=noninteractive apt-get install -y \
  linux-modules-nvidia-580-server-generic \
  nvidia-headless-580-server \
  nvidia-utils-580-server
reboot
```

## GPU Operator

Install or upgrade GPU Operator v26.3.2 from the remote checkout after
`git pull --ff-only origin main`:

```bash
helm repo add nvidia https://helm.ngc.nvidia.com/nvidia
helm repo update
helm upgrade --install gpu-operator nvidia/gpu-operator \
  --version v26.3.2 \
  -n gpu-operator \
  --create-namespace \
  -f deploy/gpu/nvidia-gpu-operator-values.yaml \
  --wait \
  --timeout 30m
```

Do not apply `docker/devbox-bundled/nvidia-device-plugin.yaml` in this cluster
when GPU Operator is installed. GPU Operator owns the device plugin.

## Verification

```bash
kubectl -n gpu-operator get pods -o wide
kubectl describe node aione-flyte2 | grep -A20 -E 'Capacity:|Allocatable:'
```

The node must report `nvidia.com/gpu: 1` in both capacity and allocatable
before Flyte GPU training tasks or development instances can schedule.
