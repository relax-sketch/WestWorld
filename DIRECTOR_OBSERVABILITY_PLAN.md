# WestWorld 导演运行可观测性改造计划

记录日期：2026-05-07

## 背景

WestWorld 当前的 TXT 切拍、导演切拍资产生成、角色卡/世界书生成基本可用，主要不稳定点在“已经生成好的导演切拍是否在每次 SillyTavern 对话生成前被正确使用”。现有问题不是单纯生成失败，而是用户很难判断以下事实：

- 插件是否成功注册到 SillyTavern 的生成事件。
- 本轮生成是否触发了导演判定。
- 触发后是否因为门控条件被跳过。
- 导演 API 是否调用成功，或是否启用了本地 fallback。
- 生成出的导演执行单是否已经真实植入 `eventData.chat`。
- 当前对话正在使用哪个章节、哪个 beat、哪条执行单。
- 出错时应看哪里、测什么、如何复现。

本计划只聚焦“对话中使用已生成导演切拍”的可观测性与可测试性，尽量不改动现有切拍生成和角色卡生成行为。

## 当前链路判断

关键文件与职责：

- `index.js`
  - `directorPromptGate` 保存前端事件门控状态。
  - `registerDirectorPromptHook()` 注册 `MESSAGE_SENT`、`GENERATION_STARTED`、`CHAT_COMPLETION_PROMPT_READY`。
  - `getDirectorSkipReason()` 判断 quiet/background/dryRun/无近期用户输入等跳过条件。
  - 当前只有 localStorage debug 开关下的 `console.debug`，没有统一状态快照。

- `txtToWorldbook/services/directorService.js`
  - `runDirectorBeforeGeneration(eventData)` 是本轮导演判定主入口。
  - 读取 `AppState.experience.currentChapterIndex` 和 `AppState.memory.queue[chapterIndex]`。
  - 通过 `ensureChapterBeats(memory)` 取当前章节 beats。
  - 调用导演 API 或 fallback，写入 `memory.directorDecision`、`AppState.experience.directorLastDecision`。
  - 最后 `stripExistingDirectorInjection(eventData.chat)`，再 `eventData.chat.unshift({ role: 'system', content: injection, ... is_westworld_director: true })`。
  - 当前没有把“注入前/注入后/注入是否存在/注入内容摘要/注入 id”作为稳定状态暴露。

- `txtToWorldbook/core/state.js`
  - `experience` 已有 `directorLastDecision` / `directorLastDecisionAt`。
  - 尚缺运行态状态机、最后一次注入结果、最后一次跳过原因、最后一次 hook 事件信息。

- `txtToWorldbook/core/logger.js`
  - 有简单 console logger。
  - 尚缺可查询的 ring buffer 日志与分级过滤。

- `txtToWorldbook/app/publicApi.js`
  - 已暴露大量 API。
  - 尚缺 `getDirectorRuntimeStatus()`、`getDirectorLogs()`、`testDirectorInjection()` 等诊断 API。

## 目标

改造后，用户和开发者应能明确看到：

- **显式状态标志**：插件已加载、hook 已注册、最近一次事件、当前是否运行、最近一次结果。
- **显式跳过原因**：每次未运行都能看到 reason，而不是“无事发生”。
- **显式注入确认**：本轮是否已经植入对话，植入位置、消息 role、内容长度、内容摘要、marker 是否存在。
- **显式日志**：UI 与 console 均能看到结构化运行日志。
- **能测试**：不依赖真实聊天也能构造 fake `eventData.chat` 验证门控、决策、注入。
- **可交接**：中途更换模型时，可按本文件继续实施。

## 拟议架构

### 1. 新增 Director Runtime 状态模型

在 `AppState.experience` 下新增 `directorRuntime`，用于描述“对话中使用导演切拍”的运行态，不替代已有 `directorLastDecision`。

建议字段：

```js
directorRuntime: {
  hookRegistered: false,
  hookRegisteredAt: 0,
  lastEventAt: 0,
  lastEventType: '',
  phase: 'idle', // idle | gate-skipped | running | api-called | fallback | injected | failed
  lastSkipReason: '',
  lastRunId: '',
  lastRunAt: 0,
  lastRunDurationMs: 0,
  lastChapterIndex: -1,
  lastBeatIndex: -1,
  lastBeatCount: 0,
  lastDecisionSource: '',
  lastInjection: {
    injected: false,
    at: 0,
    runId: '',
    chatLengthBefore: 0,
    chatLengthAfter: 0,
    insertionIndex: -1,
    role: '',
    contentLength: 0,
    contentHash: '',
    contentPreview: '',
    markerFoundAfterInsert: false
  },
  lastError: ''
}
```

注意：`index.js` 当前无法直接访问内部 `AppState`，所以 hook 注册状态可以先写在 `directorPromptGate.runtime`，并通过 public API 合并展示。更理想的实现是新增一个轻量 `directorRuntimeService`，由 `main.js/createApp` 初始化后传给 `index.js` 或暴露到 public API。

### 2. 统一 Director Telemetry

新增轻量服务，推荐文件：

- `txtToWorldbook/services/directorTelemetryService.js`

职责：

- 生成 `runId`。
- 写入 `AppState.experience.directorRuntime`。
- 维护最多 100-200 条 ring buffer 日志。
- 所有日志同时进入 `Logger`，debug 开关开启时进入 `console.debug`。
- 提供 `markHookRegistered()`、`markGateSkipped()`、`markRunStarted()`、`markApiResult()`、`markFallback()`、`markInjected()`、`markFailed()`。

日志对象建议格式：

```js
{
  at: Date.now(),
  level: 'info',
  phase: 'injected',
  runId,
  message: 'director injection inserted',
  data: { chapterIndex, beatIndex, contentLength, markerFoundAfterInsert }
}
```

### 3. 明确注入 Marker 和注入校验

当前注入消息已有 `is_westworld_director: true`，但这只存在于 JS 对象上，不一定能帮助用户确认 prompt 内容。

建议在 `buildInjection()` 生成的内容前追加稳定、短小、可搜索的注释式 marker：

```text
[WestWorld Director Injection]
run_id: ...
chapter: ...
beat: ...
```

注意：

- marker 要足够短，避免污染主模型输出。
- marker 应在设置中可关闭，但诊断期默认开启。
- 插入后立即扫描 `eventData.chat`，确认存在 `is_westworld_director === true` 或 marker 文本。
- 记录 `chatLengthBefore/chatLengthAfter/insertionIndex/contentHash/contentPreview`。

### 4. 把门控层也纳入观测

`index.js` 中的 `registerDirectorPromptHook()` 需要把以下状态显式化：

- hook 注册成功/失败。
- `MESSAGE_SENT` 触发时间。
- `GENERATION_STARTED` 的 type、dryRun、quiet/background/regenerate/swipe 判断。
- `CHAT_COMPLETION_PROMPT_READY` 到达时间。
- `getDirectorSkipReason()` 的返回值。
- `runDirectorBeforeGeneration()` 调用开始、完成、异常。

短期实现可以在 `window.WestWorld.directorGateStatus` 暴露只读快照；长期实现接入 telemetry service。

### 5. 新增 UI 诊断面板

在现有设置面板中新增一个“导演运行状态/诊断”区域，优先放在导演相关设置附近。

最小可用内容：

- Hook：已注册/未注册，注册时间。
- 当前阶段：idle/running/injected/failed/skipped。
- 最近一次跳过原因。
- 最近一次运行：章节、beat、来源 model/fallback、耗时。
- 最近一次注入：是否已注入、长度、位置、marker 校验。
- 最近错误。
- 最近 20 条导演运行日志。

操作按钮：

- “刷新状态”
- “复制诊断 JSON”
- “测试空事件门控”
- “测试模拟注入”
- “清空导演日志”

UI 不应只依赖 toast；toast 只用于异常或测试完成提示。

### 6. 新增 public API 诊断入口

在 `txtToWorldbook/app/publicApi.js` 暴露：

```js
getDirectorRuntimeStatus()
getDirectorLogs(limit)
clearDirectorLogs()
testDirectorInjection(options)
inspectDirectorInjection(chat)
```

在 `window.WestWorld` 上也暴露同名或代理方法，便于浏览器控制台直接执行：

```js
WestWorld.getDirectorStatus()
WestWorld.getDirectorLogs()
WestWorld.testDirectorInjection()
```

### 7. 拆出可测试纯函数

当前 `directorService.js` 内部函数较多，测试困难。优先抽出不依赖 DOM/ST 的函数：

- `getDirectorSkipReason()` 或等价门控判断。
- `stripExistingDirectorInjection(chat)`。
- `inspectDirectorInjection(chat)`。
- `insertDirectorInjection(chat, injection, meta)`。
- `hash/preview` 等摘要工具。

推荐新增文件：

- `txtToWorldbook/services/directorInjectionService.js`
- `txtToWorldbook/services/directorGateService.js`

### 8. 测试策略

仓库当前没有独立测试基建。先采用最轻方案：

- 新增 `package.json`，设置 `"type": "module"`。
- 使用 Node 内置 `node:test` 和 `node:assert/strict`，避免引入依赖。
- 新增 `tests/directorInjectionService.test.js`。
- 新增 `tests/directorGateService.test.js`。

最小测试用例：

- dryRun 事件必须被跳过。
- quiet/background 事件必须被跳过。
- 无近期用户输入时必须被跳过。
- regenerate/swipe 可以通过门控。
- 插入前会移除旧导演注入。
- 插入后 chat 首位是 system director injection。
- `inspectDirectorInjection()` 能返回 `injected=true`、位置、长度、marker 状态。
- 空 chat/非法 chat 不抛异常，返回可诊断失败原因。

### 9. 实施顺序

1. **状态与日志骨架**
   - 修改 `state.js`，增加 `directorRuntime` 默认结构。
   - 新增 `directorTelemetryService.js`。
   - 在 public API 暴露状态与日志。

2. **注入可观测化**
   - 抽出 `directorInjectionService.js`。
   - 修改 `directorService.js` 的注入部分，使用新服务插入、校验、记录。
   - 为每次运行生成 `runId`，写入 marker 与 runtime。

3. **门控可观测化**
   - 抽出或包裹 `getDirectorSkipReason()`。
   - `index.js` 每次 hook/gate 事件记录状态。
   - `window.WestWorld` 暴露 gate/status 快照。

4. **UI 诊断面板**
   - 修改 `settingsPanel.js` 增加状态区域。
   - 修改 `eventBindings.js` 或相关 facade 绑定按钮。
   - 渲染最近状态、日志、测试结果。

5. **测试**
   - 添加 Node 内置测试。
   - 覆盖门控与注入服务。
   - 写入 `npm test` 或 `node --test` 脚本。

6. **文档**
   - README 增加“导演运行诊断”小节。
   - 记录浏览器控制台诊断命令和常见 skip reason。

## 验收标准

实现完成后，至少满足：

- 打开插件后能看到 hook 是否注册成功。
- 发送一条用户消息后，状态从 `idle/running` 进入 `injected` 或 `gate-skipped/failed`，不会静默。
- 如果跳过，UI 和日志都显示明确原因。
- 如果运行成功，UI 显示章节、beat、decision source、注入长度、注入位置、marker 校验。
- 浏览器控制台可执行 `WestWorld.getDirectorStatus()` 得到同样信息。
- `WestWorld.testDirectorInjection()` 可在无真实生成时验证插入/检查逻辑。
- `node --test` 可跑通门控和注入服务测试。
- 原有“仅导演切拍”“世界书/角色卡生成”路径不因诊断代码改变行为。

## 风险与注意事项

- SillyTavern 的 prompt ready event 结构可能随版本变化，门控判断要保留宽松兼容。
- `eventData.chat` 是否最终被后续 ST 流程继续改写，需要通过 marker 与 prompt inspect 共同验证。
- marker 不能太长，且应可配置关闭，避免对最终回复造成明显污染。
- 不要把导演执行单全文长期存入日志；日志只保留长度、摘要、hash，避免状态膨胀。
- 现有中文文件在终端可能显示乱码，不要以 PowerShell 输出判断文件是否损坏。

## 交接提示

若后续更换模型继续实施，请优先从以下位置开始：

1. `index.js`：事件 hook 与 gate。
2. `txtToWorldbook/services/directorService.js`：`runDirectorBeforeGeneration()` 末尾的注入逻辑。
3. `txtToWorldbook/core/state.js`：`experience` 默认状态。
4. `txtToWorldbook/app/publicApi.js`：暴露诊断 API。
5. `txtToWorldbook/ui/settingsPanel.js` 与 `txtToWorldbook/ui/eventBindings.js`：诊断 UI 与按钮绑定。

建议第一批提交只做“状态 + 注入校验 + public API + 测试”，第二批再做 UI，这样可以更快验证核心链路。

---

# 计划2：失效原因调查与修复路线

记录日期：2026-05-07

## 用户体感复现点

用户反馈导演切拍在对话中失效常出现在：

- 更换对话。
- 更换角色卡。
- 切换当前对话分支 / swipe。
- 刚刚启动扩展。
- 需要先点击“故事大纲”，再点击“当前章节概览”后才恢复。

这些现象共同指向一个核心问题：**导演对话注入依赖的 WestWorld 内部运行态没有和 SillyTavern 当前 chat / character / branch / UI 初始化状态绑定**。也就是说，切拍资产本身可能是好的，但运行时拿错状态、拿空状态、拿旧状态，或压根还没有恢复状态。

## 当前代码证据

### 1. 刚启动扩展时，任务快照未必已经恢复

`index.js` 在 `bootstrap()` 中会调用 `ensureTxtToWorldbookReady()`，随后注册导演 prompt hook。但 `txtToWorldbook/main.js` 初始化时只是构建 `AppState` 和 public API，并不会自动打开 modal，也不会必然恢复 IndexedDB 中的任务快照。

真正的自动恢复在 `txtToWorldbook/ui/modalController.js`：

- `createModal()` 会 `await restoreExistingState()`。
- 只有当 `AppState.memory.queue.length <= 0` 时，才 `checkAndRestoreState({ autoRestore: true })`。
- `createModal()` 只在用户打开 WestWorld 面板时执行。

因此，刚启动时可能出现：

- hook 已注册。
- `runDirectorBeforeGeneration()` 被调用。
- 但 `AppState.memory.queue` 仍为空。
- `directorService.js` 在当前章节取不到 `memory`，返回“当前章节不存在/无可用 beats”。

这解释了“刚启动扩展失效”和“点过 UI 后恢复”的体感。

### 2. “故事大纲/当前章节概览”承担了运行态懒初始化职责

`txtToWorldbook/ui/chapterExperienceView.js` 中：

- `ensureState()` 会补 `AppState.experience = { currentChapterIndex: 0 }`。
- `ensureMemoryRuntime(memory, index)` 会补 `chapterScript.beats`、`chapterCurrentBeatIndex` 等字段。
- `showStoryOutlinePanelInternal()` 会 `renderOutlineList()`。
- `showCurrentChapterPanelInternal()` 会 `renderCurrentPanel()`。
- `enterChapter(index)` 会设置 `AppState.experience.currentChapterIndex = index`。

这意味着 UI 切换不是纯展示，它还顺手完成了很多运行态初始化。导演注入却在后台事件中直接读取这些字段：

- `AppState.experience.currentChapterIndex`
- `AppState.memory.queue[chapterIndex]`
- `memory.chapterCurrentBeatIndex`
- `memory.chapterScript.beats`

如果用户没有先进入相关 UI，这些字段可能没被补齐、没被 clamped、没被切到正确章节。

### 3. 当前 hook 只监听发送和生成，不监听聊天/角色/分支生命周期

`index.js` 当前只注册：

- `MESSAGE_SENT`
- `GENERATION_STARTED`
- `CHAT_COMPLETION_PROMPT_READY`

但用户提到的高风险场景需要监听或感知：

- `CHAT_CHANGED`
- `CHAT_CREATED`
- `MESSAGE_SWIPED`
- `MESSAGE_DELETED`
- `MESSAGE_EDITED` / `MESSAGE_UPDATED`
- `CHARACTER_SELECTED` 或类似角色切换事件
- group / character id / chat id 变化

LittleWhiteBox 的 `context-bridge.js` 已经使用 `CHAT_CHANGED`、`CHAT_CREATED`、`MESSAGE_SWIPED` 等事件向 iframe 广播，说明这些事件在当前 SillyTavern 环境中是可用且适合做运行态失效处理的。

### 4. 当前导演状态没有绑定 chatId / characterId / branch

WestWorld 的持久快照保存了：

- `memoryQueue`
- `worldbook`
- `experience`
- `fileHash`
- `novelName`

但运行时没有稳定记录：

- 当前 SillyTavern `chatId`
- 当前 `characterId`
- 当前 `name2`
- 当前分支/swipe id
- 当前 chat 长度或末尾消息签名
- 这份导演切拍资产属于哪个角色/哪个聊天

所以更换对话或角色卡后，WestWorld 仍可能沿用旧的 `AppState.experience.currentChapterIndex` 和旧的章节队列。这会造成两类失败：

- **静默跳过**：新状态没有匹配到 memory/beats。
- **错误注入**：用旧角色/旧对话的章节切拍注入到新对话。

### 5. 切换分支/swipe 后，最近 user/assistant 上下文可能变化，但 beat 状态未重新校准

`directorService.js` 通过 `SillyTavern.getContext()?.chat` 读取最近用户与 AI 消息，并根据：

- `AppState.experience.lastChapterIdx`
- `AppState.experience.lastBeatIdx`
- `memory.chapterCurrentBeatIndex`

判断新 beat / 大跳转 / 承接方式。

切换分支或 swipe 后，真实最近 assistant 消息已经变了，但 `lastBeatIdx` 与 `memory.chapterCurrentBeatIndex` 未必变。结果可能是：

- 导演以为仍在旧 beat 中段。
- 起点锚点错误。
- 该切 beat 时不切，不该切时切。
- 或 `MESSAGE_SENT` gate 与 `GENERATION_STARTED` regenerate/swipe 判断不覆盖实际分支切换。

## 核心修复方向

### A. 启动时恢复导演运行所需最小状态

新增 `ensureDirectorRuntimeReady()`，在 `registerDirectorPromptHook()` 前或第一次 `CHAT_COMPLETION_PROMPT_READY` 到达时调用。

职责：

- 如果 `AppState.memory.queue` 为空，尝试从 `MemoryHistoryDB.loadState()` 恢复。
- 只恢复导演需要的最小数据：`memory.queue`、`experience`、`fileHash/novelName`。
- 不要求打开 modal。
- 恢复结果写入 telemetry：`restored | no-state | failed`。

验收：

- 刚启动后不打开 WestWorld 面板，发送消息也能看到明确状态。
- 若没有工程快照，显示 `state-missing`，而不是静默。

### B. 建立 SillyTavern 会话指纹

新增 `getSillyTavernSessionFingerprint()`：

```js
{
  chatId,
  characterId,
  characterName,
  groupId,
  chatLength,
  lastMessageId,
  lastUserHash,
  lastAssistantHash,
  activeSwipeId
}
```

每次导演运行前都记录并比对。若发现 chat/character/branch 变化：

- 标记 `runtimeInvalidated=true`。
- 清理 `pendingUserSend`、`lastGeneration` 等 gate 临时状态。
- 重新校准 `currentChapterIndex/currentBeatIndex`。
- 必要时要求用户选择当前章节，或自动使用最近一次有效章节但显式提示。

### C. 为聊天/角色/分支事件注册失效处理

在 `index.js` 或新增 `directorLifecycleService` 中监听：

- `CHAT_CHANGED`
- `CHAT_CREATED`
- `MESSAGE_SWIPED`
- `MESSAGE_DELETED`
- `MESSAGE_EDITED`
- `MESSAGE_UPDATED`
- `CHARACTER_SELECTED` / 可用的角色切换事件

事件处理不直接重跑导演，只做：

- 更新会话指纹。
- 将 runtime phase 置为 `invalidated` 或 `needs-resync`。
- 清空 gate 临时态。
- 记录原因：`chat-changed`、`character-changed`、`swipe-changed` 等。

### D. 把 UI 初始化逻辑抽成服务，不再依赖点击大纲/当前章节

`chapterExperienceView.js` 的 `ensureState()`、`ensureMemoryRuntime()` 应抽成不依赖 DOM 的服务，例如：

- `txtToWorldbook/services/directorStateService.js`

职责：

- `ensureExperienceState(AppState)`
- `ensureMemoryDirectorRuntime(memory, index)`
- `normalizeDirectorBeatState(AppState)`
- `resolveCurrentDirectorChapter(AppState, sessionFingerprint)`

UI 和 `directorService.js` 都调用同一套服务，避免“点过 UI 才正常”。

### E. 增加状态不匹配时的显式保护

运行前检查：

- 是否有 memory queue。
- 当前章节是否存在。
- 当前章节是否有 beats。
- 当前 ST chat/character 是否与上次绑定一致。
- 当前 prompt event 是否带 chat array。
- 当前 chat array 注入后是否仍保留 marker。

如果不满足，进入明确状态：

- `state-missing`
- `chapter-missing`
- `beats-missing`
- `session-mismatch`
- `needs-user-chapter-selection`
- `injection-overwritten`

不要直接返回 `null` 后无提示。

## 计划2实施顺序

1. **先修启动恢复**
   - 新增无 UI 的 `ensureDirectorRuntimeReady()`。
   - 在 `runDirectorBeforeGeneration()` 开头调用。
   - 解决“刚启动不打开面板失效”。

2. **再修 UI 懒初始化**
   - 抽出 `directorStateService.js`。
   - `chapterExperienceView.js` 和 `directorService.js` 共享同一套 ensure/normalize。
   - 解决“必须先点故事大纲再点当前章节概览”。

3. **再修会话失效**
   - 新增 session fingerprint。
   - 监听 chat/branch/character 生命周期事件。
   - 解决换对话、换角色卡、切分支后旧状态污染。

4. **最后补自动校准策略**
   - 若检测到 chat/character 变化但用户没有明确选章节，默认进入 `needs-resync`。
   - UI 提供“一键绑定当前聊天到当前章节”。
   - 可选：根据聊天里 WestWorld opening marker 或最近章节 marker 自动恢复章节。

## 计划2测试用例

- AppState 为空但 IndexedDB 有快照：第一次 prompt ready 自动恢复。
- AppState 为空且无快照：返回 `state-missing`，日志可见。
- 打开 UI 前直接触发导演：不再依赖 `renderCurrentPanel()`。
- `CHAT_CHANGED` 后发送消息：runtime 显示 `needs-resync` 或重新绑定。
- `MESSAGE_SWIPED` 后发送消息：last assistant hash 改变，runtime 记录 branch/swipe 变化。
- 切换角色卡后发送消息：若 characterId 不一致，禁止旧切拍静默注入。

---

# 计划3：与 LittleWhiteBox 联动协议

记录日期：2026-05-07

## 目标

LittleWhiteBox 需要能读取 WestWorld 的导演切拍提示词和当前导演上下文，用于：

- 小白助手排查 WestWorld 是否正常运转。
- LittleWhiteBox 的 prompt 组装/生成功能可以显式引用当前导演执行单。
- 其他 LittleWhiteBox 模块在需要时读取当前章节、beat、导演注入摘要。

联动原则：**WestWorld 主动暴露稳定 public API；LittleWhiteBox 只读 API，不读取 WestWorld 私有 AppState 结构。**

## LittleWhiteBox 可用能力

当前 LittleWhiteBox 已有：

- `window.LittleWhiteBox.callGenerate(options)`
  - 可组装 prompt 并调用模型。
  - 支持 `advancedInjections` / inline injections。

- `window.LittleWhiteBox.assemblePrompt(options)`
  - 只组装 prompt，不调用模型。
  - 可用于验证 WestWorld 导演提示词是否进入目标 messages。

- `bridges/context-bridge.js`
  - 能读取并广播 `chatId`、`characterId`、`characterName`、`swipeId`、`totalSwipes`、`totalMessages`。
  - 已监听 `CHAT_CHANGED`、`CHAT_CREATED`、`MESSAGE_SWIPED`。

- LittleWhiteBox Assistant 的 RunJavaScriptApi
  - 可读取公开 `window` API。
  - 因此只要 WestWorld 暴露稳定的 `window.WestWorld.*` 或 `window.WestWorldTxtToWorldbook.*`，助手就可以查询。

## WestWorld 应暴露的只读 API

在 `txtToWorldbook/app/publicApi.js` 和 `window.WestWorld` 上暴露：

```js
getDirectorContext(options)
getDirectorInjectionPrompt(options)
getDirectorPromptForLittleWhiteBox(options)
getDirectorRuntimeStatus()
getDirectorLogs(limit)
inspectDirectorInjection(chat)
```

### `getDirectorContext(options)`

返回结构化上下文，不返回大段 prompt：

```js
{
  ok: true,
  reason: '',
  session: {
    chatId,
    characterId,
    characterName,
    groupId,
    activeSwipeId,
    chatLength
  },
  chapter: {
    index,
    title,
    outlinePreview
  },
  beat: {
    index,
    count,
    id,
    summary,
    entryEvent,
    exitCondition,
    originalPreview
  },
  decision: {
    source,
    at,
    isNewBeat,
    switchDirection,
    directionStart,
    actionChain,
    directionEnd
  },
  runtime: {
    phase,
    lastSkipReason,
    lastInjection
  }
}
```

### `getDirectorInjectionPrompt(options)`

返回当前可用于注入的导演执行单文本。

建议选项：

```js
{
  includeMarker: true,
  includeDiagnostics: false,
  maxLength: 0, // 0 表示不截断
  mode: 'current' // current | lastInjected | preview
}
```

返回：

```js
{
  ok: true,
  reason: '',
  content: '...',
  meta: {
    runId,
    chapterIndex,
    beatIndex,
    contentLength,
    contentHash,
    source: 'current-decision'
  }
}
```

### `getDirectorPromptForLittleWhiteBox(options)`

给 LittleWhiteBox 直接消费的包装格式：

```js
{
  ok: true,
  reason: '',
  injection: {
    role: 'system',
    content: '...',
    identifier: 'westworld-director-current',
    position: 'IN_PROMPT',
    depth: 0
  },
  context: { ...getDirectorContext() }
}
```

这样 LittleWhiteBox 可以直接：

```js
const ww = await window.WestWorld.getDirectorPromptForLittleWhiteBox();
const messages = await window.LittleWhiteBox.assemblePrompt({
  components: { list: ['ALL_PREON'] },
  advancedInjections: ww.ok ? [ww.injection] : [],
  userInput: ''
});
```

## LittleWhiteBox 侧推荐接入方式

### A. 小白助手读取

助手使用 RunJavaScriptApi 读取：

```js
return await st.window.WestWorld.getDirectorContext({ includeRuntime: true });
```

或：

```js
return await st.window.WestWorld.getDirectorPromptForLittleWhiteBox({ maxLength: 4000 });
```

为此 LittleWhiteBox Assistant 的 JSAPI manifest 需要允许只读路径：

- `window.WestWorld`
- `window.WestWorld.getDirectorContext`
- `window.WestWorld.getDirectorPromptForLittleWhiteBox`
- `window.WestWorld.getDirectorRuntimeStatus`
- `window.WestWorld.getDirectorLogs`
- `window.WestWorldTxtToWorldbook`
- `window.WestWorldTxtToWorldbook.getDirectorContext`
- `window.WestWorldTxtToWorldbook.getDirectorPromptForLittleWhiteBox`

语义标记为 `read`，不要标成 `effect`。

### B. callGenerate / assemblePrompt 读取

LittleWhiteBox 不需要硬编码 WestWorld 内部结构。只需新增一个可选 helper：

```js
window.LittleWhiteBox.getWestWorldDirectorInjection = async function(options = {}) {
  const api = window.WestWorld || window.WestWorldTxtToWorldbook;
  if (!api || typeof api.getDirectorPromptForLittleWhiteBox !== 'function') {
    return { ok: false, reason: 'westworld-api-missing' };
  }
  return api.getDirectorPromptForLittleWhiteBox(options);
};
```

使用时：

```js
const ww = await window.LittleWhiteBox.getWestWorldDirectorInjection();
const res = await window.LittleWhiteBox.callGenerate({
  components: { list: ['ALL_PREON'] },
  advancedInjections: ww.ok ? [ww.injection] : [],
  userInput: '...',
  streaming: { enabled: true },
  api: { inherit: true }
});
```

### C. Context bridge 广播 WestWorld 状态

可选增强：LittleWhiteBox `context-bridge.js` 的 `_buildContextSnapshot()` 可加入：

```js
westworld: {
  available: true,
  phase,
  chapterIndex,
  beatIndex,
  lastInjectionAt,
  lastSkipReason
}
```

注意只放摘要，不放完整导演提示词，避免 iframe 上下文过重。

## WestWorld 侧联动实现顺序

1. **先暴露只读 API**
   - `getDirectorContext()`
   - `getDirectorInjectionPrompt()`
   - `getDirectorPromptForLittleWhiteBox()`

2. **再给注入对象加标准 identifier**
   - `identifier: 'westworld-director-current'`
   - 便于 LittleWhiteBox prompt assembler 定位、去重、调试。

3. **再补 LittleWhiteBox helper**
   - 在 `bridges/call-generate-service.js` 或独立 bridge 中添加 `getWestWorldDirectorInjection()`。
   - 保持可选依赖：WestWorld 不存在时返回 `ok:false`。

4. **最后接入 Assistant JSAPI manifest**
   - 允许读取 WestWorld public API。
   - 在 Assistant system prompt 或参考文档中说明：排查 WestWorld 时优先调用这些 API。

## 计划3验收标准

- 控制台执行 `WestWorld.getDirectorContext()` 能看到当前章节/beat/运行态。
- 控制台执行 `WestWorld.getDirectorPromptForLittleWhiteBox()` 能得到可直接塞进 LittleWhiteBox `advancedInjections` 的对象。
- 控制台执行 `LittleWhiteBox.assemblePrompt({ advancedInjections: [...] })` 后，messages 中能找到 `identifier === 'westworld-director-current'`。
- WestWorld 未安装或未初始化时，LittleWhiteBox helper 返回 `ok:false`，不抛异常。
- LittleWhiteBox Assistant 能通过 RunJavaScriptApi 读取导演上下文并向用户解释当前是否正常。

---

# 实施记录

更新时间：2026-05-07

## 第一批已完成

本批目标：先完成“无 UI 的导演运行态恢复/诊断 + 状态服务抽出 + 会话失效 + 核心可观测 API + 最小测试”，暂不做 UI 诊断面板，暂不修改 LittleWhiteBox 代码。

### 1. 启动时无 UI 的导演状态恢复

已新增：

- `txtToWorldbook/services/directorStateService.js`
  - `ensureDirectorRuntimeReady()`
  - `applyDirectorRuntimeSnapshot()`
  - `normalizeDirectorBeatState()`
  - `ensureExperienceState()`
  - `ensureMemoryDirectorRuntime()`

接入点：

- `txtToWorldbook/services/directorService.js`
  - 在 `runDirectorBeforeGeneration(eventData)` 开头调用 `ensureDirectorRuntimeReady()`。
  - 当 `AppState.memory.queue` 为空时，直接读取 `MemoryHistoryDB.loadState()`。
  - 只恢复导演运行需要的最小字段：`memory.queue`、`experience`、`file.hash`、`file.novelName`。
  - 若无快照或恢复失败，写入明确 skip/restore 状态，不再静默。

当前效果：

- 刚启动、不打开 WestWorld 面板时，第一次 prompt ready 可尝试恢复 IndexedDB 快照。
- 无快照时状态会显示 `state-missing`。

### 2. 抽出 directorStateService，降低 UI 懒初始化耦合

已改：

- `txtToWorldbook/ui/chapterExperienceView.js`
  - 原本局部的 `ensureState()` 改为调用 `ensureExperienceState()`。
  - 原本局部的 `ensureMemoryRuntime()` 改为复用 `ensureMemoryDirectorRuntime()`，再执行 UI 自己的 beat view normalization。

当前效果：

- UI 和后台导演注入共享一套运行态初始化逻辑。
- “点过故事大纲/当前章节概览才顺手初始化”的问题被削弱。

### 3. session fingerprint 与生命周期失效处理

已新增：

- `getSillyTavernSessionFingerprint()`
  - 采集 `chatId`、`characterId`、`characterName`、`groupId`、`chatLength`、`lastMessageId`、`lastUserHash`、`lastAssistantHash`、`activeSwipeId`。

- `diffSessionFingerprint()`
  - 当前只把 `chatId`、`characterId`、`groupId`、`activeSwipeId` 作为硬失效字段。
  - `lastAssistantHash` 已记录但暂不作为硬失效字段，避免每轮正常生成后误报。

已改：

- `index.js`
  - 新增 `registerDirectorLifecycleHooks()`。
  - 监听：
    - `CHAT_CHANGED`
    - `CHAT_CREATED`
    - `MESSAGE_SWIPED`
    - `MESSAGE_DELETED`
    - `MESSAGE_EDITED`
    - `MESSAGE_UPDATED`
    - `CHARACTER_SELECTED`
  - 事件触发时：
    - 清理 `pendingUserSend`
    - 清理 `lastGeneration`
    - 写入 `needs-resync`
    - 记录 invalidation reason。

当前效果：

- 换对话、建新对话、swipe、编辑/删除/更新消息、角色切换时，不会继续完全无感沿用 gate 临时态。
- 后续 UI 可直接显示 `needs-resync` 与原因。

### 4. telemetry、注入 marker、public API

已新增：

- `txtToWorldbook/services/directorTelemetryService.js`
  - 维护 `AppState.experience.directorRuntime`。
  - 维护 `AppState.experience.directorLogs` ring buffer。
  - 提供：
    - `markHookRegistered()`
    - `markEvent()`
    - `markGateSkipped()`
    - `markRunStarted()`
    - `markRestore()`
    - `markApiResult()`
    - `markInjected()`
    - `markFailed()`
    - `markInvalidated()`
    - `getStatus()`
    - `getLogs()`
    - `clearLogs()`

- `txtToWorldbook/services/directorInjectionService.js`
  - `DIRECTOR_INJECTION_MARKER = '[WestWorld Director Injection]'`
  - `DIRECTOR_INJECTION_IDENTIFIER = 'westworld-director-current'`
  - `withDirectorInjectionMarker()`
  - `insertDirectorInjection()`
  - `inspectDirectorInjection()`
  - `stripExistingDirectorInjection()`
  - `hashText()` / `previewText()`

已改：

- `txtToWorldbook/core/state.js`
  - 新增 `createInitialDirectorRuntimeState()`。
  - `experience.directorRuntime` 默认初始化。

- `txtToWorldbook/services/directorService.js`
  - 注入前会生成 `runId`。
  - 注入内容前加短 marker。
  - 注入后立即 inspect，记录：
    - `chatLengthBefore`
    - `chatLengthAfter`
    - `insertionIndex`
    - `role`
    - `contentLength`
    - `contentHash`
    - `contentPreview`
    - `markerFoundAfterInsert`
  - 最近一次完整注入文本写入 `AppState.experience.directorLastInjectionPrompt`，供 public API 读取。
  - 最近一次注入摘要写入 `AppState.experience.directorLastInjectionMeta`。

已暴露 public API：

- `WestWorldTxtToWorldbook.getDirectorRuntimeStatus()`
- `WestWorldTxtToWorldbook.getDirectorLogs(limit)`
- `WestWorldTxtToWorldbook.clearDirectorLogs()`
- `WestWorldTxtToWorldbook.inspectDirectorInjection(chat)`
- `WestWorldTxtToWorldbook.testDirectorInjection(options)`
- `WestWorldTxtToWorldbook.getDirectorContext(options)`
- `WestWorldTxtToWorldbook.getDirectorInjectionPrompt(options)`
- `WestWorldTxtToWorldbook.getDirectorPromptForLittleWhiteBox(options)`

`window.WestWorld` 也已代理：

- `WestWorld.getDirectorStatus()`
- `WestWorld.getDirectorRuntimeStatus()`
- `WestWorld.getDirectorLogs(limit)`
- `WestWorld.clearDirectorLogs()`
- `WestWorld.inspectDirectorInjection(chat)`
- `WestWorld.testDirectorInjection(options)`
- `WestWorld.getDirectorContext(options)`
- `WestWorld.getDirectorInjectionPrompt(options)`
- `WestWorld.getDirectorPromptForLittleWhiteBox(options)`
- `WestWorld.getDirectorGateStatus()`

当前效果：

- 控制台可直接查询 hook、gate、restore、run、injection 状态。
- LittleWhiteBox 后续可读 `getDirectorPromptForLittleWhiteBox()`，不需要读取私有 `AppState`。

### 5. 门控服务与测试

已新增：

- `txtToWorldbook/services/directorGateService.js`
  - `extractGenerationContext()`
  - `getDirectorSkipReason()`

已改：

- `index.js`
  - 原 gate 判断改为调用 `directorGateService`。

已新增测试：

- `package.json`
  - `"type": "module"`
  - `"test": "node --test"`

- `tests/directorGateService.test.js`
  - 覆盖：
    - dryRun 跳过
    - quiet/background 跳过
    - 无近期用户输入跳过
    - recent user input 通过
    - regenerate/swipe 通过

- `tests/directorInjectionService.test.js`
  - 覆盖：
    - 插入前移除旧导演注入
    - 插入后 chat 首位为 system director injection
    - marker 存在
    - invalid/empty chat 可诊断失败
    - legacy prompt 文本可被清理

验证结果：

- `npm test`：通过，7 个测试全绿。
- `node --check`：
  - `index.js` 通过。
  - `txtToWorldbook/services/directorService.js` 通过。
  - `txtToWorldbook/services/directorStateService.js` 通过。
  - `txtToWorldbook/services/directorTelemetryService.js` 通过。
- `git diff --check`：无 whitespace error，仅提示工作区 LF 将来可能转 CRLF。

## 当前未完成

### UI 诊断面板

已在本轮继续实现：

- `txtToWorldbook/ui/settingsPanel.js`
  - 设置页新增“导演运行诊断”区域。
  - 展示 API、Hook、phase、skip reason、章节、beat、注入、marker、最近运行、失效原因。
  - 展示诊断 JSON。
  - 展示最近 20 条导演日志。

- `txtToWorldbook/ui/eventBindings.js`
  - 绑定：
    - “刷新状态”
    - “复制诊断 JSON”
    - “测试模拟注入”
    - “清空日志”
  - UI 只消费 `window.WestWorld` / `window.WestWorldTxtToWorldbook` public API，不读取私有 `AppState`。

当前效果：

- 打开 WestWorld 设置页即可查看导演运行态。
- 可从 UI 直接复制诊断 JSON。
- 可在无真实生成时运行模拟注入测试。

尚可增强：

- 自动定时刷新或在 hook event 后刷新 UI。
- 更精细的颜色状态与错误分类。

### LittleWhiteBox helper

已更正实现位置：不改 LittleWhiteBox 全局 `callGenerate` helper，也不改 Assistant JSAPI。EnaPlanner 需要在自己的规划链路里显式读取 WestWorld，且用户能关闭。

当前 LittleWhiteBox 仅修改：

- `D:\github\LittleWhiteBox\modules\ena-planner\ena-planner.js`
  - 新增配置：
    - `westWorldDirector.enabled`，默认 `false`。
    - `westWorldDirector.maxLength`，默认 `4000`。
  - 新增 `buildWestWorldDirectorBlock()`：
    - 通过 `window.WestWorld || window.WestWorldTxtToWorldbook || window.StoryWeaver || window.StoryWeaverTxtToWorldbook` 获取 WestWorld public API。
    - 调用 `getDirectorPromptForLittleWhiteBox({ includeMarker:true, maxLength, mode:'current' })`。
    - 成功时把导演执行单包装为 `<westworld_director>...</westworld_director>` system message 加入 EnaPlanner 规划 messages。
    - WestWorld 不存在、未初始化、没有当前执行单时只记录 warning 并跳过，不阻断 EnaPlanner。
  - 新增 `debugWestWorldForUi()` 和 `xb-ena:debug-westworld` 消息处理，用于 UI 诊断。

- `D:\github\LittleWhiteBox\modules\ena-planner\ena-planner.html`
  - 设置页新增“WestWorld 导演”卡片。
  - 提供“调用 WestWorld 导演执行单”开关。
  - 提供最大读取字符数设置。
  - 提供“诊断 WestWorld 导演”按钮。

当前效果：

- EnaPlanner 可以在开启后读取 WestWorld 当前导演执行单。
- 默认关闭，不影响现有 EnaPlanner 行为。
- 用户可在 EnaPlanner UI 中关闭该功能。
- 若 WestWorld 不存在或 public API 不可用，EnaPlanner 会跳过该上下文，不抛异常。

### 更严格的 session 绑定策略

本轮已实现保守版强绑定：

- `txtToWorldbook/services/directorService.js`
  - 新增 `bindDirectorSessionToCurrentChapter()`。
  - 用户主动绑定后，将当前 SillyTavern `chatId` / `characterId` / `groupId` 绑定到当前章节和 beat。
  - 后续生成前若绑定信息与当前聊天/角色不一致，进入 `session-mismatch:*`，并跳过注入，避免旧切拍误注入到新聊天。
  - 未主动绑定时不启用强阻断，保持旧流程兼容。

- `index.js`
  - `window.WestWorld.bindDirectorSessionToCurrentChapter()` 代理到 public API。

- `txtToWorldbook/ui/settingsPanel.js` / `txtToWorldbook/ui/eventBindings.js`
  - 诊断面板新增“绑定当前聊天”按钮。
  - 面板显示当前绑定章节。

当前策略：

- 未绑定：只记录 session fingerprint 与生命周期失效，不阻断，最大限度兼容旧用法。
- 已绑定：若当前 `chatId` / `characterId` / `groupId` 不一致，明确跳过并显示 `session-mismatch`。

尚可增强：

- 将绑定信息纳入更明确的导出/导入说明。
- 支持解绑按钮。
- 支持按聊天自动记忆多个绑定关系。

## 当前变更文件清单

已修改：

- `index.js`
- `txtToWorldbook/core/state.js`
- `txtToWorldbook/main.js`
- `txtToWorldbook/services/directorService.js`
- `txtToWorldbook/ui/chapterExperienceView.js`
- `txtToWorldbook/ui/eventBindings.js`
- `txtToWorldbook/ui/settingsPanel.js`

已新增：

- `package.json`
- `tests/directorGateService.test.js`
- `tests/directorInjectionService.test.js`
- `txtToWorldbook/services/directorGateService.js`
- `txtToWorldbook/services/directorInjectionService.js`
- `txtToWorldbook/services/directorStateService.js`
- `txtToWorldbook/services/directorTelemetryService.js`

LittleWhiteBox 已修改：

- `D:\github\LittleWhiteBox\modules\ena-planner\ena-planner.js`
- `D:\github\LittleWhiteBox\modules\ena-planner\ena-planner.html`

## SillyTavern 插件兼容性确认

本轮按 SillyTavern 第三方扩展运行环境做了兼容性核对：

- WestWorld 仍按浏览器 ESM 加载，`index.js` 的新增 import 使用相对路径指向插件目录内文件。
- 新增 `package.json` 只用于本地 `node --test`，不会参与浏览器加载。
- 后台 hook 仍使用 SillyTavern 已有 `eventSource` / `event_types`。
- 生命周期事件保持可选注册：某些 ST 版本没有的 event type 会被跳过。
- WestWorld 诊断 UI 只调用 `window.WestWorld` / `window.WestWorldTxtToWorldbook` public API。
- EnaPlanner 的 WestWorld 读取保持可选依赖：WestWorld 不存在时跳过，不抛异常。
- 未修改 Assistant JSAPI，也未开放危险 `window` 访问。

本轮新增验证：

- WestWorld：`npm test` 通过，7 个测试全绿。
- WestWorld：`node --check index.js / eventBindings.js / settingsPanel.js / directorService.js / directorStateService.js / directorTelemetryService.js` 通过。
- LittleWhiteBox：`node --check modules/ena-planner/ena-planner.js` 通过。
- 两仓库 `git diff --check` 均无 whitespace error；WestWorld 仅有 Git 的 LF/CRLF 提示。
