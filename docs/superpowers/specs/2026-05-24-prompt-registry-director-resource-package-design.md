# Prompt Registry And Director Resource Package Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将项目中的全部可读提示词统一纳入可编辑的注册表体系，为每个模块提供可保存、可恢复默认的 `prefix/body/suffix`，增加导演三态模式与严格的配置/工程包边界，同时保持 SillyTavern PromptManager 与 LittleWhite 注入行为兼容。

**Architecture:** 新建纯逻辑 `promptRegistryService` 作为固定默认值、覆盖值、拼装和兼容迁移的唯一入口；新建 `packagePolicyService` 集中定义提示词配置包与工程资源包的白名单/过滤规则；UI 从静态 textarea 切换为由注册表渲染的模块编辑器。完整模型请求可使用全局前后缀，PromptManager/LittleWhite 注入只渲染自身模块，永远不经过全局层或主 AI 消息链。

**Tech Stack:** JavaScript ES modules, Node.js `node:test`, existing HTML/CSS settings UI, localStorage persistence, PowerShell byte-level UTF-8/BOM verification.

---

## Implementation Constraints

- 已批准规格见 [2026-05-24-prompt-registry-director-resource-package-design.md](../specs/2026-05-24-prompt-registry-director-resource-package-design.md)；本计划实现该规格，不重新扩大范围。
- 自动验证仅使用 Node 单元/服务测试、序列化测试、接口契约测试和编码检查。手机是真实使用环境，电脑/手机 UI 交互验证由用户手工完成；本计划不安排浏览器测试。
- `txtToWorldbook/core/constants.js`、`txtToWorldbook/ui/settingsPanel.js`、`txtToWorldbook/ui/eventBindings.js` 当前为 UTF-8 with BOM。修改它们时必须保留 BOM；其他被修改文件保留其原编码形态。
- 当前工作区中用户已有的 `AGENTS.md`、`.claude/` 和删除状态文件不属于本功能。每次提交只 `git add` 本任务列出的命名文件，不批量暂存。
- `directorMode` 控制现有“每轮导演判定/注入”流程：`api`、`local-fallback`、`off`。章节资源中的“导演切拍/章节资产提取”仍是已有 AI 生成任务，因为当前代码没有可替代它的本地提取算法。
- PromptManager/LittleWhite 兼容边界不可破坏：`buildInjection()` 与 `getDirectorPromptForLittleWhiteBox()` 输出不应用 `promptGlobal.prefix`、`promptGlobal.suffix` 或主 API 消息链；标记、identifier、position 与返回结构保持协议兼容。

## File Responsibility Map

| Area | Files | Responsibility |
| --- | --- | --- |
| Prompt schema | `txtToWorldbook/core/constants.js`, new `txtToWorldbook/services/promptRegistryService.js` | Fixed defaults, module IDs, override resolution, warning calculation, rendering and legacy migration |
| Persistence/category | `txtToWorldbook/services/settingsPersistenceService.js`, `txtToWorldbook/services/categoryPersistenceService.js` | Persist new prompt configuration and migrate category guides into layered prompt values |
| Prompt UI | new `txtToWorldbook/ui/promptEditorView.js`, `txtToWorldbook/ui/settingsPanel.js`, `txtToWorldbook/ui/eventBindings.js`, `txtToWorldbook/ui/promptPreviewModal.js`, UI wiring files | Render all modules, edit/reset/save, warnings, previews, director mode controls |
| Call sites | `txtToWorldbook/services/promptService.js`, `processingService.js`, `repairService.js`, `rerollService.js`, `importMergeService.js`, `mergeWorkflowService.js`, `mergeService.js`, `txtToWorldbook/ui/chapterExperienceView.js` | Route every AI instruction/wrapper through registry rendering |
| Director compatibility | `txtToWorldbook/services/directorService.js`, `txtToWorldbook/services/directorInjectionService.js`, `txtToWorldbook/index.js` | Three-state execution, editable local fallback modules, preserved injection contract |
| Package boundaries | new `txtToWorldbook/services/packagePolicyService.js`, `importExportService.js`, `taskStateService.js`, `infra/memoryHistoryDB.js`, feature wiring | Export/import prompt config without API; save/load engineering resources without prompts/API |
| Verification/docs | `tests/*.test.js`, `README.md`, `westworld.md` | Regression tests, user-visible documentation, encoding audit |

## Task 1: Add The Prompt Registry Core And Settings Schema

**Status:** Completed (`43c3797`)

**Files:**
- Modify: `txtToWorldbook/core/constants.js`
- Create: `txtToWorldbook/services/promptRegistryService.js`
- Modify: `txtToWorldbook/app/createCoreServices.js`
- Modify: `txtToWorldbook/main.js`
- Create: `tests/promptRegistryService.test.js`

- [x] Before editing, record the current BOM state of `txtToWorldbook/core/constants.js` and confirm it is UTF-8 with BOM.
- [x] Add failing tests for immutable defaults, explicit empty overrides, global composition, no-global module rendering, restore-default behavior, and missing-placeholder warnings.
- [x] Add new settings defaults without deleting existing legacy fields yet:

```js
promptConfigVersion: 1,
promptGlobal: {
  prefix: '',
  suffix: '',
},
promptOverrides: {},
directorMode: 'api',
directorFallbackOnError: true,
```

- [x] Define stable module identifiers and fixed baseline content derived from the existing prompt literals/default constants:

```js
export const PROMPT_MODULE_IDS = Object.freeze({
  LANGUAGE_ZH: 'common.language.zh',
  WORLDBOOK_SYSTEM: 'worldbook.system',
  WORLDBOOK_PLOT: 'worldbook.plot',
  WORLDBOOK_STYLE: 'worldbook.style',
  WORLDBOOK_PREVIOUS_CONTEXT: 'worldbook.previous-context',
  WORLDBOOK_RELEVANT_CONTEXT: 'worldbook.relevant-context',
  WORLDBOOK_FORCE_CHAPTER: 'worldbook.force-chapter',
  WORLDBOOK_PARALLEL_REQUEST: 'worldbook.extract.parallel',
  WORLDBOOK_SERIAL_REQUEST: 'worldbook.extract.serial',
  WORLDBOOK_REROLL_EXTRA: 'worldbook.reroll.extra',
  WORLDBOOK_REPAIR: 'worldbook.repair',
  WORLDBOOK_SINGLE_REROLL: 'worldbook.reroll.single-entry',
  MERGE_IMPORTED: 'merge.imported-entry',
  MERGE_CONSOLIDATE: 'merge.consolidate',
  MERGE_CONSOLIDATE_RULES: 'merge.consolidate.rules',
  MERGE_ALIAS: 'merge.alias',
  DIRECTOR_CHAPTER_ASSETS: 'director.chapter-assets',
  DIRECTOR_ENTRY_EVENTS: 'director.entry-events',
  DIRECTOR_FRAMEWORK: 'director.framework',
  DIRECTOR_INJECTION: 'director.injection',
  DIRECTOR_FALLBACK_NEW_BEAT: 'director.fallback.new-beat',
  DIRECTOR_FALLBACK_IN_BEAT: 'director.fallback.in-beat',
  DIRECTOR_FALLBACK_END: 'director.fallback.end',
  CHAPTER_OPENING: 'chapter.opening',
});
```

- [x] Implement a pure service API whose default definitions are never written back as editable defaults:

```js
listModules()
getResolvedModule(id)
setOverride(id, layers)
resetOverride(id)
renderModule(id, variables = {})
composeRequest(moduleIds, variablesById = {}, { includeGlobal = true } = {})
getWarnings(id, layers = getResolvedModule(id))
migrateLegacySettings(settings)
```

- [x] Resolve overrides using property presence, not truthiness, so `{ body: '' }` remains an intentional saved value and produces warnings instead of silently restoring a default.
- [x] Ensure `composeRequest()` appends the Chinese language module when appropriate, applies `promptGlobal.prefix` and `promptGlobal.suffix` exactly once, and supports `{ includeGlobal: false }` for injection-only rendering.
- [x] Wire the new pure service through core creation/main dependency injection without migrating call sites in this task.
- [x] Re-run tests and verify the BOM state of `constants.js` remains unchanged.

**Test command:**

```powershell
npm test -- --test-name-pattern="prompt registry"
```

**Expected result:** New prompt registry tests pass; existing tests continue to load modules without syntax/import failures.

**Commit:**

```powershell
git add txtToWorldbook/core/constants.js txtToWorldbook/services/promptRegistryService.js txtToWorldbook/app/createCoreServices.js txtToWorldbook/main.js tests/promptRegistryService.test.js
git commit -m "feat: add layered prompt registry core"
```

## Task 2: Migrate Legacy Prompt Settings And Category Prompt Layers

**Status:** Completed (`c3e90ee`)

**Files:**
- Modify: `txtToWorldbook/services/settingsPersistenceService.js`
- Modify: `txtToWorldbook/services/categoryPersistenceService.js`
- Modify: `tests/promptRegistryService.test.js`
- Create: `tests/categoryPersistenceService.test.js`

- [x] Add failing tests that migrate legacy `custom*Prompt`, existing director suffixes, shared prefix selection, and existing `contentGuide` values without losing user content.
- [x] Make local settings load call `migrateLegacySettings()` once when `promptConfigVersion` is absent or older, retaining local API values in localStorage.
- [x] Map existing editable defaults into the new modules, including existing director suffix settings; retain legacy read compatibility only as needed for migration.
- [x] Upgrade category prompt state to layered values:

```js
promptLayers: {
  prefix: '',
  body: existingContentGuide,
  suffix: '',
}
```

- [x] For built-in categories, use the existing `DEFAULT_WORLDBOOK_CATEGORIES[].contentGuide` as the immutable body baseline; for user-created categories, create the initial baseline from the current generated body text and keep later user edits as overrides.
- [x] Update `generateDynamicJsonTemplate()` to render each category's layered content, while preserving non-prompt structural fields used to build the output JSON shape.
- [x] Confirm warning-only validation allows blank category body or missing runtime placeholders to be saved.

**Test command:**

```powershell
node --test tests/promptRegistryService.test.js tests/categoryPersistenceService.test.js
```

**Expected result:** Legacy prompt values and category content migrate into layered overrides; empty saved values are retained; generated templates use rendered category prompt content.

**Commit:**

```powershell
git add txtToWorldbook/services/settingsPersistenceService.js txtToWorldbook/services/categoryPersistenceService.js tests/promptRegistryService.test.js tests/categoryPersistenceService.test.js
git commit -m "feat: migrate prompt settings and category layers"
```

## Task 3: Build The Registry-Driven Prompt Editor And Preview

**Status:** Completed (`0fcee71`)

**Files:**
- Create: `txtToWorldbook/ui/promptEditorView.js`
- Modify: `txtToWorldbook/ui/settingsPanel.js`
- Modify: `txtToWorldbook/ui/eventBindings.js`
- Modify: `txtToWorldbook/ui/promptPreviewModal.js`
- Modify: `txtToWorldbook/ui/createUiHelpers.js`
- Modify: `txtToWorldbook/main.js`

- [x] Before editing, record and later preserve BOM for `settingsPanel.js` and `eventBindings.js`.
- [x] Replace the hard-coded prompt textarea list with a registry host and a new view that enumerates every registered module, including category modules and local fallback modules.
- [x] Provide editable and savable `prefix`, `body`, and `suffix` inputs for every prompt module; render global prefix/global suffix separately above module cards.
- [x] Add per-module “恢复默认” actions that call `resetOverride(id)` and restore the immutable project default rather than rewriting the baseline.
- [x] Display warnings beside a module when required placeholders are absent or a module is blank; do not block save.
- [x] Keep prompt preset and message-chain editing exposed as prompt configuration, and add director controls:

```html
<select id="ttw-director-mode">
  <option value="api">导演 API</option>
  <option value="local-fallback">本地兜底</option>
  <option value="off">关闭导演</option>
</select>
<input type="checkbox" id="ttw-director-fallback-on-error">
```

- [x] Update preview to show composed global layers for complete requests and an explicit injection preview labeled as not using global layers.
- [x] Wire view events through existing UI helpers and settings persistence; avoid duplicating registry logic inside DOM handlers.
- [x] Do not add automated browser/UI tests; perform only import/syntax loading through Node in this task.

**Verification commands:**

```powershell
node --check txtToWorldbook/ui/promptEditorView.js
node --check txtToWorldbook/ui/settingsPanel.js
node --check txtToWorldbook/ui/eventBindings.js
node --check txtToWorldbook/ui/promptPreviewModal.js
```

**Expected result:** All four modules parse successfully; BOM checks show `settingsPanel.js` and `eventBindings.js` retain UTF-8 BOM.

**Commit:**

```powershell
git add txtToWorldbook/ui/promptEditorView.js txtToWorldbook/ui/settingsPanel.js txtToWorldbook/ui/eventBindings.js txtToWorldbook/ui/promptPreviewModal.js txtToWorldbook/ui/createUiHelpers.js txtToWorldbook/main.js
git commit -m "feat: expose registry based prompt editor"
```

## Task 4: Route Non-Director Prompt Call Sites Through The Registry

**Status:** Completed (`b9b1e1b`)

**Files:**
- Modify: `txtToWorldbook/services/promptService.js`
- Modify: `txtToWorldbook/services/processingService.js`
- Modify: `txtToWorldbook/services/repairService.js`
- Modify: `txtToWorldbook/services/rerollService.js`
- Modify: `txtToWorldbook/services/importMergeService.js`
- Modify: `txtToWorldbook/services/mergeWorkflowService.js`
- Modify: `txtToWorldbook/services/mergeService.js`
- Modify: `txtToWorldbook/ui/chapterExperienceView.js`
- Create: `tests/promptCompositionCallSites.test.js`

- [x] Write failing service-level tests for representative worldbook, repair, reroll, consolidate, alias merge, imported merge, and chapter-opening requests. Assert each rendered module can contribute prefix/body/suffix and each complete outbound request sees the global layer once.
- [x] Change `promptService` to use registry rendering for language, system, plot, style, previous-memory context, relevant-worldbook context, and force-chapter text while retaining existing main-only message-chain behavior.
- [x] Replace inline instructions/wrappers in `processingService` with registry modules for parallel/serial extraction, relevant context, reroll extra constraints, chapter assets, and entry-event refinement.
- [x] Replace inline repair and reroll prompt fragments with `WORLDBOOK_REPAIR` and `WORLDBOOK_SINGLE_REROLL` rendering.
- [x] Route imported merge, consolidate body/rules, and alias merge through `MERGE_IMPORTED`, `MERGE_CONSOLIDATE`, `MERGE_CONSOLIDATE_RULES`, and `MERGE_ALIAS`.
- [x] Route the chapter opening instruction through `CHAPTER_OPENING` instead of a local inline string.
- [x] Search prompt-bearing code after conversion and either map any remaining user-visible instruction string into a module or document why it is protocol metadata/runtime data and not editable prompt content.

**Audit note:** Remaining prompt-bearing director composition is isolated to `directorService.js` for Task 5; prompt package serialization is isolated to `importExportService.js` for Task 6. Other remaining search matches are category compatibility/baseline storage, UI text, logging, error messages, or validation text rather than outbound editable prompt content.

**Search command:**

```powershell
rg -n "请|输出|必须|任务|prompt|Prompt|contentGuide|custom[A-Z].*Prompt" txtToWorldbook/services txtToWorldbook/ui txtToWorldbook/index.js
```

**Test command:**

```powershell
node --test tests/promptRegistryService.test.js tests/promptCompositionCallSites.test.js
```

**Expected result:** Service-level requests render editable module layers and apply global layers exactly once; remaining matching strings are defaults, runtime values, UI labels, or documented non-editable protocol metadata.

**Commit:**

```powershell
git add txtToWorldbook/services/promptService.js txtToWorldbook/services/processingService.js txtToWorldbook/services/repairService.js txtToWorldbook/services/rerollService.js txtToWorldbook/services/importMergeService.js txtToWorldbook/services/mergeWorkflowService.js txtToWorldbook/services/mergeService.js txtToWorldbook/ui/chapterExperienceView.js tests/promptCompositionCallSites.test.js
git commit -m "feat: compose all non director prompts from registry"
```

## Task 5: Implement Director Three-State Behavior And Preserve Injection Compatibility

**Status:** Completed (`7606845`)

**Files:**
- Modify: `txtToWorldbook/services/directorService.js`
- Modify: `txtToWorldbook/services/directorInjectionService.js` only if dependency wiring or testability requires it; do not change protocol constants
- Modify: `txtToWorldbook/index.js`
- Modify: `txtToWorldbook/ui/eventBindings.js`
- Modify: `txtToWorldbook/ui/settingsPanel.js`
- Modify: `tests/directorGateService.test.js`
- Modify: `tests/directorInjectionService.test.js`
- Modify: `tests/directorPromptManagerService.test.js`
- Create: `tests/directorModeService.test.js`

- [x] Add failing tests for each mode:

```js
directorMode: 'api'            // calls director API; may fall back only when toggle is true
directorMode: 'local-fallback' // does not call director API; builds editable local decision
directorMode: 'off'            // returns a skip status and removes/avoids injection
```

- [x] Add tests that `directorFallbackOnError: false` does not silently generate a local injection after API error or parse failure.
- [x] Compose `DIRECTOR_FRAMEWORK` as a complete director API request with the global layer once.
- [x] Render `DIRECTOR_FALLBACK_NEW_BEAT`, `DIRECTOR_FALLBACK_IN_BEAT`, and `DIRECTOR_FALLBACK_END` as editable local fallback content selected by existing decision context.
- [x] Render `DIRECTOR_INJECTION` with module-specific prefix/body/suffix only:

```js
const content = promptRegistryService.renderModule(
  PROMPT_MODULE_IDS.DIRECTOR_INJECTION,
  variables
);
```

- [x] Preserve `getDirectorPromptForLittleWhiteBox()` return shape and the existing PromptManager identifier/position/depth behavior. Assert in tests that global prefix/global suffix and main message-chain text do not appear in injection content.
- [x] Update `index.js` preparation logic so `off` or API-error-with-fallback-disabled clears/respects skipped injection instead of calling an unconditional local fallback accessor.
- [x] Keep `DIRECTOR_INJECTION_MARKER` and `DIRECTOR_INJECTION_IDENTIFIER` fixed protocol metadata; do not expose them in the prompt editor.
- [x] Retain the per-turn director meaning of the mode selector; do not reroute the chapter-assets extraction task to local fallback.
- [x] Recheck BOM after the two UI file edits in this task.

**Audit note:** The mode controls were already introduced during Task 3, so Task 5 reused them without rewriting the UI files and rechecked that `settingsPanel.js` and `eventBindings.js` remain strict UTF-8 with BOM. Director context, normalization, local fallback, and actor-injection guidance fragments that enter model-visible content are now registry modules; resource-state beat normalization remains outside prompt configuration.

**Test command:**

```powershell
node --test tests/directorGateService.test.js tests/directorInjectionService.test.js tests/directorPromptManagerService.test.js tests/directorModeService.test.js
```

**Expected result:** All director modes behave distinctly; API fallback honors its toggle; PromptManager/LittleWhite injection schema remains compatible and contains no global prompt layers.

**Commit:**

```powershell
git add txtToWorldbook/services/directorService.js txtToWorldbook/services/directorInjectionService.js txtToWorldbook/index.js txtToWorldbook/ui/eventBindings.js txtToWorldbook/ui/settingsPanel.js tests/directorGateService.test.js tests/directorInjectionService.test.js tests/directorPromptManagerService.test.js tests/directorModeService.test.js
git commit -m "feat: add director modes without altering injection contract"
```

## Task 6: Separate Prompt Configuration Packages From Engineering Resource Packages

**Status:** Completed (`7cbd6ee`)

**Files:**
- Create: `txtToWorldbook/services/packagePolicyService.js`
- Modify: `txtToWorldbook/services/importExportService.js`
- Modify: `txtToWorldbook/services/taskStateService.js`
- Modify: `txtToWorldbook/infra/memoryHistoryDB.js`
- Modify: `txtToWorldbook/app/createFeatureServices.js`
- Modify: `txtToWorldbook/main.js`
- Create: `tests/packagePolicyService.test.js`
- Create: `tests/taskStatePackagePolicy.test.js`

- [x] Add failing tests proving prompt config export includes editable prompt material but excludes API fields:

```js
{
  promptConfigVersion,
  promptGlobal,
  promptOverrides,
  promptPrefixPresets,
  selectedPromptPrefixPreset,
  promptMessageChain,
  categoryPromptLayers
}
```

- [x] Add failing tests proving engineering/task export retains resources and result-reproduction parameters but excludes `mainApi`, `directorApi`, keys, route presets, prompt settings, category prompt text, and message chain.
- [x] Implement pure policy functions with explicit whitelists rather than cloning `AppState.settings`:

```js
buildPromptConfigPackage(state)
applyPromptConfigPackage(state, payload)
buildResourcePackage(state)
applyResourcePackage(state, payload)
filterLegacyPromptImport(payload)
filterLegacyResourceImport(payload)
```

- [x] Make prompt configuration import/export preserve local API provider/address/model/key and route preset settings unchanged, including when importing older full-settings files.
- [x] Make task/project package load avoid restoring any API or editable prompt values from both new and legacy payloads.
- [x] Strip category `contentGuide` and `promptLayers` from engineering packages while keeping category identity/output-structure data required to interpret stored processing results.
- [x] Update memory snapshot restoration so old `savedState.settings` cannot overwrite local API or prompt configuration during result-history recovery.
- [x] Pass the policy dependency through feature creation/main wiring.

**Audit note:** The engineering-package whitelist also removes category prompt examples, cached `directorLastInjectionPrompt`, and director diagnostic prompt previews; it retains director decisions, chapter beats, generated worldbooks, and resume parameters. `memoryHistoryDB.js` already writes snapshots without `settings`, so the legacy `savedState.settings` protection was correctly implemented at its restoration boundary in `taskStateService.js` rather than adding unrelated storage churn.

**Test command:**

```powershell
node --test tests/packagePolicyService.test.js tests/taskStatePackagePolicy.test.js
```

**Expected result:** Prompt configuration round-trips independently of API settings; engineering/resource round-trips retain outputs and resume metadata but never carry editable prompt or API data.

**Commit:**

```powershell
git add txtToWorldbook/services/packagePolicyService.js txtToWorldbook/services/importExportService.js txtToWorldbook/services/taskStateService.js txtToWorldbook/infra/memoryHistoryDB.js txtToWorldbook/app/createFeatureServices.js txtToWorldbook/main.js tests/packagePolicyService.test.js tests/taskStatePackagePolicy.test.js
git commit -m "feat: split prompt configuration from resource packages"
```

## Task 7: Document Behavior, Audit Encoding, And Run Final Verification

**Files:**
- Modify: `README.md`
- Modify: `westworld.md`
- Modify: any already-created test file only if a failing verification exposes a missing assertion

- [ ] Document that every prompt module exposes editable prefix/body/suffix, warning-only placeholder validation, immutable restore-default baselines, and global prefix/suffix behavior.
- [ ] Document director modes, including the separate API-error fallback toggle and the fact that PromptManager/LittleWhite injection does not consume global layers.
- [ ] Document export boundaries: prompt configuration package contains prompt editing data but no API; engineering resource package contains processing/director outputs and resume parameters but no prompt/API configuration.
- [ ] Document that UI interaction acceptance is manually performed on the user's mobile/desktop environment; do not add browser automation to verification.
- [ ] Run the complete Node test suite:

```powershell
npm test
```

**Expected result:** The Node test process exits successfully with no failed tests.

- [ ] Verify all touched Chinese/prompt-bearing files decode as strict UTF-8 and ensure the three original BOM files remain BOM-prefixed:

```powershell
$files = @(
  'txtToWorldbook/core/constants.js',
  'txtToWorldbook/ui/settingsPanel.js',
  'txtToWorldbook/ui/eventBindings.js',
  'txtToWorldbook/services/promptRegistryService.js',
  'txtToWorldbook/services/directorService.js',
  'txtToWorldbook/services/packagePolicyService.js',
  'README.md',
  'westworld.md'
)
$strictUtf8 = [System.Text.UTF8Encoding]::new($false, $true)
foreach ($file in $files) {
  $bytes = [System.IO.File]::ReadAllBytes((Resolve-Path $file))
  $null = $strictUtf8.GetString($bytes)
  $hasBom = $bytes.Length -ge 3 -and $bytes[0] -eq 0xEF -and $bytes[1] -eq 0xBB -and $bytes[2] -eq 0xBF
  Write-Output "$file UTF8=true BOM=$hasBom"
}
```

**Expected result:** Every listed file reports `UTF8=true`; `constants.js`, `settingsPanel.js`, and `eventBindings.js` report `BOM=True`, unless a separately approved encoding change supersedes this plan.

- [ ] Inspect the worktree and stage only documentation/tests changed by this final task; leave `AGENTS.md`, `.claude/`, and unrelated deletions untouched.

**Commit:**

```powershell
git add README.md westworld.md
git commit -m "docs: explain prompt registry and package boundaries"
```

## Final Completion Checklist

- [ ] Every AI-readable instruction and editable director injection fragment is represented by a registered module or an explicit category prompt layer.
- [ ] Every module exposes savable `prefix/body/suffix`, warning-only validation, and immutable restore-default behavior.
- [ ] Global prefix/suffix apply exactly once to complete outbound model requests and never apply to PromptManager/LittleWhite injection.
- [ ] Director `api`, `local-fallback`, and `off` modes work, and API failure fallback is independently selectable.
- [ ] Prompt configuration export/import excludes API fields; engineering resource packages exclude API and editable prompt configuration.
- [ ] Existing resource payloads retain data needed to interpret or resume processed director/worldbook results.
- [ ] Node tests pass and encoding/BOM checks pass.
- [ ] UI behavior is handed to the user for manual validation in the actual mobile/desktop environment, with no browser automation claimed.
