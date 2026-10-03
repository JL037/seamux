---
"seamux": patch
---

The board answers its `.local` name however it's capitalised. curl and Shortcuts send the name as typed, and `http://Osmium.local:54321/` was refused with "Blocked request. This host is not allowed." while `osmium.local` worked; browsers always send it lowercased, so only scripts met it.
