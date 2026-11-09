# Upstream

Vendored from [dmmulroy/anti-slop](https://github.com/dmmulroy/anti-slop/tree/13909c9e07590f5a85d93c62712259fe14a883f7), commit `13909c9`: the `src/` plugin without its tests, under the MIT license in `LICENSE`. `vendor/eslint-stylistic/` keeps its own license and upstream note.

Local changes:

- Added `rules/require-named-props-type.ts`, registered as `anti-slop/require-named-props-type`: a PascalCase function that renders JSX must type its props parameter as a reference to `<Name>Props`. Not from upstream.

Upstream expects these files to be owned and edited here. When updating, diff upstream `src/` between `13909c9` and the new commit, apply that diff, keep local changes, and record the new commit and any local changes above. Keep `@oxlint/plugins` on exactly the installed `oxlint` version.
