#!/bin/sh
# The export-verify probe on Linux (docs/evidence/usb-verify-2026-11-15.md). Makes a file per
# file system, mounts it through a loop device as a stick, and runs `usbprobe` on it: the
# probe changes the file's bytes in the backing file, behind the mounted volume. Then mounts
# it again for the control. Needs root (mount), mkfs.vfat, mkfs.exfat and mkfs.ext4. Run from
# the repository root; in a container:
#   docker run --rm --privileged -v "$PWD":/src -w /src rust:1-bookworm sh -c \
#     'apt-get update -qq && apt-get install -y -qq dosfstools exfatprogs e2fsprogs cmake pkg-config &&
#      CARGO_TARGET_DIR=/tmp/target sh docs/evidence/usb-verify-2026-11-15/probe-linux.sh'
set -e
cargo build -q -p tc-sync --example usbprobe
probe="${CARGO_TARGET_DIR:-$PWD/target}/debug/examples/usbprobe"
work=$(mktemp -d)
mkdir "$work/stick"
uname -sr
for fs in vfat exfat ext4; do
  echo "== $fs"
  truncate -s 64M "$work/stick.img"
  case $fs in
    vfat) mkfs.vfat -F 32 "$work/stick.img" >/dev/null ;;
    exfat) mkfs.exfat "$work/stick.img" >/dev/null ;;
    ext4) mkfs.ext4 -q "$work/stick.img" ;;
  esac
  mount -o loop "$work/stick.img" "$work/stick"
  "$probe" "$work/stick" "$work/stick.img"
  umount "$work/stick"
  mount -o loop "$work/stick.img" "$work/stick"
  "$probe" "$work/stick"
  umount "$work/stick"
  rm "$work/stick.img"
done
rmdir "$work/stick" "$work"
