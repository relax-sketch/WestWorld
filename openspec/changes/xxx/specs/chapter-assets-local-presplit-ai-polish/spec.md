## ADDED Requirements

### Requirement: Chapter asset mode selection
The system SHALL support a chapter asset generation setting named `chapterAssetsMode` with at least `ai-anchor` and `local-presplit-ai-polish` values. The default value MUST be `ai-anchor`, and the `ai-anchor` mode SHALL preserve the existing AI anchor chapter cutting behavior.

#### Scenario: Upgrade keeps existing behavior
- **WHEN** a user has not changed chapter asset settings after upgrade
- **THEN** chapter asset generation uses `chapterAssetsMode = 'ai-anchor'`
- **AND** the existing AI anchor split points / anchor flow remains the selected flow

#### Scenario: User selects local pre-split polish mode
- **WHEN** the user selects `local-presplit-ai-polish` in director cut settings
- **THEN** chapter asset generation locally pre-splits the current memory chunk before calling AI for metadata polish

### Requirement: Local pre-splitting preserves source text
The system SHALL locally split only the current `memory.content` into a configurable number of non-empty beat segments. The joined `original_text` values of all generated beats MUST exactly equal the original `memory.content` with no dropped, added, reordered, or overlapping characters.

#### Scenario: Default four-beat split
- **WHEN** `chapterAssetsMode = 'local-presplit-ai-polish'`
- **AND** `chapterAssetsLocalBeatCount` is unset
- **THEN** the system generates four local beat segments when the current content can support four non-empty segments
- **AND** joining all beat `original_text` values exactly equals `memory.content`

#### Scenario: Configured beat count
- **WHEN** `chapterAssetsLocalBeatCount` is set to a value from 3 through 8
- **THEN** the local pre-splitter attempts to produce that number of non-empty segments for the current `memory.content`

#### Scenario: Natural boundary preference
- **WHEN** the local pre-splitter searches near a theoretical cut point
- **THEN** it uses the configured search window to prefer paragraph boundaries, sentence-ending punctuation, or hard cut fallback according to the configured boundary preference
- **AND** it avoids empty segments

### Requirement: Local beat draft shape
The system SHALL build local beat drafts using the existing `chapterScript.beats` shape and SHALL assign deterministic beat IDs, fallback summaries, tags, `original_text`, `split_rule`, and `self_review = 'local-presplit'`.

#### Scenario: Local draft beat metadata
- **WHEN** the local pre-splitter produces beat segments
- **THEN** each beat has an ID such as `b1`, `b2`, and `b3`
- **AND** the first beat is tagged `开场`
- **AND** middle beats are tagged `推进`
- **AND** the final beat is tagged `收束`
- **AND** each beat stores its segment in `original_text`

### Requirement: AI polish cannot control cuts or original text
The system SHALL send locally pre-split beats to AI only for metadata completion. The AI response contract MUST allow `outline` and per-beat metadata only, and MUST NOT accept AI-provided split points, anchors, changed beat count, changed beat IDs, changed order, merged beats, split beats, or `original_text` rewrites.

#### Scenario: Successful polish merge
- **WHEN** AI returns an `outline` and metadata for each local beat with matching IDs and count
- **THEN** the system merges AI metadata into the local beats
- **AND** maps `entry_event` to `entryEvent`
- **AND** maps `exit_condition` to `exitCondition`
- **AND** keeps every local `original_text` unchanged
- **AND** writes formal `memory.chapterOutline` and `memory.chapterScript`
- **AND** sets `memory.chapterOutlineStatus = 'done'`

#### Scenario: Invalid AI polish response
- **WHEN** AI returns missing beat IDs, duplicated beat IDs, reordered or extra beats, split points, anchors, or unusable metadata
- **THEN** the system treats polish as failed
- **AND** does not let AI change local beat boundaries or `original_text`

### Requirement: AI polish prompt is director cut specific
The system SHALL provide a default AI polish prompt for `local-presplit-ai-polish` and SHALL expose the editable prompt only in the director cut settings UI, not in the general prompt editor UI.

#### Scenario: Empty custom prompt uses default
- **WHEN** `customChapterAssetsPolishPrompt` is empty
- **THEN** AI polish uses the default chapter assets polish prompt

#### Scenario: Dedicated prompt editor
- **WHEN** the user opens director cut settings
- **THEN** the UI shows the AI polish prompt textarea with save, restore default, and copy default controls
- **AND** the same prompt is not shown as a general-purpose prompt in the total prompt interface

### Requirement: AI polish failure waits for user choice
The system SHALL NOT automatically save local fallback assets when AI polish fails after successful local pre-splitting. Instead, it MUST preserve the local draft and mark the chapter as waiting for user action using `polish_failed` or an equivalent failed state with actionable draft context.

#### Scenario: Polish failure preserves draft
- **WHEN** local pre-splitting succeeds
- **AND** AI polish fails
- **THEN** the system stores `memory.chapterAssetsDraft` with source, creation time, beat count, local outline, local script, and polish error
- **AND** the system does not overwrite formal `memory.chapterScript` with the local fallback
- **AND** the chapter exposes retry and local fallback actions when the corresponding settings allow them

### Requirement: Retry AI polish for a single failed chapter
The system SHALL allow the user to retry AI polishing for an individual chapter whose local draft is available. The retry MUST reuse `memory.chapterAssetsDraft.localScript.beats` and MUST NOT re-run local pre-splitting unless the user explicitly chooses a separate re-split action.

#### Scenario: Retry succeeds
- **WHEN** a chapter is in `polish_failed` state with a valid `chapterAssetsDraft`
- **AND** the user clicks `重试 AI补全`
- **AND** AI polish succeeds
- **THEN** the system writes formal `chapterOutline` and `chapterScript`
- **AND** sets `chapterOutlineStatus = 'done'`
- **AND** does not change the draft beat boundaries during the retry

#### Scenario: Retry fails again
- **WHEN** a user retries AI polish for a failed chapter
- **AND** AI polish fails again
- **THEN** the chapter remains available for retry or local fallback
- **AND** the stored local draft remains available

### Requirement: User can commit local fallback explicitly
The system SHALL allow the user to explicitly commit the local draft as formal chapter assets for a failed chapter. This action MUST set the chapter to done and mark the result as local pre-split fallback.

#### Scenario: User chooses local fallback
- **WHEN** a chapter is in `polish_failed` state with a valid `chapterAssetsDraft`
- **AND** the user clicks `使用本地兜底`
- **THEN** the system copies `chapterAssetsDraft.localScript` into formal `memory.chapterScript`
- **AND** writes a local outline or placeholder into `memory.chapterOutline`
- **AND** sets `memory.chapterCurrentBeatIndex = 0`
- **AND** sets `memory.chapterOutlineStatus = 'done'`
- **AND** records the source as `local-presplit-only`

### Requirement: Director cut settings page
The system SHALL provide a dedicated director cut settings page or tab for chapter asset generation settings. The page MUST include mode selection, local beat count, local search window, boundary preference, AI polish prompt controls, and failure action visibility toggles.

#### Scenario: Settings page shows required controls
- **WHEN** the user opens director cut settings
- **THEN** the page shows controls for `chapterAssetsMode`, `chapterAssetsLocalBeatCount`, `chapterAssetsLocalSearchWindow`, `chapterAssetsLocalBoundaryPreference`, `customChapterAssetsPolishPrompt`, `chapterAssetsShowRetryPolishButton`, and `chapterAssetsShowUseLocalFallbackButton`

#### Scenario: Failure action visibility settings
- **WHEN** `chapterAssetsShowRetryPolishButton` or `chapterAssetsShowUseLocalFallbackButton` is disabled
- **THEN** the corresponding action button is hidden in the failed chapter UI
- **AND** the system still does not auto-commit local fallback assets
