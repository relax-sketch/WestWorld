## 1. Settings And State

- [ ] 1.1 Add default settings for `chapterAssetsMode`, local beat count, search window, boundary preference, custom polish prompt, and failure action visibility.
- [ ] 1.2 Add `defaultChapterAssetsPolishPrompt` with the required JSON-only AI metadata completion instructions.
- [ ] 1.3 Normalize memory chunks to tolerate `chapterAssetsDraft` and `chapterOutlineStatus = 'polish_failed'` without breaking existing pending/generating/done/failed handling.
- [ ] 1.4 Ensure settings persistence reads and writes the new fields without changing existing `directorMode` semantics.

## 2. Local Pre-Split Service

- [ ] 2.1 Create `txtToWorldbook/services/chapterAssetsLocalSplitService.js`.
- [ ] 2.2 Implement `splitContentIntoBalancedSegments(content, options)` with theoretical cut points, configurable search window, paragraph/sentence boundary preference, hard-cut fallback, and non-empty segment validation.
- [ ] 2.3 Implement exact preservation validation so joined segments must equal the original `content`.
- [ ] 2.4 Implement `buildLocalPresplitAssets(content, chapterIndex, options)` to produce local outline and `chapterScript.beats` drafts with stable IDs, tags, fallback summaries, `split_rule`, `self_review`, and original text.
- [ ] 2.5 Add focused unit tests for paragraph boundaries, sentence boundaries, hard-cut fallback, configurable beat counts, no empty beats, and exact text preservation.

## 3. AI Polish Flow

- [ ] 3.1 Extract the current AI anchor implementation from `generateChapterAssets()` into `generateChapterAssetsAiAnchor()` without changing behavior.
- [ ] 3.2 Route `generateChapterAssets()` by `AppState.settings.chapterAssetsMode || 'ai-anchor'`.
- [ ] 3.3 Implement `generateChapterAssetsLocalPresplitAiPolish(index, options)` to build local drafts, compose the AI polish request, validate AI response shape, merge metadata, and write formal assets on success.
- [ ] 3.4 Validate AI polish responses for matching beat count, matching IDs, allowed `split_rule.primary`, no accepted split points or anchors, and no `original_text` overwrite.
- [ ] 3.5 On AI polish failure, store `memory.chapterAssetsDraft`, set `chapterOutlineStatus = 'polish_failed'`, record `chapterOutlineError`, log the failure, and avoid committing local fallback assets.
- [ ] 3.6 Add tests for successful polish merge, invalid AI response failure, preserved original text, and old `ai-anchor` mode regression.

## 4. Retry And Local Fallback Actions

- [ ] 4.1 Implement `retryChapterAssetsPolish(index)` using `memory.chapterAssetsDraft.localScript.beats` without re-running local pre-splitting.
- [ ] 4.2 Implement `useLocalPresplitFallback(index)` to commit draft local assets, set `chapterCurrentBeatIndex = 0`, mark status done, clear error, and record source `local-presplit-only`.
- [ ] 4.3 Expose retry and local fallback actions through the existing service/UI dependency wiring.
- [ ] 4.4 Add tests that retry preserves draft beat boundaries, retry success writes formal assets, retry failure keeps `polish_failed`, and fallback commit requires an existing draft.

## 5. Director Cut Settings UI

- [ ] 5.1 Add a dedicated director cut settings page or tab with generation mode selection.
- [ ] 5.2 Add local pre-split controls for beat count, search window preset/custom value, and boundary preference.
- [ ] 5.3 Add the AI polish prompt textarea with save, restore default, and copy default controls inside director cut settings.
- [ ] 5.4 Ensure the polish prompt is not displayed in the general prompt editor UI.
- [ ] 5.5 Add failure handling toggles for showing retry and local fallback buttons.
- [ ] 5.6 Add UI load/save bindings that persist all new director cut settings.

## 6. Failed Chapter UI

- [ ] 6.1 Render `polish_failed` as an actionable failure state in chapter/progress views.
- [ ] 6.2 Show `重试 AI补全` and `使用本地兜底` buttons only when a draft exists and the corresponding visibility setting is enabled.
- [ ] 6.3 Wire retry and fallback buttons to the service actions and refresh the chapter UI after completion.
- [ ] 6.4 Keep optional `重新本地预切` out of required scope unless implementation time allows a clear single-chapter action.

## 7. Logging And Validation

- [ ] 7.1 Add logs for local pre-split start/success with beat count, content length, and segment lengths.
- [ ] 7.2 Add logs for AI polish start/success/failure, user-triggered retry, and user-triggered local fallback.
- [ ] 7.3 Add an integration-style test or scripted fixture confirming `chapterScript.beats.map(b => b.original_text).join('') === memory.content` in the new mode.
- [ ] 7.4 Run targeted tests for processing, prompt registry, settings persistence, and chapter UI behavior.
- [ ] 7.5 Manually verify that `ai-anchor` remains the default and that `splitContentIntoMemory()` is unchanged.
