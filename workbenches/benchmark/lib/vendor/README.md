# Vendored libraries

The workbench folder is all the handler has at runtime: the host copies it into each Agent's `agent_state/workbenches/benchmark/` and compiles `index.ts` with TypeScript alone, and `npm pack` drops nested `node_modules`. So the two parsers the format needs travel here as TypeScript source, at the versions this repository's lockfile pins for `./format`:

| Folder | Package | Version | Commit | Licence |
| --- | --- | --- | --- | --- |
| `smol-toml/` | [smol-toml](https://github.com/squirrelchat/smol-toml) | 1.9.1 | `69aa050fef018b71799519bb2cbb54f158a0c5f9` | BSD-3-Clause (`smol-toml/LICENSE`) |
| `yaml/` | [yaml](https://github.com/eemeli/yaml) | 2.9.1 | `1440ecd3d1bff41e4ac399f8f6839e810328bd16` | ISC (`yaml/LICENSE`) |

Each folder is the package's `src/` at that commit (`yaml` without `cli.ts` and `test-events.ts`, which the library does not import), changed in two ways only:

- Every relative import names the emitted `.js` file (`'./parse.ts'` becomes `'./parse.js'`): the host compiles under `module: NodeNext` without `allowImportingTsExtensions`, and emits specifiers as written.
- Every file starts with `// @ts-nocheck` and a line naming its origin. The authors type-check their sources under their own options; the host's options differ (smol-toml names `Temporal`, which the host's library does not declare, on a path this workbench never takes), and a later TypeScript in the host must not refuse a load over a library's internals.

To move a version: check out the tag, copy `src/` again, apply the two changes, and pin the same version of the npm package in `package.json` so `./format` parses as the handler does.
