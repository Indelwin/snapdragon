---
'@snapdragon-ai/sd': minor
---

Add `/paste` for attaching clipboard content from inside `sd`.

- Pasting an image (e.g. screenshot) writes a content-addressed PNG into a
  per-session attachments dir (`<session-root>/<session-id>.attachments/`)
  and queues it as a `PendingAttachment` on the next prompt.
- Pasting text (or `/paste text`) echoes the clipboard's text contents
  back so you can copy a section into your prompt.
- macOS only for now (uses `osascript` for images, `pbpaste` for text);
  other platforms get a clear error message rather than a silent failure.
