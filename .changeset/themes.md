---
"seamux": patch
---

Themes: a new Themes tab in settings makes and edits themes, each a light and a dark set of colours, and switches every open board to one. A theme needs only its two brand colours; the board works out the rest of its palette from them, and anything else it sets replaces what was worked out. Debug has a new switch, Remote theme swapping, off by default: with it on, a JSON POST to `/debug/theme-swap`, `{"name": "pink-candy", "color": "light"}`, switches the theme from a script, from this Mac or over mDNS with the board's user and password. `color` is optional, and switches every browser to light or dark until its own toggle switches it back.
