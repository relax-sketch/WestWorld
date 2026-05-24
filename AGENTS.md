# StoryWeaver 项目 - 编码与文件修改规则

## 最高优先级规则

所有涉及中文内容、提示词、世界书、角色设定、长文本块的修改，必须优先保证文件编码安全。不要根据终端显示判断文件是否损坏，必须以文件读取结果和字节检查为准。

## 编码陷阱

1. 某些文件可能使用 UTF-8 with BOM，例如：
   - `txtToWorldbook/core/constants.js`

   BOM 头为 `\xef\xbb\xbf`，可能导致精确文本替换失败，尤其是基于整块匹配的 `StrReplaceFile`。

2. 不要盲目移除 BOM。
   - 如果文件原本有 BOM，默认保留。
   - 除非任务明确要求统一编码，否则不要全仓批量转换 BOM / non-BOM。
   - 修改文件时应尽量保持原始编码形态。

3. PowerShell 终端显示中文乱码，不等于文件内容损坏。
   - Python / Node / PowerShell 的终端输出可能出现 `���` 或 mojibake。
   - 不要根据 Shell 输出判断中文是否正确。
   - 修改后必须用可靠文件读取方式验证。

## 禁止做法

1. 禁止在 PowerShell 中使用 `python -c "..."` 传递包含中文的长文本、三引号字符串或提示词内容。

   错误示例：

   ```powershell
   python -c "text = '''大量中文内容'''"