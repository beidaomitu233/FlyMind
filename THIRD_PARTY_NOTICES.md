# Third-party notices

FlyMind's own code is licensed under the root [MIT LICENSE](LICENSE). This does not replace the licenses, copyright notices or redistribution conditions of the components below. Keep the original notices supplied with every downloaded or installed component.

## Fixed rendering resources

| Component | License / notices | Distributed or prepared resource |
|---|---|---|
| draw.io 31.5.3 | Apache-2.0; preserve bundled third-party notices | `resources/drawio/LICENSE`, `resources/drawio/supply.json`; the setup download retains its vendor notices |
| Noto Sans CJK SC Regular | SIL Open Font License 1.1; Adobe copyright | `resources/fonts/OFL.txt`, `resources/fonts/COPYRIGHT.txt`, `resources/fonts/supply.json` |
| Chromium headless shell revision 1234 | Chromium and its bundled components have their own licenses | Preserve the downloaded browser's LICENSE/NOTICE and component notices; it is not relicensed under FlyMind's MIT license |

The npm package does not embed the draw.io WAR or Chromium binary. Explicit `flymind setup` prepares the pinned resources in the user resource cache. Downloading separately does not remove the upstream license obligations. The included font must remain accompanied by its original license and copyright files.

## Runtime dependencies

The locally inspected direct dependency declarations include:

- MIT: `@modelcontextprotocol/sdk`, `@xmldom/xmldom`, `better-sqlite3`, `cors`, `express`, `fflate`, `pinia`, `vue`, `vue-router`, `zod`.
- EPL-2.0: `elkjs`.
- Apache-2.0: `playwright-core`, `sharp`.

Each dependency's installed package contains its authoritative license and any notices. Native binaries and transitive dependencies, including SQLite bindings, sharp/libvips and Chromium components, can have additional terms. This summary is not a complete replacement for those files. Maintainers must inspect the actual release tarball, dependency versions and downloaded supply before publishing; do not describe all dependencies as MIT.

No third-party trademark ownership is claimed. This inventory records the current distribution inputs and does not resolve rights in any external business material imported by users.
