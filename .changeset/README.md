# Changesets

Every package-affecting pull request should include a changeset:

```sh
npm run changeset
```

Choose the package(s), semver bump type, and a short user-facing note. After the
PR merges to `main`, the release workflow opens or updates a version PR. Merging
that version PR publishes the bumped packages to npm.
