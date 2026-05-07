import test from 'node:test';
import assert from 'node:assert/strict';

import {
    DIRECTOR_INJECTION_MARKER,
    inspectDirectorInjection,
    insertDirectorInjection,
    stripExistingDirectorInjection,
    withDirectorInjectionMarker,
} from '../txtToWorldbook/services/directorInjectionService.js';

test('insertDirectorInjection removes old director messages and inserts system marker at the front', () => {
    const chat = [
        { role: 'system', content: 'old', is_westworld_director: true },
        { role: 'user', content: 'hello' },
    ];
    const content = withDirectorInjectionMarker('new director body', {
        runId: 'run-1',
        chapterIndex: 0,
        beatIndex: 1,
    });

    const result = insertDirectorInjection(chat, content, {
        runId: 'run-1',
        chapterIndex: 0,
        beatIndex: 1,
        source: 'model',
    });

    assert.equal(result.injected, true);
    assert.equal(result.insertionIndex, 0);
    assert.equal(result.role, 'system');
    assert.equal(result.markerFoundAfterInsert, true);
    assert.equal(result.removedExisting, 1);
    assert.equal(chat.length, 2);
    assert.equal(chat[0].is_westworld_director, true);
    assert.equal(chat[0].content.includes(DIRECTOR_INJECTION_MARKER), true);
});

test('inspectDirectorInjection returns a diagnosable miss for invalid or empty chat', () => {
    assert.equal(inspectDirectorInjection(null).reason, 'chat-not-array');
    const inspected = inspectDirectorInjection([{ role: 'user', content: 'hello' }]);
    assert.equal(inspected.injected, false);
    assert.equal(inspected.reason, 'director-injection-not-found');
});

test('stripExistingDirectorInjection detects legacy prompt text', () => {
    const chat = [
        { role: 'system', content: '# WestWorld 导演提示（硬导演模式）\nold' },
        { role: 'assistant', content: 'kept' },
    ];
    const result = stripExistingDirectorInjection(chat);
    assert.equal(result.removed, 1);
    assert.deepEqual(chat, [{ role: 'assistant', content: 'kept' }]);
});
