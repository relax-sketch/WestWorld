import test from 'node:test';
import assert from 'node:assert/strict';

import { createBatchPackageService } from '../txtToWorldbook/services/batchPackageService.js';

function state(name) {
    return {
        version: '3.6.0',
        type: 'WestWorld.taskState',
        timestamp: 123,
        memoryQueue: [{ title: name, content: '原文', processed: true }],
        generatedWorldbook: { role: { name } },
        worldbookVolumes: [],
        currentVolumeIndex: 0,
        fileHash: `${name}-hash`,
        originalFileName: `${name}.txt`,
        novelName: name,
        experience: { currentChapterIndex: 0 },
        processingState: { incrementalMode: true, volumeMode: false },
        queueState: { startIndex: 0, userSelectedIndex: null },
    };
}

function readUInt16(bytes, offset) {
    return bytes[offset] | (bytes[offset + 1] << 8);
}

function readUInt32(bytes, offset) {
    return (bytes[offset]
        | (bytes[offset + 1] << 8)
        | (bytes[offset + 2] << 16)
        | (bytes[offset + 3] << 24)) >>> 0;
}

test('single taskState JSON keeps the original structure without batch fields', () => {
    const service = createBatchPackageService();
    const original = state('single');
    const serialized = service.serializeTaskState(original);
    const parsed = service.parseTaskState(serialized);
    assert.deepEqual(parsed, original);
    assert.equal(Object.hasOwn(parsed, 'batch'), false);
    assert.equal(Object.hasOwn(parsed, 'manifest'), false);
});

test('batch export contains manifest count/status and round-trips a store-only ZIP', () => {
    const service = createBatchPackageService();
    const first = { jobId: 'job-a', fileHash: 'hash-a', novelName: 'A', status: 'completed', progress: { percent: 100 }, snapshot: state('A') };
    const second = { jobId: 'job-b', fileHash: 'hash-b', novelName: 'B', status: 'completed', progress: { percent: 100 }, output: state('B') };
    const exported = service.exportBatch([first, second]);

    assert.equal(exported.manifest.count, 2);
    assert.equal(exported.manifest.status, 'completed');
    assert.equal(exported.manifest.counts.completed, 2);
    assert.equal(exported.manifest.items.length, 2);
    assert.equal(exported.manifest.items[0].packageFile, 'jobs/job-a.json');
    assert.equal(exported.manifest.jobs[0].path, 'jobs/job-a.json');

    const bytes = exported.bytes;
    assert.equal(readUInt32(bytes, 0), 0x04034b50);
    assert.equal(readUInt16(bytes, 8), 0, 'local header must use ZIP store method');
    const parsed = service.parseZip(bytes);
    assert.equal(parsed.manifest.count, 2);
    assert.deepEqual(parsed.jobs.map((job) => job.taskState), [state('A'), state('B')]);
    assert.equal(Object.hasOwn(parsed.jobs[0].taskState, 'batch'), false);
});

test('the parser accepts the generated ZIP as an ArrayBuffer and preserves legacy raw JSON', () => {
    const service = createBatchPackageService();
    const taskState = state('legacy-compatible');
    const rawJson = JSON.stringify(taskState);
    assert.deepEqual(service.parseTaskState(rawJson), taskState);
    const storyWeaverState = { ...taskState, type: 'StoryWeaver.taskState' };
    assert.deepEqual(service.parseTaskState(JSON.stringify(storyWeaverState)), storyWeaverState);

    const exported = service.exportBatch([{
        jobId: 'legacy-job',
        status: 'completed',
        snapshot: taskState,
    }]);
    const parsed = service.parseBatchPackage(exported.bytes.buffer);
    assert.deepEqual(parsed.jobs[0].taskState, taskState);
    assert.deepEqual(Object.keys(parsed.jobs[0].taskState), Object.keys(taskState));
});
