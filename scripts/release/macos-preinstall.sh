#!/bin/bash
# The macOS pkg's preinstall (#1016). The pkg always writes /Applications/translationCore 4.app
# and replaces what is there, but it cannot see a translationCore 4 that was moved, renamed or
# copied somewhere else, and so left one beside the new one. This finds every translationCore 4
# on the Mac, asks before anything is replaced, and removes the ones the pkg will not overwrite.
#
# A translationCore 4 is a bundle with this pkg's bundle id and the display name
# "translationCore 4". The tC4 4.0 beta has the id but the name "translationCore4", and stays
# (H16 part 3).
#
# Exit 0 installs. Exit 1 cancels: nothing is installed and nothing is removed. Installer has no
# other way to cancel from a script, and it reports a cancel as a failed installation.
set -u
id=org.unfoldingword.translationcore4
target="/Applications/translationCore 4.app"

say() { echo "translationCore 4 preinstall: $*"; }

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

# Every translationCore 4 where a translator keeps apps. Spotlight finds one anywhere, but only
# on a Mac that indexes; the folders are read as well, so a Mac with Spotlight off is covered
# where apps usually are. What Spotlight names outside /Applications and /Users (a build folder,
# a mounted disk) is not the translator's installed app, and is left alone.
installed_copies() {
  local home=$1
  {
    mdfind "kMDItemCFBundleIdentifier == '$id'" 2> /dev/null | grep -E '^(/Applications|/Users)/' | grep -v '/\.Trash/'
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

# Runs osascript as the person at the screen, since a dialog from root has no screen to show on.
as_person() { launchctl asuser "$uid" sudo -u "$person" /usr/bin/osascript "$@" > /dev/null 2>&1; }

# Asks whether to replace the copies listed in $1. Status 0 is yes. A dialog nobody answers in
# five minutes is a no: Installer stops a script after ten.
ask_to_replace() {
  as_person -e 'on run argv' \
    -e 'set answer to display dialog "translationCore 4 is already on this Mac:" & return & return & (item 1 of argv) & return & return & "Replace it with this version? Your projects and settings stay where they are." with title "translationCore 4" buttons {"Cancel", "Replace"} default button "Replace" cancel button "Cancel" with icon caution giving up after 300' \
    -e 'if gave up of answer then error number -128' \
    -e 'end run' "$1"
}

tell_person() {
  as_person -e 'on run argv' \
    -e 'display dialog (item 1 of argv) with title "translationCore 4" buttons {"OK"} default button "OK" giving up after 120' \
    -e 'end run' "$1"
}

main() {
  person=$(stat -f %Su /dev/console 2> /dev/null)
  uid=$(id -u "$person" 2> /dev/null)
  local home copies left
  home=$(dscl . -read "/Users/$person" NFSHomeDirectory 2> /dev/null | sed 's/^NFSHomeDirectory: //')
  copies=$(installed_copies "${home:-/var/empty}")
  [ -n "$copies" ] || exit 0
  say "found:" $'\n'"$copies"

  # `installer -pkg` in a terminal, or an install with nobody at the screen, has no one to ask:
  # the person who ran the command chose to install.
  local asks=yes
  if [ -n "${COMMAND_LINE_INSTALL:-}" ] || [ -z "$uid" ] || [ "$uid" = 0 ]; then asks=no; fi
  if [ "$asks" = yes ] && ! ask_to_replace "$copies"; then
    say "the translator chose not to replace it; nothing is installed"
    tell_person "Nothing was installed, and the translationCore 4 on this Mac is as it was. The installer will now say that the installation failed."
    exit 1
  fi

  left=$(printf '%s\n' "$copies" | remove_others)
  if [ -n "$left" ]; then
    say "could not remove:" $'\n'"$left"
    [ "$asks" = no ] || tell_person "The new translationCore 4 is being installed in Applications. This older copy could not be removed. Move it to the Trash yourself:"$'\n\n'"$left"
  fi
  exit 0
}

# A test reads the functions without running the install.
[ "${BASH_SOURCE[0]}" != "$0" ] || main "$@"
