#!/bin/zsh
# Shared host helpers for the local rig scripts.
# MSYS2 supplies a POSIX shell, but Node and the Rust server are native Windows
# programs. Keep shell paths POSIX and convert only paths passed across that boundary.

case "$(uname -s)" in
  MSYS*|MINGW*|CYGWIN*) OS=windows; RIG_WINDOWS=1 ;;
  *)                     OS=unix;    RIG_WINDOWS=0 ;;
esac

npath() {
  if [ "$OS" = windows ]; then
    cygpath -m "$1"
  else
    print -rn -- "$1"
  fi
}

if [ "$OS" = windows ]; then
  EXE=.exe
  if [ -x /c/Windows/System32/curl.exe ]; then
    CURL=/c/Windows/System32/curl.exe
  else
    CURL=curl
  fi
else
  EXE=
  CURL=curl
fi
