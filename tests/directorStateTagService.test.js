import test from 'node:test';
import assert from 'node:assert/strict';

import {
    extractDirectorStateTag,
    getDirectorStateDisplayText,
} from '../txtToWorldbook/services/directorStateTagService.js';

test('extracts state from default tags', () => {
    const result = extractDirectorStateTag('some reply\n<state>未结束</state>');

    assert.equal(result.found, true);
    assert.equal(result.value, '未结束');
    assert.equal(result.display, '未结束');
});

test('uses the last tagged state and truncates display after four characters', () => {
    const result = extractDirectorStateTag('<state>旧状态</state>\n<state>未完全结束</state>');

    assert.equal(result.found, true);
    assert.equal(result.value, '未完全结束');
    assert.equal(result.display, '未完全结..');
});

test('supports custom literal tags without regex configuration', () => {
    const result = extractDirectorStateTag('reply [[state]]阶段完成[[/state]]', {
        startTag: '[[state]]',
        endTag: '[[/state]]',
    });

    assert.equal(result.found, true);
    assert.equal(result.value, '阶段完成');
    assert.equal(result.display, '阶段完成');
});

test('unknown display is used when tags are missing or empty', () => {
    assert.equal(extractDirectorStateTag('no tag').display, '未知');
    assert.equal(extractDirectorStateTag('<state>   </state>').display, '未知');
    assert.equal(getDirectorStateDisplayText('12345'), '1234..');
});
