#!/bin/sh
# The export-verify probe on macOS (docs/evidence/usb-verify-2026-11-15.md). Makes a disk
# image per file system, mounts it as a stick, and runs `usbprobe` on it: the probe changes
# the file's bytes in the image, behind the mounted volume. Then mounts the image again for
# the control. Needs no administrator rights. Run from the repository root.
set -e
cargo build -q -p tc-sync --example usbprobe
probe="$PWD/target/debug/examples/usbprobe"
work=$(mktemp -d)
sw_vers | tr '\n' ' '; echo
for fs in "ExFAT" "MS-DOS FAT32"; do
  echo "== $fs"
  hdiutil create -quiet -size 64m -fs "$fs" -volname TCPROBE -layout NONE "$work/stick.dmg"
  hdiutil attach -nobrowse "$work/stick.dmg" >/dev/null
  "$probe" /Volumes/TCPROBE "$work/stick.dmg"
  hdiutil detach -quiet /Volumes/TCPROBE
  hdiutil attach -nobrowse "$work/stick.dmg" >/dev/null
  "$probe" /Volumes/TCPROBE
  hdiutil detach -quiet /Volumes/TCPROBE
  rm "$work/stick.dmg"
done
rmdir "$work"
