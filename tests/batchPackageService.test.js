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
    assert.equal(exported.manifest.items[0].packageFile, 'A-工程包.json');
    assert.equal(exported.manifest.jobs[0].path, 'A-工程包.json');
    assert.deepEqual(exported.entries, ['manifest.json', 'A-工程包.json', 'B-工程包.json']);

    const bytes = exported.bytes;
    assert.equal(readUInt32(bytes, 0), 0x04034b50);
    assert.equal(readUInt16(bytes, 8), 0, 'local header must use ZIP store method');
    const parsed = service.parseZip(bytes);
    assert.equal(parsed.manifest.count, 2);
    assert.deepEqual(parsed.jobs.map((job) => job.taskState), [state('A'), state('B')]);
    assert.equal(Object.hasOwn(parsed.jobs[0].taskState, 'batch'), false);
});

test('batch package names are safe, recognizable, and unique for duplicate novels', () => {
    const service = createBatchPackageService();
    const exported = service.exportBatch([
        { jobId: 'job-a', novelName: '小说:A', status: 'completed', output: state('A') },
        { jobId: 'job-b', novelName: '小说:A', status: 'completed', output: state('B') },
    ]);

    assert.deepEqual(exported.entries, ['manifest.json', '小说_A-工程包.json', '小说_A-工程包-2.json']);
    assert.deepEqual(exported.manifest.items.map((item) => item.packageFile), exported.entries.slice(1));
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

test('the parser still accepts earlier batch ZIP paths based on job ids', () => {
    const service = createBatchPackageService();
    const taskState = state('old-zip');
    const manifest = {
        type: 'WestWorld.batchManifest',
        version: '1.0.0',
        items: [{
            jobId: 'legacy-job',
            novelName: 'old-zip',
            status: 'completed',
            packageFile: 'jobs/legacy-job.json',
        }],
    };
    const bytes = service.createZip([
        { name: 'manifest.json', data: JSON.stringify(manifest) },
        { name: 'jobs/legacy-job.json', data: JSON.stringify(taskState) },
    ]);

    const parsed = service.parseBatchPackage(bytes);
    assert.deepEqual(parsed.jobs[0].taskState, taskState);
});
