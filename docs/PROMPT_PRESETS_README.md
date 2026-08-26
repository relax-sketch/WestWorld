# WestWorld 提示词与预设改造说明

本文记录 WestWorld 当前章节资产提示词的来源、组装方式、兼容边界，以及以后替换小说示例或重写整套预设时的修改方法。

## 一、这套实现的来源

WestWorld 的提示词改造参考了另一个项目：

- 项目目录：`D:\Github_All\ttavern\sillytaver_move`
- 相关 Codex 线程：`01a03703-f08f-7c00-b525-c05d3ef93d75`
- 阶段性成果：`34aae0a feat: align prompt runtime with SillyTavern strict flow`

参考项目主要完成了 SillyTavern 预设行为的核对：

1. 对比原始预设、未开启 strict 的请求、开启 strict 的请求。
2. 确认连续消息合并和角色转换规则。
3. 确认预设实际使用的 `user → assistant → user` 三消息结构。
4. 补齐 `{{random::...}}`、`{{roll ...}}` 等宏的行为。
5. 核对 in-chat 深度注入和历史消息深度计算。

WestWorld 没有把该项目作为依赖，也没有直接调用它的 Compiler 或宏解析器。WestWorld 只是按照这些已核实的行为，用自己的提示词注册、章节处理和主 AI/导演 AI 路由重新实现。

因此应当区分：

- **借用的部分**：SillyTavern 预设的行为结论、消息链结构、strict 和动态标识的设计思路。
- **WestWorld 自己实现的部分**：章节变量注入、章节资产校验、主 AI → 导演 AI 兜底、独立重试、批量任务和工程包。
- **当前依赖关系**：WestWorld 不依赖 `sillytaver_move`，两个项目可以独立修改和发布。

## 二、当前章节资产提示词流程

章节资产提示词的主要组装函数位于：

`txtToWorldbook/services/processingService.js` 的 `buildChapterAssetsPolishPrompt()`。

整体流程如下：

```text
章节开始
  ↓
读取当前章节和上一章状态
  ↓
生成章节变量
  ↓
选择提示词来源
  ├─ 用户自定义章节提示词
  ├─ 特化三消息预设
  └─ 传统提示词注册模块
  ↓
组成最终请求
  ↓
交给主 AI 或导演 AI
  ↓
解析 JSON
  ↓
执行 outline、beats、ID、顺序、禁止字段、原文等校验
```

当前会注入的变量包括：

| 变量 | 含义 |
|---|---|
| `CHAPTER_INDEX` | 当前章节编号 |
| `CHAPTER_TITLE` | 当前章节标题 |
| `PREVIOUS_OUTLINE` | 上一章摘要，没有则为“无” |
| `BEAT_COUNT` | 本地预切节拍数量 |
| `LOCAL_BEATS_JSON` | 本地预切节拍数据 |
| `RETRY_TEXT` | 上一次失败原因或重试提示 |

模板中的占位符会在发送 API 前替换，不会把这些占位符原样交给模型。

## 三、特化预设的三消息结构

特化预设保留以下结构：

```text
user
assistant
user
```

三条消息的职责通常是：

1. 第一条 `user`
   - 示例小说文本。
   - 章节资料。
   - 输出边界和背景说明。
2. `assistant`
   - 模拟模型已经读取章节资料。
   - 固定提示模型进入下一步输出。
3. 第二条 `user`
   - 规定最终 JSON 结构。
   - 要求保持节拍数量、ID、顺序和原文。
   - 说明禁止字段和校验要求。

主 AI 和导演 AI 使用同一套消息结构。切换 AI 目标时，不会临时拼接另一种格式的提示词。

## 四、动态反标识

原始预设中的：

```text
<|no-trans|>meaningless test: ...
```

不能写死，否则每次请求完全相同。

WestWorld 在：

`txtToWorldbook/core/chapterAssetsPromptSource.js`

中动态生成标识：

```text
随机字符 + 时间戳 + 递增计数器
```

每次特化提示词真正组装时都会重新生成。计数器用于避免随机值碰巧重复。

注意：

- 反标识必须在请求组装阶段生成。
- 不要把新的标识重新写回全局固定常量。
- 不要只在页面初始化时生成一次。
- 自定义章节模板目前不自动添加这个标识；如果以后需要，应明确把它加入自定义模板流程。

## 五、当前龙族示例文本的替换方式

当前文本资源也位于：

`txtToWorldbook/core/chapterAssetsPromptSource.js`

其中的 `defaultDragonNovelPromptSource` 是内置示例文本。

组装时，WestWorld 会处理特化预设第一条 `user` 消息：

```text
旧反标识
旧示例文本
[对话已重置]
后续任务规则和 JSON 输出约束
```

实际替换规则是：

1. 重新生成反标识。
2. 替换 `[对话已重置]` 之前的示例区域。
3. 使用内置的 `defaultDragonNovelPromptSource`。
4. 保留 `[对话已重置]` 之后的任务规则。

这样换小说示例时，不会误删后面的 JSON 约束、资产字段说明和交互规则。

## 六、以后只替换小说示例

如果只是把龙族示例换成另一部小说，推荐只改：

`txtToWorldbook/core/chapterAssetsPromptSource.js`

中的：

```js
export const defaultDragonNovelPromptSource = '...';
```

不要修改：

- `processingService.js` 中的路由逻辑。
- 三消息角色顺序。
- `[对话已重置]` 之后的任务规则。
- JSON 校验逻辑。
- 主 AI / 导演 AI 的调用方式。

替换后至少运行：

```bash
npm test
```

并确认：

- 第一条消息包含新小说文本。
- 每次构建的 `meaningless test` 不相同。
- `outline` 和 `beats` 约束仍然存在。
- 三条消息角色仍为 `user, assistant, user`。

## 七、以后完全重写预设

如果要完全推翻当前模板，可以改动：

`txtToWorldbook/core/constants.js` 中的：

- `defaultChapterAssetsPolishMessages`
- `defaultChapterAssetsPolishPrompt`

建议仍然保留三消息结构，除非确实需要改变 API 请求语义。

完全重写时需要同时检查：

1. 所有章节变量是否仍然被使用。
2. `{CHAPTER_TITLE}`、`{LOCAL_BEATS_JSON}` 等占位符是否需要保留。
3. 是否还需要上一章摘要。
4. 是否还需要 `RETRY_TEXT`。
5. 是否保留 `[对话已重置]` 边界；如果删除，需要同步修改 `refreshSpecializedChapterAssetsPrompt()`。
6. 严格 JSON 输出要求是否仍覆盖：
   - `outline`
   - `beats`
   - beat ID
   - beat 顺序
   - 原文不可改写
   - 禁止字段
7. 现有测试是否仍然验证了真实发送的消息，而不是只验证最终字符串长度。

如果不再使用特化预设，可以关闭：

```text
chapterAssetsUseSpecializedPreset
```

此时会回到传统提示词注册路径，不影响主 AI → 导演 AI 路由本身。

## 八、主 AI、导演 AI 与提示词的关系

章节资产 API 支持：

```text
main
director
main-then-director
```

其中 `main-then-director` 的行为是：

```text
主 AI 使用当前提示词重试
  ↓
主 AI 重试耗尽
  ↓
导演 AI 使用同一份提示词重新开始自己的重试次数
```

两边共用：

- 章节内容。
- 上一章摘要。
- 本地预切节拍。
- JSON 字段规则。
- 特化三消息结构。

两边不共用：

- API 调用目标。
- API 并发额度。
- 当前一侧的重试次数。
- 失败状态和日志来源。

因此，修改提示词会同时影响主 AI 和导演 AI。若以后希望两者使用完全不同的提示词，应在路由目标确定后分别选择模板，而不是在调用 API 层临时修改字符串。

## 九、提示词修改的边界

### 可以放心修改

- 小说示例文本。
- 角色语气。
- 输出字段说明。
- JSON 示例。
- 章节资产的评价标准。
- 重试错误的解释方式。
- 三条消息中的具体正文。

### 需要配套测试

- 消息角色顺序。
- 消息合并方式。
- 占位符名称。
- `[对话已重置]` 边界。
- strict 兼容行为。
- 主 AI / 导演 AI 的路由切换。
- JSON 校验规则。
- 原文和 beat 数量约束。

### 不要在提示词修改中顺便改动

- FileJob 状态隔离。
- 批量调度器。
- API Semaphore。
- IndexedDB 快照格式。
- 老工程包导入格式。
- API Key 和本地设置持久化。

这些属于任务调度或数据兼容层，不是提示词层。

## 十、推荐的修改顺序

以后引入新预设时，建议按以下顺序：

1. 先把原始预设和真实 API 请求保存为测试样本。
2. 确认未处理和 strict 处理后的消息数量、角色顺序和内容归属。
3. 决定新预设采用：
   - 三消息特化链；
   - 传统单请求模板；
   - 用户自定义模板。
4. 先替换模板内容，不改变 API 路由。
5. 再确认章节变量注入。
6. 最后确认主 AI → 导演 AI 兜底仍收到同样的结构。
7. 运行全量测试：

```bash
npm test
```

8. 检查 Git 差异后再提交。

核心原则是：

> 提示词内容可以完全替换；消息组装、变量注入、校验和路由应分开修改、分开验证。
