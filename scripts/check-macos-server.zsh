#!/bin/zsh
# A self-contained Mac server may depend on OS libraries, but not a build host's
# Homebrew prefix or unresolved @rpath libraries. Run on the final staged binary.
set -e
dependencies=$(otool -L "$1")
print -r -- "$dependencies"
external=$(print -r -- "$dependencies" | awk 'NR > 1 { print $1 }' | \
  grep -vE '^(/System/Library/|/usr/lib/)' || true)
if [ -n "$external" ]; then
  print -u2 -r -- "FAIL self-contained server: external libraries: $external"
  exit 1
fi
