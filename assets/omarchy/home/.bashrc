# Omarchy environment (OMARCHY_PATH + PATH), needed even for non-interactive shells
[[ -r /usr/share/omarchy/default/bash/env-bootstrap ]] && source /usr/share/omarchy/default/bash/env-bootstrap

# If not running interactively, don't do anything else (leave this above the rc source)
[[ $- != *i* ]] && return

# ble.sh: fish/zsh-style suggestions from history while typing (accept with →) + syntax highlighting.
# Loaded here, attached at the very end of this file (ble.sh requires that order). No-op if not installed.
[[ -f /usr/share/blesh/ble.sh ]] && source /usr/share/blesh/ble.sh --noattach

# All the default Omarchy aliases and functions
# (don't mess with these directly, just overwrite them here!)
source "$OMARCHY_PATH/default/bash/rc"

# Add your own exports, aliases, and functions here.
#
# Make an alias for invoking commands you use constantly
# alias p='python'

# Color output for tools that don't color by default
alias grep='grep --color=auto'
alias diff='diff --color=auto'
alias ip='ip -color=auto'

# Claude Code: started from ~, open it in ~/Work, like the Omarchy agent keybinding does.
# Claude never stores trust for ~, and cwd = ~ makes user, project and local settings one file.
claude() {
  if [[ $PWD == "$HOME" && -d $HOME/Work ]]; then
    (cd "$HOME/Work" && command claude "$@")
  else
    command claude "$@"
  fi
}

# Attach ble.sh (keep this as the last line)
[[ ! ${BLE_VERSION-} ]] || ble-attach
