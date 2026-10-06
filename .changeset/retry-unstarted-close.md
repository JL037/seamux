---
"seamux": patch
---

When a close is held because the close-session macro never started a turn, closing the chat again sends the macro again instead of exiting without it, since none of the clean-up ran. The held note says so.
