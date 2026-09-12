# Webtools Reliability Verification

## Confirmed Defects and Changes

- Completed crawls were retained without an owner or eviction policy. The owned store now
  limits completed results to 32 entries, 16 MiB of serialized results, and a 15-minute TTL.
  Running crawls have a separate concurrency budget. Deletion/eviction does not delete
  caller results or durable tool/session artifacts.
- The response allocation/deallocation contract could reconstruct a vector with a capacity
  different from its original allocation. Both directions now transfer exact-size boxed
  buffers. Failure tests cover allocation, input copy, traps, decoding, and JSON parsing.
- Extraction, metadata, filtering, and HTTP/crawl work now have validated intermediate and
  output budgets. Truncation is marked; budget failures are explicit errors.
- WASM cores have explicit disposal and trap recovery. Numeric diagnostics use bounded weak
  registrations and do not instantiate WASM merely to inspect memory.
- The loader verifies manifest byte counts and SHA-256 before compilation. Direct ABI tests
  reject values that would truncate from `u64` to `usize` on wasm32. Search and robots requests
  use the same bounded HTTP path; disposing a crawl store aborts and joins its active work.

These defects are independent of the foreground Ink/React retention findings. The historical
multi-hour crash has not been replayed, and this pass does not claim it was caused by WASM.
The optional core component and the synthetic gateway fuel scaffold are not a new execution
runtime; see `architecture.md`.

## Local Evidence

Verified on Node 22.22.3 against implementation commits `827ec75` and `210ad81`:

- Complete root `npm run check:push`, including coverage-aware gates and native Rust tests.
- `npm run build` and `npm run pack:dry`.
- Fresh packed installation with install scripts disabled: CLI help/version, mock one-shot,
  installed Ink mount, TUI module import, and extraction through the packaged WASM binary.
- The final webtools suite has 58 passing tests; native webtools has 38 passing tests.
- A separate constrained-heap probe ran 5,000 URL operations. WASM stayed at 30 pages
  (1.875 MiB) from call 100 through call 5,000. Retained JS heap stayed below 5 MiB.
  Disposal removed the active core from diagnostics. This verifies ownership release,
  not immediate return of all external memory to the operating system.

Built WASM SHA-256:
`da3da5dc5435e589203c008a5a912ae07edf3f22cb3b3ffc6aa6ddbe793eb408`.
The packaged manifest records source, toolchain, and artifact identity. Tests exercise that
compiled artifact rather than a substitute JavaScript implementation.

## Remaining Limits

HTTP tests use deterministic fixtures, not a live Camofox/network soak. Mutation testing was
not run. Foreground reliability work merged in PR #104; the remaining session/runtime,
webtools/WASM, and gateway work is consolidated in PR #107. No packages were published.
