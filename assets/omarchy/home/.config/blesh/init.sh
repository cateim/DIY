# ble.sh user config (loaded automatically by ble.sh; see `ble.sh --help`)

# Don't print "[ble: exit]" when the shell exits
bleopt exec_exit_mark=

# History suggestion as plain gray text, no background (like zsh-autosuggestions).
# Fixed 256-color gray: the theme's "bright black" is too dark in some themes (e.g. Hackerman).
ble-face auto_complete='fg=244'

# Path highlighting while typing: same colors as `ls` (~/.config/eza/theme.yml), no underline.
# Fixed hex so the theme can't remap them (Hackerman turns most ANSI colors green).
ble-face command_directory=fg=#00afff
ble-face filename_directory=fg=#00afff
ble-face filename_directory_sticky=fg=#00afff
ble-face filename_link=fg=#56b6c2
ble-face filename_orphan=fg=#e06c75
ble-face filename_executable=fg=#98c379,bold
ble-face filename_other=none
ble-face filename_socket=fg=#c678dd
ble-face filename_pipe=fg=#d19a66
ble-face filename_character=fg=#e5c07b
ble-face filename_block=fg=#e5c07b,bold
ble-face filename_setuid=fg=black,bg=220
ble-face filename_setgid=fg=black,bg=191
ble-face filename_warning=fg=#e06c75
ble-face filename_url=fg=#61afef
ble-face filename_ls_colors=none
