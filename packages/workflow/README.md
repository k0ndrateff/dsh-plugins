# dsh-workflow-plugin

Every plugin of this repository behind one profile entry.

The package contains no code. It depends on the eight bundles and its patch mounts
a row for each; every row names its package the way that bundle's own patch does,
and the plugin's own defaults fill in the configuration that patch would have
written. A profile with this bundle alone therefore behaves exactly like one with
all eight.

Install it **instead of** the individual bundles, not beside them: two profile
layers inserting a row with the same id is a duplicate the loader refuses.

```yaml
- id: figma
  disabled: true
```

An override like that in the profile patch turns one plugin off without giving up
the rest.
