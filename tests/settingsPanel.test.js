import test from 'node:test';
import assert from 'node:assert/strict';

import { buildSettingsHtml } from '../txtToWorldbook/ui/settingsPanel.js';

test('specialized preset settings explain the required local-polish mode and blank override', () => {
    const html = buildSettingsHtml();

    assert.equal(html.includes('value="local-presplit-ai-polish">本地预切 + AI补全'), true);
    assert.equal(html.includes('使用特化预设（仅本地预切 + AI补全生效）'), true);
    assert.equal(html.includes('留空且勾选特化预设才使用 user→assistant→user 三消息链'), true);
});
