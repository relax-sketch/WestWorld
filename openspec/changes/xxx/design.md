## Context

The project already has a chapter asset generation flow in `processingService.generateChapterAssets()` that sends current memory chunk content to AI, receives split points / anchors, locally slices `original_text`, and writes `chapterOutline` plus `chapterScript.beats`. This works as the default AI semantic cutting path, but it is slower and can produce unstable cut lengths or hallucinated anchors during bulk processing.

The requested change adds a second chapter asset mode. It must not alter `splitContentIntoMemory()` and must not change the default user experience after upgrade. The new mode moves cut-point authority to local code while keeping AI responsible for narrative metadata.

## Goals / Non-Goals

**Goals:**

- Preserve the existing AI anchor flow as `chapterAssetsMode: 'ai-anchor'` and keep it as the default.
- Add `chapterAssetsMode: 'local-presplit-ai-polish'` for local pre-splitting followed by AI metadata polishing.
- Guarantee local segments concatenate exactly to `memory.content`.
- Ensure AI cannot decide cut count, cut locations, merge/split beats, return anchors, return split points, or rewrite `original_text`.
- Keep failed AI polishing user-controlled by storing a draft and exposing retry/fallback actions.
- Add a dedicated director cut settings UI for generation mode, pre-split parameters, polish prompt, and failure action visibility.

**Non-Goals:**

- Do not replace or remove existing AI anchor cutting.
- Do not modify the import-time memory chunking behavior in `splitContentIntoMemory()`.
- Do not implement batch re-splitting as a required first version feature.
- Do not expose the local pre-split AI polish prompt in the general prompt editor UI.

## Decisions

1. Use a separate `chapterAssetsMode` setting instead of extending `directorMode`.

   `directorMode` controls whether the director runs before chat and whether it calls the director API. Chapter asset generation is a different workflow that produces `chapterOutline` and `chapterScript.beats`. A separate mode prevents existing chat director behavior from accidentally changing when users experiment with chapter asset generation.

   Alternative considered: overload `directorMode`. Rejected because it would mix runtime chat director behavior with chapter asset generation behavior.

2. Route `generateChapterAssets()` by mode and extract the current implementation.

   `generateChapterAssets()` remains the public entry point. It should read `AppState.settings.chapterAssetsMode || 'ai-anchor'`, call `generateChapterAssetsLocalPresplitAiPolish()` for the new mode, and otherwise call an extracted `generateChapterAssetsAiAnchor()` containing the current behavior.

   Alternative considered: add a separate top-level button action only for the new mode. Rejected because bulk processing and existing callers already depend on `generateChapterAssets()`.

3. Implement local splitting in a pure service.

   Add `txtToWorldbook/services/chapterAssetsLocalSplitService.js` with:

   - `splitContentIntoBalancedSegments(content, options)`
   - `buildLocalPresplitAssets(content, chapterIndex, options)`

   The splitter should compute theoretical cut points, search around each point for natural boundaries, and fall back to hard cuts only when necessary. It must preserve every character exactly, avoid empty beats, and validate by joining all segments back to the original content.

   Alternative considered: implement the splitter inline in `processingService.js`. Rejected because the split algorithm needs focused tests and should stay independent from AI/persistence side effects.

4. Treat AI polishing as metadata merge only.

   The AI request includes title, previous outline, and the locally pre-split beat original texts. The expected response contains only `outline` and per-beat metadata keyed by existing beat IDs. Merge logic maps `entry_event` to `entryEvent` and `exit_condition` to `exitCondition`, validates beat count and IDs, and keeps local `original_text` unchanged.

   Alternative considered: allow AI to return `original_text` and compare it. Rejected because the contract is simpler and safer if the field is forbidden entirely.

5. Store failed polish output as a temporary draft, not formal assets.

   When local pre-split succeeds but AI polish fails, set a waiting state such as `chapterOutlineStatus = 'polish_failed'`, store `memory.chapterAssetsDraft`, and avoid overwriting formal `chapterOutline` / `chapterScript` with fallback data. The draft contains `localScript.beats`, `localOutline`, source metadata, and the polish error.

   Alternative considered: auto-save local fallback on polish failure. Rejected because the PRD explicitly requires users to choose retry or fallback.

6. Keep retry stable by reusing draft beats.

   `retryChapterAssetsPolish(index)` must read `memory.chapterAssetsDraft.localScript.beats` and re-run only AI polishing. It must not re-run local splitting unless the user explicitly chooses a future "re-split" action.

   Alternative considered: re-split on every retry to pick up setting changes. Rejected because retries should not change segment boundaries unexpectedly.

7. Register the polish prompt internally but render it only in director cut settings.

   `promptRegistryService` can own the default module, e.g. `director.chapter-assets-polish`, so prompt rendering remains centralized. The general prompt editor must filter or omit this module, while the director cut settings UI reads and saves `customChapterAssetsPolishPrompt` or the dedicated override path.

   Alternative considered: hard-code the prompt in `processingService.js`. Rejected because existing project guidance centralizes model instructions in the prompt registry.

## Risks / Trade-offs

- [Risk] Boundary search can still hard-cut inside a sentence when no natural boundary is available within the configured window. → Mitigate by logging lengths and preserving exact text; expose search window and boundary preference settings.
- [Risk] AI returns missing, duplicated, or reordered beat IDs. → Mitigate by validating count and IDs before merging; keep draft and mark polish as failed.
- [Risk] UI settings for `sentence-first` or `balanced` may imply more sophistication than implemented. → Mitigate by implementing simple candidate priority changes for all three values or clearly marking unsupported behavior in the UI copy.
- [Risk] Existing code may assume chapter statuses are only `pending`, `generating`, `done`, or `failed`. → Mitigate by normalizing and displaying `polish_failed` wherever status tags or progress cards are rendered.
- [Risk] Prompt registry exposure could place the polish prompt in the wrong UI. → Mitigate by testing the general prompt editor list and the dedicated director cut settings page separately.

## Migration Plan

1. Add new settings with defaults that preserve old behavior:
   - `chapterAssetsMode: 'ai-anchor'`
   - `chapterAssetsLocalBeatCount: 4`
   - `chapterAssetsLocalSearchWindow: 500`
   - `chapterAssetsLocalBoundaryPreference: 'paragraph-first'`
   - `customChapterAssetsPolishPrompt: ''`
   - `chapterAssetsShowRetryPolishButton: true`
   - `chapterAssetsShowUseLocalFallbackButton: true`
2. Normalize existing memory chunks with `chapterAssetsDraft: null` only when needed; do not rewrite imported content.
3. Keep rollback simple: set `chapterAssetsMode` to `ai-anchor` to use the existing flow.

## Open Questions

- Whether `chapterAssetsDraft` should be cleared after successful AI retry or retained for debug; the default implementation should clear it to avoid stale UI state.
- Whether a first version includes the optional "重新本地预切" button. The required scope is retry AI polish and use local fallback; re-split can be added later without blocking this change.
