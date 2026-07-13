## [4.3.3](https://github.com/calimero-network/mero-react/compare/mero-react-v4.3.2...mero-react-v4.3.3) (2026-07-13)

## [4.3.2](https://github.com/calimero-network/mero-react/compare/mero-react-v4.3.1...mero-react-v4.3.2) (2026-07-13)

## [4.3.1](https://github.com/calimero-network/mero-react/compare/mero-react-v4.3.0...mero-react-v4.3.1) (2026-07-06)

### Bug Fixes

* **login:** remove Local/Remote tabs from LoginModal ([#43](https://github.com/calimero-network/mero-react/issues/43)) ([8a24c6f](https://github.com/calimero-network/mero-react/commit/8a24c6fa177565a942b0c95b6e3ebdbc557c5db6))

## [4.3.0](https://github.com/calimero-network/mero-react/compare/mero-react-v4.2.0...mero-react-v4.3.0) (2026-07-05)

### Features

* **auth:** request namespace/group/blob/alias grants for scope-enforced cores ([#42](https://github.com/calimero-network/mero-react/issues/42)) ([3de7ea8](https://github.com/calimero-network/mero-react/commit/3de7ea884f2995bf403f753c4f04f8d4776af286))

## [4.2.0](https://github.com/calimero-network/mero-react/compare/mero-react-v4.1.1...mero-react-v4.2.0) (2026-07-05)

### Features

* live-node hook integration tests + useAsyncResource staleness guard ([c26bac7](https://github.com/calimero-network/mero-react/commit/c26bac7b3159a9be4cac110ed59a8fce3632bf06))

## [4.1.1](https://github.com/calimero-network/mero-react/compare/mero-react-v4.1.0...mero-react-v4.1.1) (2026-07-05)

### Bug Fixes

* **auth:** validate sessions via /auth/validate instead of GET /admin-api/contexts ([#41](https://github.com/calimero-network/mero-react/issues/41)) ([9533c27](https://github.com/calimero-network/mero-react/commit/9533c27fccff268f289e7af5902d1347ab357c10)), closes [calimero-network/core#3040](https://github.com/calimero-network/core/issues/3040)

## [4.1.0](https://github.com/calimero-network/mero-react/compare/mero-react-v4.0.1...mero-react-v4.1.0) (2026-07-01)

### Features

* **LoginModal:** auto-discover local nodes via health probe ([96da04f](https://github.com/calimero-network/mero-react/commit/96da04f62b1d27563258773dc606d2971859fb14))

### Bug Fixes

* address review — health status edge cases + abort/radio cleanup ([3bfde38](https://github.com/calimero-network/mero-react/commit/3bfde38ca4cc4da556247ca913c7d6c8200ffd9e))
* **LoginModal:** address review — path-safe endpoints, reset stale nodes ([43350bb](https://github.com/calimero-network/mero-react/commit/43350bb26f30ba2fdc988a87ba7c6a0bc816a75c))

## [4.0.1](https://github.com/calimero-network/mero-react/compare/mero-react-v4.0.0...mero-react-v4.0.1) (2026-06-26)

## [4.0.0](https://github.com/calimero-network/mero-react/compare/mero-react-v3.0.2...mero-react-v4.0.0) (2026-06-23)

### ⚠ BREAKING CHANGES

* **hooks:** useNestGroup/useUnnestGroup are removed in favor of
useReparentGroup. Requires @calimero-network/mero-js >=6.

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>

### Features

* **hooks:** replace useNestGroup/useUnnestGroup with useReparentGroup ([b60db86](https://github.com/calimero-network/mero-react/commit/b60db86c67a620f0845ed03fb2f4dd3e77080d5b)), closes [51/#52](https://github.com/51/mero-react/issues/52)

## [3.0.2](https://github.com/calimero-network/mero-react/compare/mero-react-v3.0.1...mero-react-v3.0.2) (2026-06-23)

### Bug Fixes

* **security:** bind OAuth callback node, make token store configurable, clear tokens on logout ([0ca921e](https://github.com/calimero-network/mero-react/commit/0ca921e140bbb0d95fd81ac82402ffae76baad72))
* **security:** reject untrusted callback node by default and restore session on reject ([a815140](https://github.com/calimero-network/mero-react/commit/a8151407e152dab90421e09a9cdf797ee788f6cb))

## [3.0.1](https://github.com/calimero-network/mero-react/compare/mero-react-v3.0.0...mero-react-v3.0.1) (2026-06-17)

### Bug Fixes

* **hooks:** align useGroupUpgradeStatus + useMyAuthoredMigration with sibling consistency ([5f00b53](https://github.com/calimero-network/mero-react/commit/5f00b53eb79c1240f7b3eefcf004d2947d33822b))

## [3.0.0](https://github.com/calimero-network/mero-react/compare/mero-react-v2.6.1...mero-react-v3.0.0) (2026-06-15)

### ⚠ BREAKING CHANGES

* **hooks:** requires @calimero-network/mero-js >=3, which removes
`migrateMethod` from `UpdateContextApplicationRequest` and `UpgradeGroupRequest`.
mero-react re-exports these types, so callers must stop passing the field.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>

### Features

* **hooks:** add useResyncContext; require mero-js v3 ([9d0b362](https://github.com/calimero-network/mero-react/commit/9d0b362923cfebc9c785875b6e06b4232b3b1980))

## [2.6.1](https://github.com/calimero-network/mero-react/compare/mero-react-v2.6.0...mero-react-v2.6.1) (2026-06-10)

### Bug Fixes

* **useMemberMetadata:** preserve `await refetch()` state-ready contract ([d2e7b38](https://github.com/calimero-network/mero-react/commit/d2e7b384740de5e8c93b3fb3404c52c106dec625))
* **useMemberMetadata:** re-fetch reliably on remount ([9966e3a](https://github.com/calimero-network/mero-react/commit/9966e3a73f942afa14b4f2e2c458fa10677509e7))

## [2.6.0](https://github.com/calimero-network/mero-react/compare/mero-react-v2.5.0...mero-react-v2.6.0) (2026-06-09)

### Features

* **hooks:** useLatestVersion + failed migration state surfacing ([#2539](https://github.com/calimero-network/mero-react/issues/2539)) ([664c5e3](https://github.com/calimero-network/mero-react/commit/664c5e39212a0adc13ee6db78c8cf0d9fac76b15))

### Bug Fixes

* **useLatestVersion:** invalidate in-flight request when inputs are cleared ([1ae543b](https://github.com/calimero-network/mero-react/commit/1ae543beef892782212118ac741075e32793c859))

## [2.5.0](https://github.com/calimero-network/mero-react/compare/mero-react-v2.4.0...mero-react-v2.5.0) (2026-06-08)

### Features

* **components:** MigrationPendingBanner + MigrationAdminPanel (6h.4-6h.6) ([ac30b94](https://github.com/calimero-network/mero-react/commit/ac30b9414195f778b36cf21a583a44c7bbfc1b45))
* **hooks:** useMigrationStatus, useAppVersion, useMyAuthoredMigration (6h.1-6h.3) ([c764dce](https://github.com/calimero-network/mero-react/commit/c764dce94bfd058479d2cc84290af3790d2bd243))

### Bug Fixes

* **6h:** clear state on id change, invalidate in-flight on event/authorize, surface poll errors (review) ([8a5a949](https://github.com/calimero-network/mero-react/commit/8a5a9492cb3bd945aa0ae6318b2d7e7cbbf4f066))
* **6h:** latest-request-wins guard in hooks + admin panel load/error states (review) ([30ec4c8](https://github.com/calimero-network/mero-react/commit/30ec4c849c3dbbb36288fa16f97867d3505b44d3))

## [2.4.0](https://github.com/calimero-network/mero-react/compare/mero-react-v2.3.0...mero-react-v2.4.0) (2026-05-15)

### Features

* add useJoinSubgroupInheritance hook ([00de345](https://github.com/calimero-network/mero-react/commit/00de3456dda77fbec64f7ed4b225ef8577400280)), closes [calimero-network/mero-js#37](https://github.com/calimero-network/mero-js/issues/37) [calimero-network/core#2360](https://github.com/calimero-network/core/issues/2360) [core#2357](https://github.com/calimero-network/core/issues/2357) [mero-js#37](https://github.com/calimero-network/mero-js/issues/37)

## [2.3.0](https://github.com/calimero-network/mero-react/compare/mero-react-v2.2.1...mero-react-v2.3.0) (2026-05-12)

### Features

* metadata-record hooks + capability constant re-export ([08041c7](https://github.com/calimero-network/mero-react/commit/08041c702908e0d216fe3712e12c75cf702bd6bf)), closes [calimero-network/mero-js#35](https://github.com/calimero-network/mero-js/issues/35)

## [2.2.1](https://github.com/calimero-network/mero-react/compare/mero-react-v2.2.0...mero-react-v2.2.1) (2026-05-09)

### Bug Fixes

* **hooks:** read members field correctly in useGroupMembers ([25274f5](https://github.com/calimero-network/mero-react/commit/25274f570bb364e38eba9e9fe788487d50a1d47c)), closes [calimero-network/mero-js#34](https://github.com/calimero-network/mero-js/issues/34) [post-mero-js#34](https://github.com/calimero-network/post-mero-js/issues/34)

## [2.2.0](https://github.com/calimero-network/mero-react/compare/mero-react-v2.1.0...mero-react-v2.2.0) (2026-05-07)

### Features

* deprecate single context + update example ([ed9fe33](https://github.com/calimero-network/mero-react/commit/ed9fe33f665857ea004940b0cca316b794fd853e))

### Bug Fixes

* address PR [#19](https://github.com/calimero-network/mero-react/issues/19) eighth-round review ([d554f77](https://github.com/calimero-network/mero-react/commit/d554f773fee2dd977125828645beaacd251dd5ed))
* address PR [#19](https://github.com/calimero-network/mero-react/issues/19) fifth-round review ([edc1ab7](https://github.com/calimero-network/mero-react/commit/edc1ab77f25b9e982acf1ec85fdf2c18a700717b))
* address PR [#19](https://github.com/calimero-network/mero-react/issues/19) follow-up review ([3eac70e](https://github.com/calimero-network/mero-react/commit/3eac70e2f8cf207903d96eecc9a9df507b4b0cd3))
* address PR [#19](https://github.com/calimero-network/mero-react/issues/19) fourth-round review ([083a9e2](https://github.com/calimero-network/mero-react/commit/083a9e2bc0ba5cee7637af444d29e8aa96201d9b))
* address PR [#19](https://github.com/calimero-network/mero-react/issues/19) ninth-round review ([980c2c3](https://github.com/calimero-network/mero-react/commit/980c2c374411669e46e62743e5fbdc35c4a0446e))
* address PR [#19](https://github.com/calimero-network/mero-react/issues/19) review ([597716b](https://github.com/calimero-network/mero-react/commit/597716b9fff55610d4c1d1e51e83d3e09ed63e17))
* address PR [#19](https://github.com/calimero-network/mero-react/issues/19) seventh-round review ([e621d2b](https://github.com/calimero-network/mero-react/commit/e621d2b29af5bd09465eb9b19e72819b9a8dfd23))
* address PR [#19](https://github.com/calimero-network/mero-react/issues/19) sixth-round review ([19d8e9c](https://github.com/calimero-network/mero-react/commit/19d8e9ce9aaf1d5133f0b5fb073d4cffacd1dab9))
* address PR [#19](https://github.com/calimero-network/mero-react/issues/19) tenth-round review ([c07fdfc](https://github.com/calimero-network/mero-react/commit/c07fdfc718caf2f48f375161d7922bef48633443))
* address PR [#19](https://github.com/calimero-network/mero-react/issues/19) third-round review ([e9cd54b](https://github.com/calimero-network/mero-react/commit/e9cd54b9535063f8346b33a4d2590725c85a4ef2))

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
