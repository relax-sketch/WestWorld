import test from 'node:test';
import assert from 'node:assert/strict';

import { buildPromptEditorHtml } from '../txtToWorldbook/ui/promptEditorView.js';

test('prompt editor renders layered controls and warning messages for every module', () => {
    const html = buildPromptEditorHtml({
        globalLayers: { suffix: 'GLOBAL END' },
        modules: [{
            id: 'worldbook.system',
            title: 'worldbook.system',
            prefix: 'BEFORE',
            body: 'BODY',
            suffix: 'AFTER',
            warnings: [{ type: 'missing-placeholder', placeholder: '{VALUE}' }],
        }],
        categories: [{
            name: 'Role',
            enabled: true,
            promptLayers: { prefix: 'C BEFORE', body: 'C BODY', suffix: 'C AFTER' },
        }],
    });

    assert.equal(html.includes('ttw-global-suffix-prompt'), true);
    assert.equal(html.includes('data-module-id="worldbook.system"'), true);
    assert.equal(html.includes('data-layer="prefix"'), true);
    assert.equal(html.includes('data-layer="body"'), true);
    assert.equal(html.includes('data-layer="suffix"'), true);
    assert.equal(html.includes('{VALUE}'), true);
    assert.equal(html.includes('data-category-index="0"'), true);
});
