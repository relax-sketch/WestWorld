import test from 'node:test';
import assert from 'node:assert/strict';

import { createFileImportService } from '../txtToWorldbook/services/fileImportService.js';

function createQueue(content, { chunkSize = 80, minChunkSize = 0 } = {}) {
    const AppState = {
        settings: { chunkSize, minChunkSize },
        config: {
            chapterRegex: {
                pattern: '^[\\s\\u3000\\uFEFF]*第\\s*\\d+\\s*章[^\\n\\r]{0,80}',
            },
        },
        memory: { queue: [] },
    };
    const service = createFileImportService({ AppState });
    return service.createMemoryQueueFromContent(content);
}

test('size-based splitting starts at the first character and preserves all source text', () => {
    const content = [
        '书名和索引页',
        '================',
        '第一章：',
        '第一章正文。'.repeat(20),
        '第二章：',
        '第二章正文。'.repeat(20),
    ].join('\n');

    const queue = createQueue(content, { chunkSize: 80, minChunkSize: 0 });

    assert.ok(queue.length > 1);
    assert.equal(queue[0].content.startsWith('书名和索引页'), true);
    assert.equal(queue.map((memory) => memory.content).join(''), content);
    assert.deepEqual(
        queue.map((memory) => memory.chapterTitle),
        queue.map((_, index) => `第${index + 1}章`),
    );
});

test('short-chunk merging keeps exact text and renumbers generated chapters continuously', () => {
    const content = `开头。${'正文内容。'.repeat(35)}短尾巴`;
    const queue = createQueue(content, { chunkSize: 70, minChunkSize: 40 });

    assert.equal(queue.map((memory) => memory.content).join(''), content);
    assert.deepEqual(
        queue.map((memory) => memory.chapterTitle),
        queue.map((_, index) => `第${index + 1}章`),
    );
});
