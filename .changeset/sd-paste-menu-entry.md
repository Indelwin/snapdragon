---
'@snapdragon-ai/sd': patch
---

Show `/paste` in the TUI command autocomplete menu. The command was
shipped in #15 and worked from the input line, but its registration in
`tui/input-commands.ts` was missed so it didn't appear in the popup
list.
