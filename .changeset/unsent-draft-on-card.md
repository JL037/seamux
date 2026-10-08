---
"seamux": patch
---

When a message doesn't send, from a card or from seamux's queue, its card now shows it in red under "Didn't send", with the reason, and the board raises an error toast. The note stays until a message goes through or you dismiss it. A failed queued message used to vanish without a word.

A message left unsent in a chat's prompt box now also shows on its card while the chat is idle. It might be a message the board sent that the chat never took, or one typed in the terminal. Send sends it as it stands, and Edit moves it into the card's input and empties the chat's box.
