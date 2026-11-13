# Maps

`@repo/maps` owns the projected country, regional and world maps, generators and
checksum manifest. The web app keeps chart presentation and localization. Its
runtime geometry stays in Git; the 212 source snapshots and 37 licensed downloads
live in the dedicated `openfacts-maps` R2 bucket at `maps.openfacts.app`.

The public API loads one map at a time and supplies geometry, subdivision names,
boundary credits and shading helpers. Web consumers read compiled JavaScript and
declarations from `dist`. Turbo builds the package before dependent checks and
servers. Direct web builds, glyph generation and Alchemy dev/deploy commands also
build it through Turbo. CI restores that build before invoking Alchemy directly.

```sh
pnpm turbo run build typecheck test lint format:check --filter=@repo/maps
pnpm --filter @repo/maps run archive restore
pnpm --filter @repo/maps run generate
pnpm format
```

`src/archive.json` records each artifact's path, byte length and SHA-256. Object
keys include the hash, so publishing another vintage preserves existing URLs.
`archive restore` downloads source snapshots into the ignored `.archive/sources`
cache and verifies each file before an atomic write. A valid cache needs no
network. Generation restores missing sources first and otherwise runs offline.
Ordinary builds and tests fetch no R2 objects and need no credentials.

The Vite adapter preserves `/boundaries/{ISO3}.zip` through redirects to pinned R2
objects, including a Cloudflare `_redirects` file in production. ZIPs are not
embedded in the application build. They retain source geometry, projected data,
provenance and licence notices.

For an intentional map refresh, generate the new sources and maps, then run:

```sh
pnpm --filter @repo/maps run archive pin
pnpm --filter @repo/maps run archive publish
pnpm --filter @repo/maps run archive verify
pnpm format
```

`pin` records the current `.archive/sources` and `.archive/downloads` files.
`publish` requires `CLOUDFLARE_ACCOUNT_ID` and `CLOUDFLARE_API_TOKEN` with R2 object
read/write access. It verifies existing objects, uploads missing ones and checks
every upload by reading it back. It has no delete operation. `verify` checks all
public object bytes. Commit the updated manifest and runtime geometry together
only after publication succeeds.

The bucket belongs to `packages/infra/maps.run.ts`, a separate retained stack,
deployed with `pnpm --filter @repo/infra run deploy:maps`. Preview cleanup cannot
remove it. Source definitions, coverage and licences are in the
[source guide](scripts/sources/README.md) and [candidate audit](scripts/sources/final-candidates.md).

Every registered country has a data contract in `test/maps.test.ts`. Tests cover
source parsing, geometry cuts, cache integrity and download redirects. Web tests
retain representative hover, keyboard, attribution and national-value checks.
Package lint, format, type-check, test and build tasks have independent Turbo
hashes; CI persists their cache across web-only changes.
