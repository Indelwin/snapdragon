# Publishing

The first release targets npm packages under the `@snapdragon` scope.

Before publishing:

```bash
npm run typecheck
npm test
npm run build
npm run publish:dry
```

The repository starts private. Make it public only when package metadata, examples, and docs are ready for external readers.
