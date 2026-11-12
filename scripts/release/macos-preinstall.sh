#!/bin/bash
# The macOS pkg's preinstall and postinstall (#1016); macos-pkg.sh puts this one file in the pkg
# under both names. The pkg always writes /Applications/translationCore 4.app and replaces what
# is there, but it cannot see a translationCore 4 that was moved, renamed or copied somewhere
# else, and so left one beside the new one.
#
# Before the install, this finds every translationCore 4 on the Mac and asks the person at the
# screen whether to replace them. After the install, it removes the copies they agreed to that
# the pkg did not overwrite. Nothing is removed that the person was not shown, and nothing is
# removed before the new app is in place.
#
# A translationCore 4 is a bundle with this pkg's bundle id and the display name
# "translationCore 4". The tC4 4.0 beta has the id but the name "translationCore4", and stays
# (H16 part 3).
#
# preinstall: exit 0 installs; exit 1 cancels, and nothing is installed or removed. Installer has
# no other way to cancel from a script, and it reports a cancel as a failed installation.
set -u
id=org.unfoldingword.translationcore4
target="/Applications/translationCore 4.app"
# What the person agreed to replace, from the preinstall to the postinstall. Only root writes here.
consent=/private/var/run/org.unfoldingword.translationcore4.replace

say() { echo "translationCore 4 installer: $*"; }

# Reads bundle paths, one per line, and prints those that are a translationCore 4.
keep_translationcore4() {
  local app
  while IFS= read -r app; do
    [ -f "$app/Contents/Info.plist" ] || continue
    [ "$(/usr/libexec/PlistBuddy -c 'Print :CFBundleIdentifier' "$app/Contents/Info.plist" 2> /dev/null)" = "$id" ] || continue
    [ "$(/usr/libexec/PlistBuddy -c 'Print :CFBundleDisplayName' "$app/Contents/Info.plist" 2> /dev/null)" = "translationCore 4" ] || continue
    printf '%s\n' "$app"
  done
}

# The app bundles in the folders given, not those inside another bundle.
bundles_in() {
  local dir
  for dir in "$@"; do
    [ -d "$dir" ] && find "$dir" -maxdepth 3 -name '*.app' -prune -print 2> /dev/null
  done
  return 0
}

# Reads paths and prints those in Applications or in the home folder $1, outside its Trash and
# Library. Another person's folder, a mounted disk and a temporary folder are not this person's
# to replace.
in_this_persons_folders() {
  local home=$1 path
  while IFS= read -r path; do
    case "$path" in
      "$home"/.Trash/* | "$home"/Library/*) ;;
      /Applications/* | "$home"/*) printf '%s\n' "$path" ;;
    esac
  done
}

# Every translationCore 4 this person has. Spotlight finds one anywhere, but only on a Mac that
# indexes; the folders apps are kept in are read as well, for a Mac with Spotlight off.
installed_copies() {
  local home=$1
  {
    mdfind "kMDItemCFBundleIdentifier == '$id'" 2> /dev/null | in_this_persons_folders "$home"
    bundles_in /Applications "$home/Applications" "$home/Desktop" "$home/Downloads"
  } | sort -u | keep_translationcore4
}

# Reads the copies, one per line, and removes each that is not where the pkg installs. Prints
# the ones it could not remove.
remove_others() {
  local app
  while IFS= read -r app; do
    [ "$app" = "$target" ] && continue
    rm -rf "$app" 2> /dev/null
    [ -e "$app" ] && printf '%s\n' "$app"
  done
  return 0
}

# Sets the person at the screen. `installer -pkg` in a terminal, the login window and a remote
# install have no one to ask.
find_person() {
  person=$(stat -f %Su /dev/console 2> /dev/null)
  uid=$(id -u "$person" 2> /dev/null)
  home=$(dscl . -read "/Users/$person" NFSHomeDirectory 2> /dev/null | sed 's/^NFSHomeDirectory: //')
}
can_ask() { [ -z "${COMMAND_LINE_INSTALL:-}" ] && [ -n "${uid:-}" ] && [ "$uid" != 0 ]; }

# Runs osascript as the person at the screen, since a dialog from root has no screen to show on.
as_person() { launchctl asuser "$uid" sudo -u "$person" /usr/bin/osascript "$@"; }

# Asks whether to replace the copies listed in $1. Status 0 is Replace and 1 is Cancel; a dialog
# nobody answers in five minutes is a Cancel (Installer stops a script after ten). Status 2 is a
# dialog that could not be shown, which is not the person's no.
ask_to_replace() {
  local said
  said=$(as_person -e 'on run argv' \
    -e 'tell current application to activate' \
    -e 'set answer to display dialog "translationCore 4 is already on this Mac:" & return & return & (item 1 of argv) & return & return & "Replace it with this version? Your projects and settings stay where they are." with title "translationCore 4" buttons {"Cancel", "Replace"} default button "Replace" cancel button "Cancel" with icon caution giving up after 300' \
    -e 'if gave up of answer then error number -128' \
    -e 'end run' "$1" 2>&1) && return 0
  case "$said" in *-128*) return 1 ;; esac
  say "the question could not be shown: $said"
  return 2
}

tell_person() {
  as_person -e 'on run argv' \
    -e 'tell current application to activate' \
    -e 'display dialog (item 1 of argv) with title "translationCore 4" buttons {"OK"} default button "OK" giving up after 120' \
    -e 'end run' "$1" > /dev/null 2>&1
}

# $1 is the copies found. Status 1 cancels the install.
before_install() {
  local copies=$1
  rm -f "$consent"
  [ -n "$copies" ] || return 0
  say "found:" $'\n'"$copies"
  if ! can_ask; then
    say "nobody to ask; installing, and a copy outside $target stays"
    return 0
  fi
  ask_to_replace "$copies"
  case $? in
    0) printf '%s\n' "$copies" > "$consent" ;;
    1)
      say "the person chose not to replace it; nothing is installed"
      tell_person "Nothing was installed, and the translationCore 4 on this Mac is as it was. The installer will now say that the installation failed."
      return 1 ;;
    *) say "installing, and a copy outside $target stays" ;;
  esac
  return 0
}

after_install() {
  [ -f "$consent" ] || return 0
  local left
  left=$(keep_translationcore4 < "$consent" | remove_others)
  rm -f "$consent"
  [ -n "$left" ] || return 0
  say "could not remove:" $'\n'"$left"
  tell_person "translationCore 4 is installed in Applications. This older copy could not be removed. Move it to the Trash yourself:"$'\n\n'"$left"
  return 0
}

# A test reads the functions without running an install.
if [ "${BASH_SOURCE[0]}" = "$0" ]; then
  find_person
  case "$(basename "$0")" in
    postinstall) after_install ;;
    *) before_install "$(installed_copies "${home:-/var/empty}")" || exit 1 ;;
  esac
  exit 0
fi
