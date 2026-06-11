## 1. Settings And State

- [x] 1.1 Add default settings for `chapterAssetsMode`, local beat count, search window, boundary preference, custom polish prompt, and failure action visibility.
- [x] 1.2 Add `defaultChapterAssetsPolishPrompt` with the required JSON-only AI metadata completion instructions.
- [x] 1.3 Normalize memory chunks to tolerate `chapterAssetsDraft` and `chapterOutlineStatus = 'polish_failed'` without breaking existing pending/generating/done/failed handling.
- [x] 1.4 Ensure settings persistence reads and writes the new fields without changing existing `directorMode` semantics.

## 2. Local Pre-Split Service

- [x] 2.1 Create `txtToWorldbook/services/chapterAssetsLocalSplitService.js`.
- [x] 2.2 Implement `splitContentIntoBalancedSegments(content, options)` with theoretical cut points, configurable search window, paragraph/sentence boundary preference, hard-cut fallback, and non-empty segment validation.
- [x] 2.3 Implement exact preservation validation so joined segments must equal the original `content`.
- [x] 2.4 Implement `buildLocalPresplitAssets(content, chapterIndex, options)` to produce local outline and `chapterScript.beats` drafts with stable IDs, tags, fallback summaries, `split_rule`, `self_review`, and original text.
- [x] 2.5 Add focused unit tests for paragraph boundaries, sentence boundaries, hard-cut fallback, configurable beat counts, no empty beats, and exact text preservation.

## 3. AI Polish Flow

- [x] 3.1 Extract the current AI anchor implementation from `generateChapterAssets()` into `generateChapterAssetsAiAnchor()` without changing behavior.
- [x] 3.2 Route `generateChapterAssets()` by `AppState.settings.chapterAssetsMode || 'ai-anchor'`.
- [x] 3.3 Implement `generateChapterAssetsLocalPresplitAiPolish(index, options)` to build local drafts, compose the AI polish request, validate AI response shape, merge metadata, and write formal assets on success.
- [x] 3.4 Validate AI polish responses for matching beat count, matching IDs, allowed `split_rule.primary`, no accepted split points or anchors, and no `original_text` overwrite.
- [x] 3.5 On AI polish failure, store `memory.chapterAssetsDraft`, set `chapterOutlineStatus = 'polish_failed'`, record `chapterOutlineError`, log the failure, and avoid committing local fallback assets.
- [x] 3.6 Add tests for successful polish merge, invalid AI response failure, preserved original text, and old `ai-anchor` mode regression.

## 4. Retry And Local Fallback Actions

- [x] 4.1 Implement `retryChapterAssetsPolish(index)` using `memory.chapterAssetsDraft.localScript.beats` without re-running local pre-splitting.
- [x] 4.2 Implement `useLocalPresplitFallback(index)` to commit draft local assets, set `chapterCurrentBeatIndex = 0`, mark status done, clear error, and record source `local-presplit-only`.
- [x] 4.3 Expose retry and local fallback actions through the existing service/UI dependency wiring.
- [x] 4.4 Add tests that retry preserves draft beat boundaries, retry success writes formal assets, retry failure keeps `polish_failed`, and fallback commit requires an existing draft.

## 5. Director Cut Settings UI

- [x] 5.1 Add a dedicated director cut settings page or tab with generation mode selection.
- [x] 5.2 Add local pre-split controls for beat count, search window preset/custom value, and boundary preference.
- [x] 5.3 Add the AI polish prompt textarea with save, restore default, and copy default controls inside director cut settings.
- [x] 5.4 Ensure the polish prompt is not displayed in the general prompt editor UI.
- [x] 5.5 Add failure handling toggles for showing retry and local fallback buttons.
- [x] 5.6 Add UI load/save bindings that persist all new director cut settings.

## 6. Failed Chapter UI

- [x] 6.1 Render `polish_failed` as an actionable failure state in chapter/progress views.
- [x] 6.2 Show `重试 AI补全` and `使用本地兜底` buttons only when a draft exists and the corresponding visibility setting is enabled.
- [x] 6.3 Wire retry and fallback buttons to the service actions and refresh the chapter UI after completion.
- [x] 6.4 Keep optional `重新本地预切` out of required scope unless implementation time allows a clear single-chapter action.

## 7. Logging And Validation

- [x] 7.1 Add logs for local pre-split start/success with beat count, content length, and segment lengths.
- [x] 7.2 Add logs for AI polish start/success/failure, user-triggered retry, and user-triggered local fallback.
- [x] 7.3 Add an integration-style test or scripted fixture confirming `chapterScript.beats.map(b => b.original_text).join('') === memory.content` in the new mode.
- [x] 7.4 Run targeted tests for processing, prompt registry, settings persistence, and chapter UI behavior.
- [x] 7.5 Manually verify that `ai-anchor` remains the default and that `splitContentIntoMemory()` is unchanged.
