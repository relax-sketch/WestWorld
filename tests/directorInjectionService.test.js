import test from 'node:test';
import assert from 'node:assert/strict';

import {
    DIRECTOR_INJECTION_MARKER,
    inspectDirectorInjection,
    insertDirectorInjection,
    resolveDirectorInjectionIndex,
    stripExistingDirectorInjection,
    withDirectorInjectionMarker,
} from '../txtToWorldbook/services/directorInjectionService.js';

test('insertDirectorInjection removes old director messages and inserts system marker at the end by default', () => {
    const chat = [
        { role: 'system', content: 'old', is_westworld_director: true },
        { role: 'user', content: 'hello' },
        { role: 'assistant', content: 'hi' },
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
    assert.equal(result.insertionIndex, 2);
    assert.equal(result.role, 'system');
    assert.equal(result.markerFoundAfterInsert, true);
    assert.equal(result.removedExisting, 1);
    assert.equal(result.depth, 0);
    assert.equal(result.order, 100);
    assert.equal(result.depthFromEnd, 0);
    assert.equal(result.placement, 'post-depth');
    assert.equal(chat.length, 3);
    assert.equal(chat[2].is_westworld_director, true);
    assert.equal(chat[2].content.includes(DIRECTOR_INJECTION_MARKER), true);
});

test('insertDirectorInjection supports post-depth placement', () => {
    const makeChat = () => [
        { role: 'system', content: 'system' },
        { role: 'user', content: 'u1' },
        { role: 'assistant', content: 'a1' },
        { role: 'user', content: 'u2' },
    ];
    const content = withDirectorInjectionMarker('director body', {
        runId: 'run-depth',
        chapterIndex: 0,
        beatIndex: 0,
    });

    const depthOneChat = makeChat();
    const depthOne = insertDirectorInjection(depthOneChat, content, { depth: 1, order: 50 });
    assert.equal(depthOne.insertionIndex, 3);
    assert.equal(depthOne.depth, 1);
    assert.equal(depthOne.order, 50);
    assert.equal(depthOne.depthFromEnd, 1);
    assert.equal(depthOneChat[3].is_westworld_director, true);

    const depthTwoChat = makeChat();
    const depthTwo = insertDirectorInjection(depthTwoChat, content, { depth: 2 });
    assert.equal(depthTwo.insertionIndex, 2);
    assert.equal(depthTwo.depthFromEnd, 2);
    assert.equal(depthTwoChat[2].is_westworld_director, true);
});

test('insertDirectorInjection clamps invalid or oversized depth values', () => {
    const content = withDirectorInjectionMarker('director body', {
        runId: 'run-clamp',
        chapterIndex: 0,
        beatIndex: 0,
    });

    const invalidChat = [{ role: 'user', content: 'hello' }];
    const invalid = insertDirectorInjection(invalidChat, content, { depth: 'not-a-number' });
    assert.equal(invalid.insertionIndex, 1);
    assert.equal(invalid.depth, 0);

    const oversizedChat = [{ role: 'user', content: 'hello' }];
    const oversized = insertDirectorInjection(oversizedChat, content, { depth: 999 });
    assert.equal(oversized.insertionIndex, 0);
    assert.equal(oversized.depth, 100);
    assert.equal(resolveDirectorInjectionIndex(1, 999), 0);
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
