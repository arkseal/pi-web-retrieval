# Development and compatibility

Development checks pin Pi **1.6.1** and TypeBox **1.4.3**. Wildcard peers follow Pi's module-sharing contract; runtime Pi installations
provide those modules rather than installing private copies.

```sh
bun install --frozen-lockfile --ignore-scripts
bun run check  # strict production-source check against real host types
bun test
```

`bun.lock` is the canonical development lockfile and must be committed when
dependencies change. Keep unit tests independent of live search services and
credentials. Live provider compatibility is an additional opt-in check.
