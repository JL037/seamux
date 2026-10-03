---
"seamux": patch
---

Themes: a new Themes tab in settings makes and edits themes, each a light and a dark set of colours, and switches every open board to one at once. A theme needs only its two brand colours; the board works out the rest of its palette from them, and anything else it sets replaces what was worked out. Below the editor, a switch, Allow POST /theme/set, off by default: with it on, a JSON POST to `/theme/set`, `{"name": "pink-candy", "color": "light"}`, with the board's user and password, switches the theme from a script, from this Mac or over mDNS. `color` is optional, and switches every browser to light or dark until its own toggle switches it back. Debug's Clear all themes removes every saved theme.
