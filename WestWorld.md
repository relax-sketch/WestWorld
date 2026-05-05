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
│   │   ├── constants.js          # ★ defaultSettings, 所有默认提示词
│   │   └── state.js              # createInitialAppState()
│   ├── services/
│   │   ├── apiService.js         # ★ API调用（含超时逻辑）
│   │   ├── directorService.js    # ★ 导演框架&注入提示词构建
│   │   ├── promptService.js      # ★ getLanguagePrefix / buildSystemPrompt
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

### 4.1 提示词注入点

| 注入函数 | 位置 | 影响范围 |
|---------|------|---------|
| `getLanguagePrefix()` | promptService.js | 所有 AI 请求 |
| `buildSystemPrompt()` | promptService.js | 世界书提取提示词 |
| 导演框架模板 | directorService.js | 导演框架生成 |
| 导演注入模板 | directorService.js | 演员前置提示词 |

### 4.2 getLanguagePrefix 组成

```javascript
function getLanguagePrefix() {
    const langPrefix = ...;              // "请用中文回复。\n\n"
    const customPrefix = AppState.settings.promptPrefixPreset;  // 用户设置的开头
    return langPrefix + customPrefix + '\n\n';
}
```

### 4.3 提示词后缀（自由附加内容）

导演框架和注入提示词各有后缀 textarea，内容追加到提示词末尾：
- `customDirectorFrameworkSuffix` → 框架提示词
- `customDirectorInjectionSuffix` → 注入提示词
- 受 `directorSuffixEnabled` 开关控制

### 4.4 模板占位符

提示词中 `{PLACEHOLDER}` 由 `renderPromptTemplate()` 替换。各提示词的占位符在 settingsPanel 中通过 `.ttw-placeholder-hint` 展示。

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

## 六、extension-quick-toggle 联动

### 6.1 软开关模式

extension-quick-toggle（`extension-quick-toggle/index.js`）在左下菜单放置开关按钮：

```javascript
{
    key: 'WestWorld-director-suffix',
    label: '导演自由内容',
    icon: 'fa-solid fa-file-pen',
    toggleType: 'soft',
    settingsPath: 'westworld',
    settingsKey: 'directorSuffixEnabled',
    checkboxId: '',  // 无 DOM checkbox，直接操作 settings
}
```

### 6.2 checkbox-less toggle 关键修复

当 `checkboxId` 为空且目标 checkbox 不存在于 DOM 时：
```javascript
function softToggle(cfg) {
    const $cb = $(cfg.checkboxId);
    if ($cb.length) {
        // 有 checkbox：操作 DOM
        $cb.prop('checked', !isChecked).trigger('change');
        return true;
    }
    // 无 checkbox：直接改 settings 值
    const s = getSettings(cfg);
    s[cfg.settingsKey] = !s[cfg.settingsKey];
    saveSettingsDebounced();  // ★ 必须调用，否则不持久化
    return true;
}
```

### 6.3 双向同步

`directorSuffixEnabled` 在 `extension_settings.westworld`（快速开关修改）和 `AppState.settings`（localStorage 持久化）之间需要双向同步：
- 加载时：`extension_settings` → `AppState.settings`
- directorService 检查两处都必须是 `true` 才追加后缀

---

## 七、UI 结构

### 7.1 标签页导航

```
📚 TXT转世界书  ⏳ 处理进度  🧭 故事大纲  🎬 当前章节概览  🛠️ 提示词编辑  ⚙️ 设置
```

### 7.2 提示词编辑标签页结构

```
📝 提示词开头（共享前缀 + 预设管理）
├── 📚 txt转世界书主要提示词
├── 🏷️ 提取分类（平铺复选框）
├── 🧹 整理条目AI提示词
├── 🔗 别名合并AI提示词
├── ✂️ 导演切拍章节资产提示词
├── 🎬 导演AI框架提示词（含预设 + 后缀）
├── 🧭 导演注入演员前置提示词（含预设 + 后缀）
└── 📚 向世界书中添加默认条目
```

### 7.3 设置标签页结构

```
🍺 使用酒馆API
🔧 AI路由配置
   ├── 💾 AI路由预设
   ├── 主AI / 导演AI 标签切换
   ├── API提供商 / Key / Endpoint / Model / MaxTokens
   └── 导演开关（启用/兜底/每回合）
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
| 修改提示词注入 | `services/promptService.js` → getLanguagePrefix() | |
| 修改导演提示词 | `services/directorService.js` | buildFrameworkPrompt / buildDirectionScript |
| 添加预设系统 | `ui/settingsPanel.js` + `ui/eventBindings.js` | 遵循通用模式 |
| 修改 API 超时 | `services/apiService.js` → callCustomAPI() | timeout 变量 |
| 修改按钮行为 | `app/runtimeActionsFacade.js` → handleStartConversion | |

---

## 九、版本记录

| 日期 | 提交 | 变更 |
|------|------|------|
| 2026-05-04 | `deff1e9` | 新增「重新提取世界书」forceReExtract 选项 |
| 2026-05-04 | `ac7387a` | 暴露别名合并提示词（两两判断模式）为可配置 |
| 2026-05-04 | `7de1a8e` | 统一 API 超时 + 提示词开头预设 + AI路由预设 |
| 2026-05-04 | `79754d0` | 导演框架&注入提示词后缀（自由附加内容） |
| 2026-05-04 | `3845370` | 导演后缀开关 + extension-quick-toggle 联动 |
| 2026-05-04 | `a19d79a` | 修复：directorSuffixEnabled 双向同步 |
| 2026-05-04 | `75855b1` | extension-quick-toggle：softToggle 持久化修复 |
| 2026-05-04 | `d7b0b42` | 修复预设持久化：改用专用 localStorage 键 |
| 2026-05-04 | `5b139c8` | 导演提示词预设管理系统 |
