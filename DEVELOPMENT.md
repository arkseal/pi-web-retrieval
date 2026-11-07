# Development and compatibility

Development checks pin Pi **1.5.0** and TypeBox **1.3.27**, matching the audited
host. Wildcard peers follow Pi's module-sharing contract; runtime Pi installations
provide those modules rather than installing private copies.

```sh
bun install --frozen-lockfile --ignore-scripts
bun run check  # strict production-source check against real host types
bun test
```

`bun.lock` is the canonical development lockfile and must be committed when
dependencies change. Keep unit tests independent of live search services and
credentials. Live provider compatibility is an additional opt-in check.
