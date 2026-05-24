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

test('prompt editor explains prompt composition and groups modules with Chinese labels', () => {
    const html = buildPromptEditorHtml({
        globalLayers: { suffix: 'GLOBAL END' },
        modules: [
            { id: 'common.language.zh', body: '请用中文回复。' },
            { id: 'worldbook.system', body: 'BODY' },
            { id: 'merge.consolidate', body: 'BODY' },
            { id: 'director.framework', body: 'BODY' },
            { id: 'director.injection.current-missing', body: 'BODY' },
            { id: 'chapter.opening', body: 'BODY' },
        ],
        categories: [{ name: '角色', promptLayers: { body: 'C BODY' } }],
    });

    assert.equal(html.includes('提示词如何生成'), true);
    assert.equal(html.includes('全局前缀'), true);
    assert.equal(html.includes('运行时数据通过占位符注入'), true);
    assert.equal(html.includes('导演注入到 SillyTavern / LittleWhite'), true);
    assert.equal(html.includes('通用层'), true);
    assert.equal(html.includes('整理 / 合并'), true);
    assert.equal(html.includes('导演切拍与演出'), true);
    assert.equal(html.includes('导演注入缺省片段'), true);
    assert.equal(html.includes('章节交互'), true);
    assert.equal(html.includes('世界书主请求'), true);
    assert.equal(html.includes('整理条目请求'), true);
    assert.equal(html.includes('导演判定请求'), true);
    assert.equal(html.includes('当前节拍原文缺省'), true);
    assert.equal(html.includes('章节开场白'), true);
    assert.equal(html.includes('ttw-prompt-group-separator'), true);
});
