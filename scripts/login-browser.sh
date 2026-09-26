#!/bin/sh
# The browser a sign-in the board runs is given, in place of a real one:
# it writes the sign-in URL where the board reads it, and opens no tab.
printf '%s\n' "$1" > "$SEAMUX_LOGIN_URL_FILE"
