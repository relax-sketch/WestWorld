## Why

现有章节导演切拍由 AI 决定 split points / anchor，速度较慢且在批量章节中容易出现节拍长度不均、anchor 幻觉和切点不稳定。需要新增一种不破坏旧流程的生成模式：本地先稳定预切正文，AI 只补全章节和节拍元信息，并在 AI 失败时交给用户手动决定是否重试或使用本地兜底。

## What Changes

- 新增章节导演资产生成模式 `local-presplit-ai-polish`，与现有 `ai-anchor` 并存，默认仍使用 `ai-anchor`。
- 新增本地柔性预切能力，仅处理当前 `memory.content`，按拍数、搜索窗口和边界偏好生成无损 `original_text` segments。
- 新增 AI 补全流程，AI 只能补全 `chapterOutline` 和每拍摘要、入场事件、退出条件、切分理由等元信息，不得返回切点、anchor 或改写原文。
- 新增导演切拍设置页，集中配置生成方式、本地预切参数、AI 补全提示词和失败处理按钮显示策略。
- 新增 `polish_failed` 或等价待处理状态，在本地预切成功但 AI 补全失败时保留临时草稿，等待用户选择单章重试或使用本地兜底。
- 新增单章“重试 AI补全”和“使用本地兜底”操作；重试不得重新本地切拍，兜底必须由用户主动触发。
- 不修改 `splitContentIntoMemory()`，不改变现有 AI anchor 切拍默认行为。

## Capabilities

### New Capabilities

- `chapter-assets-local-presplit-ai-polish`: 章节导演资产支持本地预切正文、AI 补全元信息、用户可控失败处理和专属设置页配置。

### Modified Capabilities

- None.

## Impact

- Affected code areas:
  - `txtToWorldbook/core/constants.js`: settings 默认值和默认 AI 补全提示词。
  - `txtToWorldbook/services/processingService.js`: 章节导演资产生成路由、AI 补全、重试和本地兜底提交。
  - `txtToWorldbook/services/chapterAssetsLocalSplitService.js`: 新增本地预切和本地资产初稿构建服务。
  - `txtToWorldbook/services/promptRegistryService.js`: 内部注册导演章节资产补全提示词模块，但不暴露到通用提示词界面。
  - `txtToWorldbook/ui/*`: 新增或扩展导演切拍设置页、失败章节操作按钮和状态展示。
  - `txtToWorldbook/services/*State*` and persistence paths: 规范化新增 `chapterAssetsDraft` 和 `polish_failed` 状态。
- No new external dependencies are required.
- Existing chapter asset consumers continue to read `chapterOutline` and `chapterScript.beats`; `chapterAssetsDraft` is temporary and must not be treated as formal assets until the user confirms fallback.
