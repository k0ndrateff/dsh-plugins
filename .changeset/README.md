# Changesets

Every published package in this repository is released through changesets: a
change describes itself in a Markdown file here, `changeset version` turns those
descriptions into versions and changelogs, and `changeset publish` pushes the
versions that are not on the registry yet.

```sh
bun run changeset        # describe what changed, and how it bumps each package
bun run version-packages # apply the bumps and update the lockfile
bun run release          # publish, then regenerate docs/market.json
```

The libraries are published too, because a published plugin's `devDependencies`
name them by version: a plugin bundles them from source, so nothing installs
them at runtime, but the versions a release records must exist.

More: https://github.com/changesets/changesets
