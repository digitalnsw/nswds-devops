## [1.9.0](https://github.com/digitalnsw/nswds-devops/compare/v1.8.2...v1.9.0) (2026-07-20)

### Features

* **ci:** add a weekly canary that flags when the ccc v10 block can lift ([#27](https://github.com/digitalnsw/nswds-devops/issues/27)) ([5d34c4c](https://github.com/digitalnsw/nswds-devops/commit/5d34c4c8026717a3cf3d9d40e2f0f6f21217e39b)), closes [release-notes-generator#992](https://github.com/digitalnsw/release-notes-generator/issues/992)

## [1.8.2](https://github.com/digitalnsw/nswds-devops/compare/v1.8.1...v1.8.2) (2026-07-19)

### Bug Fixes

* **release:** pin conventional-changelog-conventionalcommits to v9 so release notes render ([#24](https://github.com/digitalnsw/nswds-devops/issues/24)) ([4dce544](https://github.com/digitalnsw/nswds-devops/commit/4dce544befe1892177a85257abacf4d94ab10056))

## [1.8.1](https://github.com/digitalnsw/nswds-devops/compare/v1.8.0...v1.8.1) (2026-07-19)

### Bug Fixes

* **confluence-sync:** stop the synced-from-github banner rendering as a code block ([#20](https://github.com/digitalnsw/nswds-devops/issues/20)) ([f273a90](https://github.com/digitalnsw/nswds-devops/commit/f273a9022c32a62d763cda13faae0b1cdd859ffa)), closes [nswds-app#418](https://github.com/digitalnsw/nswds-app/issues/418)

## [1.8.0](https://github.com/digitalnsw/nswds-devops/compare/v1.7.0...v1.8.0) (2026-07-19)

### Features

* **ci:** add lint and test jobs to the reusable CI ([#18](https://github.com/digitalnsw/nswds-devops/issues/18)) ([22a2743](https://github.com/digitalnsw/nswds-devops/commit/22a2743e442ce120a69184db1f0f23f2ca9620fd)), closes [nswds-app#418](https://github.com/digitalnsw/nswds-app/issues/418)

## [1.7.0](https://github.com/digitalnsw/nswds-devops/compare/v1.6.2...v1.7.0) (2026-07-17)

### Features

* add Renovate — shared preset, synced repo config, branch exemption ([#3](https://github.com/digitalnsw/nswds-devops/issues/3)) ([457bedc](https://github.com/digitalnsw/nswds-devops/commit/457bedc35876dc45d7bac26014fed160920c3cec))

### Bug Fixes

* **ci:** anchor the Confluence folder chain to the space home page ([#9](https://github.com/digitalnsw/nswds-devops/issues/9)) ([da994d1](https://github.com/digitalnsw/nswds-devops/commit/da994d1dd5d6a663eedd61253e917414b2a65ecc))
* **release:** use the ssh repository url so releases push via the deploy key ([#10](https://github.com/digitalnsw/nswds-devops/issues/10)) ([5f8a9ec](https://github.com/digitalnsw/nswds-devops/commit/5f8a9ec7149e487d9117b4b7c7251b12f3a3d1e3))

## [1.6.2](https://github.com/digitalnsw/nswds-devops/compare/v1.6.1...v1.6.2) (2026-07-16)

### Bug Fixes

* **ci:** let app repos skip the build step via CI_SKIP_BUILD variable ([#2](https://github.com/digitalnsw/nswds-devops/issues/2)) ([12630e2](https://github.com/digitalnsw/nswds-devops/commit/12630e23326a0668d1c35491fc764adf6324f298))

## [1.6.1](https://github.com/digitalnsw/nswds-devops/compare/v1.6.0...v1.6.1) (2026-07-16)

### Bug Fixes

* **sync:** map the merge-gate stub to shared-ci.yml in nswds-tokens ([2ccebd9](https://github.com/digitalnsw/nswds-devops/commit/2ccebd9bb71c2e8b8ecc0b6d2be3b12090198678)), closes [#1](https://github.com/digitalnsw/nswds-devops/issues/1) [tokens#121](https://github.com/digitalnsw/tokens/issues/121)

## [1.6.0](https://github.com/digitalnsw/nswds-devops/compare/v1.5.0...v1.6.0) (2026-07-16)

### Features

* **ci:** add shared CI merge gate synced to every repo ([#1](https://github.com/digitalnsw/nswds-devops/issues/1)) ([da4e3dc](https://github.com/digitalnsw/nswds-devops/commit/da4e3dcccd11b40150b92e51a61ead0311342d94))

## [1.5.0](https://github.com/digitalnsw/nswds-devops/compare/v1.4.0...v1.5.0) (2026-07-15)

### Features

* **sync:** onboard data, nswds-community, nswds-signature, nswds-email-issues ([ea2b0d0](https://github.com/digitalnsw/nswds-devops/commit/ea2b0d05f0025de68c4f4c78e44346fd5c9288f9))

## [1.4.0](https://github.com/digitalnsw/nswds-devops/compare/v1.3.0...v1.4.0) (2026-07-15)

### Features

* **stubs:** pin consumer stubs to the v1 floating tag ([621657f](https://github.com/digitalnsw/nswds-devops/commit/621657f9442624bfed3918a31374f6d5d0898053))

## [1.3.0](https://github.com/digitalnsw/nswds-devops/compare/v1.2.0...v1.3.0) (2026-07-15)

### Features

* **sync:** enable batch 4 (nswds-tokens, nswds-app, ictds-portal-flows) ([a7647d1](https://github.com/digitalnsw/nswds-devops/commit/a7647d13c766aa308cbb2e13106fcb0a8b9acaf4))

## [1.2.0](https://github.com/digitalnsw/nswds-devops/compare/v1.1.0...v1.2.0) (2026-07-15)

### Features

* **sync:** enable batch 3 (remaining stock-release repos) ([7b9b122](https://github.com/digitalnsw/nswds-devops/commit/7b9b1227907b5401e4a07f9534cb1125a0675732))

## [1.1.0](https://github.com/digitalnsw/nswds-devops/compare/v1.0.7...v1.1.0) (2026-07-15)

### Features

* **sync:** enable batch 2 repos (digitalnsw, attestation, nswds-email) ([2b2f1b0](https://github.com/digitalnsw/nswds-devops/commit/2b2f1b06337b53a1a206cdb91d328dcef893f389))

## [1.0.7](https://github.com/digitalnsw/nswds-devops/compare/v1.0.6...v1.0.7) (2026-07-15)

## [1.0.6](https://github.com/digitalnsw/nswds-devops/compare/v1.0.5...v1.0.6) (2026-07-15)

### Bug Fixes

* **ci:** pass the App token via GH_INSTALLATION_TOKEN ([e0d19de](https://github.com/digitalnsw/nswds-devops/commit/e0d19de65226a30d5ae2d9bef7a88897e4bc2f35))

## [1.0.5](https://github.com/digitalnsw/nswds-devops/compare/v1.0.4...v1.0.5) (2026-07-15)

### Bug Fixes

* **ci:** flag the sync token as a GitHub App installation token ([b565a78](https://github.com/digitalnsw/nswds-devops/commit/b565a7847694b07d1f94b562710d54c45f65562b))

## [1.0.4](https://github.com/digitalnsw/nswds-devops/compare/v1.0.3...v1.0.4) (2026-07-15)

### Bug Fixes

* **ci:** check out the repo before running the file sync ([f8031f2](https://github.com/digitalnsw/nswds-devops/commit/f8031f216be050998340d83200f9e28999681cc8))

## [1.0.3](https://github.com/digitalnsw/nswds-devops/compare/v1.0.2...v1.0.3) (2026-07-15)

### Bug Fixes

* **ci:** read the sync App ID from secrets where it was stored ([84a96c3](https://github.com/digitalnsw/nswds-devops/commit/84a96c313f17a6ccc2a1b112f7c1d1f94cc80b00))

## [1.0.2](https://github.com/digitalnsw/nswds-devops/compare/v1.0.1...v1.0.2) (2026-07-15)

### Bug Fixes

* **ci:** give actionlint a project root for the stub scratch tree ([fb2a18f](https://github.com/digitalnsw/nswds-devops/commit/fb2a18fbed2062b2b3e95008a8260bd0ec75fcd4))

## [1.0.1](https://github.com/digitalnsw/nswds-devops/compare/v1.0.0...v1.0.1) (2026-07-15)

### Bug Fixes

* **ci:** ignore informational SC2016 in actionlint's shellcheck pass ([b54450e](https://github.com/digitalnsw/nswds-devops/commit/b54450e59e0c58424474a66fe6ad5d596c369b5a))

## 1.0.0 (2026-07-15)

### Features

* **ci:** add file-sync automation and central CI ([b748350](https://github.com/digitalnsw/nswds-devops/commit/b74835052f56f6a6ed1d5ae1e98e28d642abb961))
* **ci:** convert shared workflows to reusable workflows + synced stubs ([e9ea54b](https://github.com/digitalnsw/nswds-devops/commit/e9ea54b13a28e88bdaf09b21b543633dc0e23e78)), closes [105/#107](https://github.com/105/nswds-devops/issues/107)

### Bug Fixes

* **commitlint:** exempt bot-authored commit subjects from linting ([f92482d](https://github.com/digitalnsw/nswds-devops/commit/f92482d449ea4c49560f10bff8e9a75e1bfee689))
