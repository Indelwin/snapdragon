# @snapdragon-ai/session

Portable append-only JSONL sessions for Snapdragon agents.

This package deliberately avoids SQLite and native dependencies. Rich indexing,
search, compaction, and rewrite tools can layer on top of the JSONL records
without changing the canonical session format.
