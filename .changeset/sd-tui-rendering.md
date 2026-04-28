---
"@snapdragon-ai/sd": patch
---

Fix sd TUI transcript rendering: assistant messages now flow through a tiny markdown formatter (headings, blockquotes, inline `code`, `**bold**`) with code blocks rendered verbatim, transcript row keys are stable across streaming edits so the input cursor no longer flickers, and post-tool assistant text segments get their own transcript entry instead of overwriting the pre-tool segment.
