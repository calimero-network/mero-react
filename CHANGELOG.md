## [2.1.0](https://github.com/calimero-network/mero-react/compare/mero-react-v2.0.1...mero-react-v2.1.0) (2026-05-06)

### Features

* filled ConnectButton, logoOnly + label props ([ecd1105](https://github.com/calimero-network/mero-react/commit/ecd1105cf7a8edcaecce4ffb8516943224ac3440))
* real Calimero logo + connect-button polish + theme showcase ([5291b3b](https://github.com/calimero-network/mero-react/commit/5291b3b38b43fe24651a6261b088646746a1dfe9))
* Storybook 8 setup with rich controls + mocked context ([75995be](https://github.com/calimero-network/mero-react/commit/75995be4d731fdcf72c407b62b63da6aaa235b46))
* update component theme ([42338f2](https://github.com/calimero-network/mero-react/commit/42338f2becd99fc81c542db25ca67de2236abebd))
* update component theme + storybook ([ea36a1b](https://github.com/calimero-network/mero-react/commit/ea36a1bdc5045439c505e3611e96c8099f4f1053))
* update name ([7719c6a](https://github.com/calimero-network/mero-react/commit/7719c6a89e289cc0aeb2125d51ac76088161feb9))

### Bug Fixes

* address PR [#17](https://github.com/calimero-network/mero-react/issues/17) fifth-round review ([97fa96b](https://github.com/calimero-network/mero-react/commit/97fa96be4ceb10a2c7e239bf1bf32cafe0c0215f))
* address PR [#17](https://github.com/calimero-network/mero-react/issues/17) fourth-round review ([c3b470f](https://github.com/calimero-network/mero-react/commit/c3b470fb2b3ba2be7ed3cb717e3a8e380bd2a62a))
* address PR [#17](https://github.com/calimero-network/mero-react/issues/17) review feedback on theming ([7de595c](https://github.com/calimero-network/mero-react/commit/7de595c9d69e89ae4b07fc53c33de5d7ba3ddca3))
* address PR [#17](https://github.com/calimero-network/mero-react/issues/17) second-round review ([b8dc0c6](https://github.com/calimero-network/mero-react/commit/b8dc0c6104bfd3e816ede8c7bc02fe78da829d07))
* address PR [#17](https://github.com/calimero-network/mero-react/issues/17) third-round review ([6004a06](https://github.com/calimero-network/mero-react/commit/6004a06100f4feba93955e3d7c0175209729af0b))
* auto-inject component CSS so consumers don't need a CSS import ([3282efe](https://github.com/calimero-network/mero-react/commit/3282efe1865ce0522716274665234b1fbf85d967))
* **ConnectButton:** connected state inherits theme colour ([203eab0](https://github.com/calimero-network/mero-react/commit/203eab0bd6179c12a115438e4d61181f33ecca99))
* drop empty theme values in resolveMeroTheme ([66af71f](https://github.com/calimero-network/mero-react/commit/66af71f0239c8663941e7436acda55e966a325e9))
* **example:** alias mero-react to source so styles never go missing ([ef0d083](https://github.com/calimero-network/mero-react/commit/ef0d083af75a7548b5d1264e3dbb9bb9980ee50e))
* **example:** one-command dev loop + remove auth-redirect from / ([583b832](https://github.com/calimero-network/mero-react/commit/583b832a730e901e84d514dc68b9881f68a5ed83))

## [2.0.1](https://github.com/calimero-network/mero-react/compare/mero-react-v2.0.0...mero-react-v2.0.1) (2026-04-28)

### Bug Fixes

* **ci:** use Node 24 for npm trusted publishing ([a92649d](https://github.com/calimero-network/mero-react/commit/a92649d82e372bded0090f18ccb48a358d0da8ac))

## [2.0.0](https://github.com/calimero-network/mero-react/compare/mero-react-v1.1.0...mero-react-v2.0.0) (2026-04-28)

### ⚠ BREAKING CHANGES

* **hooks:** useSetDefaultVisibility renamed to
useSetSubgroupVisibility. The returned callback is renamed from
setDefaultVisibility to setSubgroupVisibility, and its request body
field is now subgroupVisibility instead of defaultVisibility.
GroupInfo.defaultVisibility (read via useGroupInfo and other group-info
hooks) is now subgroupVisibility. Requires
@calimero-network/mero-js@^2.0.0.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>

### Features

* add docs ([d6751f1](https://github.com/calimero-network/mero-react/commit/d6751f13bd122209c53ee85b0b82bb811836b24c))
* **hooks:** rename useSetDefaultVisibility → useSetSubgroupVisibility ([c888d42](https://github.com/calimero-network/mero-react/commit/c888d42aaf4a00ce3cc215829fd438c015e91a8f)), closes [calimero-network/mero-js#33](https://github.com/calimero-network/mero-js/issues/33) [calimero-network/core#2261](https://github.com/calimero-network/core/issues/2261) [calimero-network/mero-js#33](https://github.com/calimero-network/mero-js/issues/33)

### Bug Fixes

* **ci:** bump release workflow to Node 22 + surface semantic-release failures ([9f1779d](https://github.com/calimero-network/mero-react/commit/9f1779dae32143882e19d9638b14c521aa36e499)), closes [#12](https://github.com/calimero-network/mero-react/issues/12)
* **ci:** make breaking-change marker bump major in releaseRules ([84f394e](https://github.com/calimero-network/mero-react/commit/84f394e1c705b6289d3ce1f38be5b8234b2309e1))
* cleanup ([04672e1](https://github.com/calimero-network/mero-react/commit/04672e1b7f979ef7002ee3a3952477052cd1d969))
* cleanup ([986cb4a](https://github.com/calimero-network/mero-react/commit/986cb4a892330b34283f2d0d0f0562955e3657ee))
* comments ([ff45cca](https://github.com/calimero-network/mero-react/commit/ff45ccaf6ceea9d360d36d65ddf4125eec940004))

## [1.1.0](https://github.com/calimero-network/mero-react/compare/mero-react-v1.0.2...mero-react-v1.1.0) (2026-04-08)

### Features

* add group and context management hooks ([b8d9bf8](https://github.com/calimero-network/mero-react/commit/b8d9bf8fda6ab189b78c339793368e15e7af4130))
* add namespace and group management hooks with full parity ([b9cd607](https://github.com/calimero-network/mero-react/commit/b9cd607cf0c11e5f1b2426774d3a4275fd4a4606))
* enhance context and group management hooks ([4afae67](https://github.com/calimero-network/mero-react/commit/4afae67cf0de5714623af90603199489e0699e4b))

### Bug Fixes

* align joinContext and setMemberCapabilities with new mero-js signatures ([a3f3e1c](https://github.com/calimero-network/mero-react/commit/a3f3e1c61fd92dc7688b17d0eb1e4529a73f18f5))
* remove hooks and types referencing non-existent mero-js methods ([7b25f07](https://github.com/calimero-network/mero-react/commit/7b25f0762ba74c3f5fb9f0214a3a5c7898071feb))
* resolve CI typecheck errors ([0fa3641](https://github.com/calimero-network/mero-react/commit/0fa36413cf768768a0891c28cfd6d3d74f9df36f))

## [1.0.2](https://github.com/calimero-network/mero-react/compare/mero-react-v1.0.1...mero-react-v1.0.2) (2026-03-31)

### Bug Fixes

* trigger npm publish (1.0.1 failed due to private repo) ([9b8f453](https://github.com/calimero-network/mero-react/commit/9b8f4536d95ba6a4bd6cb34d37cd7c954e128bcd))

## [1.0.1](https://github.com/calimero-network/mero-react/compare/mero-react-v1.0.0...mero-react-v1.0.1) (2026-03-31)

### Bug Fixes

* release workflow detection pattern for semantic-release output ([11ea7fa](https://github.com/calimero-network/mero-react/commit/11ea7faecc5b5a48555d1528ae68f61fa6b9eb90))

## 1.0.0 (2026-03-31)

### Features

* initial mero-react implementation ([3665448](https://github.com/calimero-network/mero-react/commit/366544808bc5ec9054dab41365dd1b1076616eb9))

### Bug Fixes

* production-ready provider, hooks, and public API ([4a4b934](https://github.com/calimero-network/mero-react/commit/4a4b93494ab8919c5d54325313a059e091a48bb9))
* production-ready provider, hooks, and public API ([06e84e9](https://github.com/calimero-network/mero-react/commit/06e84e93b36c7a557abfdee458a96ceb355eef02))
* production-ready provider, hooks, and public API ([752e0a4](https://github.com/calimero-network/mero-react/commit/752e0a48dfa732c4e688dd0431c75028bc202600))
