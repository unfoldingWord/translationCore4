#!/bin/zsh

# Return success when the rig working directory cannot be used without reseeding.
rig_state_needs_seed() {
  local state_dir="$1"
  [ ! -d "$state_dir" ] \
    || [ ! -f "$state_dir/app_state.json" ] \
    || [ ! -f "$state_dir/user_settings.json" ]
}

# Run the seed script only when the working directory is incomplete.
rig_ensure_state() {
  local state_dir="$1"
  local seed_script="$2"
  if rig_state_needs_seed "$state_dir"; then
    "$seed_script"
  fi
}
