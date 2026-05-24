# WestWorld 扩展开发知识库

> 基于代码修改积累的经验，涵盖项目架构、设置持久化、提示词系统、预设管理、API 超时、扩展联动。

---

## 一、项目架构

### 1.1 双层结构

```
WestWorld/                        # SillyTavern 第三方扩展
├── index.js                      # 扩展入口：抽屉UI + 桥接初始化
├── drawer-component.html         # 抽屉模板（左下角图标弹出）
├── txtToWorldbook/               # 核心子模块（动态 import）
│   ├── main.js                   # 模块入口：组装所有 service/view
│   ├── app/                      # 依赖注入 & 运行时桥接
│   │   ├── createApp.js
│   │   ├── createFeatureServices.js  # ★ 所有 service 在此组装
│   │   ├── createRuntimeBridges.js
│   │   ├── runtimeActionsFacade.js   # ★ handleStartConversion 入口
│   │   └── publicApi.js
│   ├── core/
│   │   ├── constants.js          # defaultSettings 与兼容默认模板来源
│   │   └── state.js              # createInitialAppState()
│   ├── services/
│   │   ├── apiService.js         # ★ API调用（含超时逻辑）
│   │   ├── directorService.js    # ★ 导演三态、框架与注入提示词构建
│   │   ├── promptRegistryService.js # ★ 全量提示模块及分层渲染
│   │   ├── packagePolicyService.js  # ★ 提示词包/工程包白名单边界
│   │   ├── promptService.js      # 世界书公共提示组装
│   │   ├── settingsPersistenceService.js  # ★ 设置持久化
│   │   ├── processingService.js  # 处理流程入口
│   │   ├── mergeService.js       # 别名合并 & verifyDuplicatesWithAI
│   │   └── ...
│   ├── ui/
│   │   ├── settingsPanel.js      # ★ 所有设置UI的HTML生成 & hydrate
│   │   ├── eventBindings.js      # ★ 所有事件绑定
│   │   ├── startButtonView.js    # 按钮状态管理
│   │   ├── modalEventBinder.js   # 模态框事件组装
│   │   └── ...
│   └── infra/
│       └── apiCaller.js
```

### 1.2 关键入口

| 入口 | 文件 | 作用 |
|------|------|------|
| 扩展启动 | `index.js` → `bootstrap()` | 加载抽屉UI → 动态 import txtToWorldbook → 注册导演钩子 |
| 设置保存 | `settingsPersistenceService.saveCurrentSettings()` | DOM → AppState.settings → localStorage |
| 设置加载 | `settingsPersistenceService.loadSavedSettings()` | localStorage → AppState.settings → hydrate UI |
| 世界书提取启动 | `runtimeActionsFacade.handleStartConversion()` | 验证 → 设置 startIndex → handleStartProcessing |
| 事件绑定 | `modalEventBinder.bindModalEvents()` | 模态框打开时调用各 bind* 函数 |

---

## 二、设置持久化系统

### 2.1 两层持久化

| 层级 | 存储位置 | 存取方式 | 用途 |
|------|---------|---------|------|
| extension_settings | ST 的 `saveSettings()` | `extension_settings.westworld` | 快速开关状态、扩展级配置 |
| AppState.settings | localStorage | `westworldTxtToWorldbookSettings` | 所有用户配置（提示词、API、预设等） |

### 2.2 持久化关键教训

**AppState.settings 流向不够可靠**。`saveCurrentSettings()` 在序列化前会从 DOM 读取大量字段并回写到 `AppState.settings`。当模态框未打开时，DOM 元素不存在，字段可能被重置为默认值。

**解决方案：对需要可靠持久化的数据，使用专用 localStorage 键**。

```javascript
// 可靠：直接 localStorage
const getPresets = () => JSON.parse(localStorage.getItem('myKey')) || [];
const setPresets = (arr) => localStorage.setItem('myKey', JSON.stringify(arr));

// 不可靠：走 AppState.settings → saveCurrentSettings
AppState.settings.myPresets = newData;
saveCurrentSettings();
// 问题：saveCurrentSettings 内部可能从 DOM 回读并覆盖
```

### 2.3 当前所有 localStorage 键

| 键 | 内容 |
|------|------|
| `westworldTxtToWorldbookSettings` | 主设置（所有提示词、API配置等） |
| `westworldPromptPrefixPresets` | 提示词开头预设列表 |
| `westworldSelectedPromptPrefixPreset` | 当前选中的提示词开头 |
| `westworldAiRoutePresets` | AI路由配置预设列表 |
| `westworldSelectedAiRoutePreset` | 当前选中的AI路由 |
| `westworldDirectorFrameworkPresets` | 导演AI框架提示词预设 |
| `westworldSelectedDirectorFrameworkPreset` | 当前选中的导演框架提示词 |
| `westworldDirectorInjectionPresets` | 导演注入提示词预设 |
| `westworldSelectedDirectorInjectionPreset` | 当前选中的导演注入提示词 |

---

## 三、预设系统模式

### 3.1 通用预设组件

所有预设系统遵循同一模式（4 处：提示词开头、AI路由、导演框架、导演注入）：

**UI 组件**（settingsPanel.js）：
```html
<select id="xxx-preset-select">   <!-- 预设下拉 -->
<button id="xxx-preset-load">     <!-- 加载选中预设 -->
<button id="xxx-preset-save-as">  <!-- 另存为 -->
<button id="xxx-preset-delete">   <!-- 删除（默认隐藏） -->
```

**JS 逻辑**（eventBindings.js）：
```javascript
bindPromptPresetEvents({
    presetKey: 'westworldXxxPresets',        // localStorage 键
    selectedKey: 'westworldSelectedXxxPreset',
    selectId: 'ttw-xxx-preset-select',       // DOM 元素 ID
    loadBtnId: 'ttw-xxx-preset-load',
    saveBtnId: 'ttw-xxx-preset-save-as',
    deleteBtnId: 'ttw-xxx-preset-delete',
    textareaId: 'ttw-xxx-prompt',            // 关联的 textarea
    settingKey: 'customXxxPrompt',           // AppState.settings 字段
    label: 'XX提示词',                        // toast 消息用
});
```

### 3.2 预设数据结构

```javascript
// 提示词类预设
[{ name: "预设一", content: "提示词内容..." }, ...]

// AI路由类预设
[{ name: "配置A", mainApi: {...}, directorApi: {...} }, ...]

// 提示词开头预设
[{ name: "写作风", prefix: "你是专业小说分析专家..." }, ...]
```

---

## 四、提示词系统

### 4.1 统一注册表

`services/promptRegistryService.js` 是提示词的唯一默认模板注册入口。凡是会作为指令发给模型的静态文案，都应注册为模块，不应在调用服务中新增硬编码包装文本。

覆盖范围包括分类提取、TXT 转世界书、修复与重 roll、整理条目、别名合并、导演章节资产、导演 API 框架、导演注入演员、本地兜底、开场白以及导演上下文/缺省指导片段。

### 4.2 分层模型

- 每个模块都解析为 `prefix`、`body`、`suffix` 三层。
- `defaultLayers` 是代码中的固定基线；UI 的“恢复默认”删除覆盖值并回到该基线，不会写回或修改默认模板。
- `promptOverrides` 保存用户覆盖，显式保存空正文也会保留；必要占位符缺失仅生成 warning，不阻止保存。
- `promptGlobal.prefix` / `promptGlobal.suffix` 是完整请求的全局包裹层，`composeRequest()` / `composeFragments()` 负责保证只应用一次。

### 4.3 导演三态和注入边界

| `directorMode` | 行为 |
|----------------|------|
| `api` | `DIRECTOR_FRAMEWORK` 作为完整 API 请求，使用全局层；失败是否兜底由 `directorFallbackOnError` 独立控制。 |
| `local-fallback` | 不调用导演 API，使用可编辑的 `DIRECTOR_FALLBACK_*` 模块生成决策。 |
| `off` | 跳过每轮导演准备与注入。 |

`DIRECTOR_INJECTION` 是嵌入当前 SillyTavern 预设的演员执行内容。它只渲染模块自身三层及其子片段，不应用全局前后缀，也不套主 API 消息链；PromptManager / LittleWhite 使用的 identifier、position、depth 和 marker 属于固定协议元数据，不开放为提示词。

### 4.4 包策略边界

`services/packagePolicyService.js` 采用显式白名单：

| 包类型 | 包含 | 明确排除 |
|--------|------|----------|
| 提示词配置包 | 模块/全局前后缀、提示预设、消息链、分类提示层与提示示例 | API provider/address/model/key、AI 路由敏感设置、小说处理结果 |
| 工程资源包 | 章节队列、导演切拍决策、世界书、继续处理参数与分类结构配置 | API、可编辑提示词、分类提示文本/示例、消息链、缓存导演注入与含提示预览的诊断日志 |

导入旧配置文件时只迁移可编辑提示词；导入旧工程包或历史快照时只恢复资源白名单，不能覆盖本机 API 或提示词设置。

### 4.5 验证范围

自动验证只运行 Node 服务测试、包策略测试与 UTF-8/BOM 字节检查。真实 SillyTavern 手机使用环境中的 UI 点击、布局与 PromptManager 联动由使用者手动验收，不新增桌面浏览器自动化测试。

---

## 五、API 超时

### 5.1 历史问题

导演 API 超时曾硬编码为 20 秒：
```javascript
// 旧代码（已修复）
const directorTimeoutCap = parseTimeout(..., 20000);  // ← 20秒上限
const timeout = target === 'director'
    ? Math.min(baseTimeout, directorTimeoutCap)       // ← 被限制
    : baseTimeout;
```

### 5.2 当前行为

```javascript
// 新代码（apiService.js）
const timeout = AppState.settings.apiTimeout || 120000;  // 所有请求统一超时
```

用户可在 ⚙️ 设置 → `API超时(秒)` 中统一设置（范围 30-600 秒）。

---

## 六、旧导演后缀字段兼容

旧版本曾通过 `customDirectorFrameworkSuffix`、`customDirectorInjectionSuffix` 与 `directorSuffixEnabled` 管理两块导演后缀。当前版本加载旧设置时会迁移既有正文/后缀到注册表覆盖层；新增或修改提示文案应统一走模块的 `prefix/body/suffix`，不再在服务层增加独立开关或字符串拼接路径。

---

## 七、UI 结构

### 7.1 标签页导航

```
📚 TXT转世界书  ⏳ 处理进度  🧭 故事大纲  🎬 当前章节概览  🛠️ 提示词编辑  ⚙️ 设置
```

### 7.2 提示词编辑标签页结构

```
全局前缀 / 全局后缀
├── 已注册模块列表（每项：前缀 / 正文 / 后缀 / 保存 / 恢复默认 / 警告）
│   ├── TXT 转世界书、分类提取、修复、重 roll
│   ├── 整理条目、别名合并
│   ├── 导演章节资产、导演框架、导演注入、本地兜底与上下文片段
│   └── 开场白及其他请求包装片段
└── 分类提示层（每项：前缀 / 正文 / 后缀 / 保存 / 恢复默认）
```

### 7.3 设置标签页结构

```
🍺 使用酒馆API
🔧 AI路由配置
   ├── 💾 AI路由预设
   ├── 主AI / 导演AI 标签切换
   ├── API提供商 / Key / Endpoint / Model / MaxTokens
   └── 导演三态（API / 本地兜底 / 关闭）与 API 失败兜底开关
🚀 并行处理
⚙️ 基本设置（chunk size / min chunk / API超时）
📝 增量输出 / 📦 分卷 / 📌 强制章节标记 / 🔄 允许递归
🔃 重新提取时清空已有数据
🧹 响应过滤标签
🔍 调试模式
```

---

## 八、常见修改入口速查

| 需求 | 文件 | 关键位置 |
|------|------|---------|
| 添加新设置项 | `core/constants.js` → defaultSettings | 第 ~480 行 |
| 添加设置UI | `ui/settingsPanel.js` → buildSettingsHtml() | 函数内 |
| 添加hydrate | `ui/settingsPanel.js` → hydrateSettingsFromState() | 函数末尾 |
| 添加事件绑定 | `ui/eventBindings.js` → bindSettingEvents() | 函数内 |
| 添加持久化 | `services/settingsPersistenceService.js` | save/load 两处 |
| 新增或修改默认提示模块 | `services/promptRegistryService.js` | `PROMPT_MODULE_IDS` / `DEFAULT_PROMPT_MODULE_DEFINITIONS` |
| 修改请求调用位置 | 对应 service + `promptRegistryService` | 完整请求用 `composeRequest/composeFragments` |
| 修改导演执行与注入路由 | `services/directorService.js` | 保持 PromptManager/LittleWhite 协议不变 |
| 修改导入导出边界 | `services/packagePolicyService.js` | 只用显式白名单 |
| 添加预设系统 | `ui/settingsPanel.js` + `ui/eventBindings.js` | 遵循通用模式 |
| 修改 API 超时 | `services/apiService.js` → callCustomAPI() | timeout 变量 |
| 修改按钮行为 | `app/runtimeActionsFacade.js` → handleStartConversion | |

---

## 九、版本记录

| 日期 | 提交 | 变更 |
|------|------|------|
| 2026-05-24 | `7cbd6ee` | 提示词配置包与工程资源包按白名单隔离 |
| 2026-05-24 | `7606845` | 导演三态与无全局层的演员注入兼容 |
| 2026-05-24 | `43c3797` | 全量分层提示词注册表基础 |
| 2026-05-04 | `deff1e9` | 新增「重新提取世界书」forceReExtract 选项 |
| 2026-05-04 | `ac7387a` | 暴露别名合并提示词（两两判断模式）为可配置 |
| 2026-05-04 | `7de1a8e` | 统一 API 超时 + 提示词开头预设 + AI路由预设 |
| 2026-05-04 | `79754d0` | 导演框架&注入提示词后缀（自由附加内容） |
| 2026-05-04 | `3845370` | 导演后缀开关 + extension-quick-toggle 联动 |
| 2026-05-04 | `a19d79a` | 修复：directorSuffixEnabled 双向同步 |
| 2026-05-04 | `75855b1` | extension-quick-toggle：softToggle 持久化修复 |
| 2026-05-04 | `d7b0b42` | 修复预设持久化：改用专用 localStorage 键 |
| 2026-05-04 | `5b139c8` | 导演提示词预设管理系统 |
