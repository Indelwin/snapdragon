# Ink compatibility fork

Base: npm `ink@7.0.1`, MIT, https://github.com/vadimdemedes/ink.
The checksummed upstream release is in `vendor/ink-7.0.1.tgz`.
`scripts/build.mjs` verifies its SHA-512 before extracting it and overlaying
only the measurement/wrapping cache implementation. No consumer installation
is patched. Caches retain at most 4096 entries and 8 MiB of accounted text each.
Count also bounds object overhead; actual heap usage is verified by soak tests.

The `ink` dependency key aliases this package. sd bundles that alias so packed
installs work before a separate fork release, without fetching unpublished code.
Keep only one Ink and one React instance in dependency-tree smoke tests.

Return to upstream when a published release bounds both caches, passes the
same retained-heap and terminal-input tests, and has compatible peer dependencies.
Do not migrate unrelated upstream changes as part of this fork.
