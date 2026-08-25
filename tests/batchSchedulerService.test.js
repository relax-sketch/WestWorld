import test from 'node:test';
import assert from 'node:assert/strict';

import { createBatchSchedulerService } from '../txtToWorldbook/services/batchSchedulerService.js';

const delay = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

function taskState(name) {
    return {
        version: '3.6.0',
        type: 'WestWorld.taskState',
        timestamp: 1,
        memoryQueue: [{ title: name, content: `${name}-content`, processed: true }],
        generatedWorldbook: { role: { [name]: true } },
        worldbookVolumes: [],
        currentVolumeIndex: 0,
        fileHash: `${name}-hash`,
        novelName: name,
    };
}

test('batch jobs keep independent state while file and API concurrency stay bounded', async () => {
    let fileActive = 0;
    let maxFileActive = 0;
    const apiActive = { 'chapter-assets': 0, main: 0, director: 0 };
    const maxApiActive = { 'chapter-assets': 0, main: 0, director: 0 };
    const seenJobIds = [];

    const service = createBatchSchedulerService({
        maxConcurrentFiles: 2,
        chapterAssetsConcurrency: 1,
        mainConcurrency: 1,
        directorConcurrency: 1,
        processJob: async (job, context) => {
            seenJobIds.push(job.jobId);
            fileActive += 1;
            maxFileActive = Math.max(maxFileActive, fileActive);
            await delay(2);
            fileActive -= 1;

            for (const kind of ['chapter-assets', 'main', 'director']) {
                await context.runWithSemaphore(kind, async () => {
                    apiActive[kind] += 1;
                    maxApiActive[kind] = Math.max(maxApiActive[kind], apiActive[kind]);
                    await delay(3);
                    apiActive[kind] -= 1;
                });
            }
            context.updateProgress({ completed: 1, total: 1 });
            return { output: taskState(job.novelName), snapshot: taskState(job.novelName) };
        },
    });

    const first = service.addJob({ fileHash: 'hash-a', novelName: 'A', memoryQueue: [{ content: 'a' }] });
    const second = service.addJob({ fileHash: 'hash-b', novelName: 'B', memoryQueue: [{ content: 'b' }] });
    const result = await service.start();

    assert.equal(result.length, 2);
    assert.deepEqual(seenJobIds.sort(), [first.jobId, second.jobId].sort());
    assert.ok(maxFileActive <= 2);
    assert.ok(maxApiActive['chapter-assets'] <= 1);
    assert.ok(maxApiActive.main <= 1);
    assert.ok(maxApiActive.director <= 1);
    assert.equal(service.getJob(first.jobId).status, 'completed');
    assert.equal(service.getJob(second.jobId).status, 'completed');
    assert.equal(service.getJob(first.jobId).output.novelName, 'A');
    assert.equal(service.getJob(second.jobId).output.novelName, 'B');
    assert.notEqual(service.getJob(first.jobId).runId, service.getJob(second.jobId).runId);
});

test('pause/resume uses a job-local checkpoint and cancellation does not stop another job', async () => {
    let firstStarted;
    const started = new Promise((resolve) => { firstStarted = resolve; });
    const service = createBatchSchedulerService({
        maxConcurrentFiles: 2,
        processJob: async (job, context) => {
            const total = 8;
            for (let index = 0; index < total; index += 1) {
                context.throwIfCancelled();
                await context.checkpoint();
                if (index === 0) firstStarted();
                await delay(3);
                context.updateProgress({ completed: index + 1, total });
            }
            return { output: taskState(job.novelName) };
        },
    });
    const first = service.addJob({ novelName: 'pause-me' });
    const second = service.addJob({ novelName: 'keep-running' });
    const firstRun = service.start(first.jobId);
    const secondRun = service.start(second.jobId);
    await started;
    service.pause(first.jobId);
    await delay(1);
    assert.equal(service.getJob(first.jobId).status, 'paused');
    service.resume(first.jobId);
    service.cancel(first.jobId);

    const [firstResult, secondResult] = await Promise.all([firstRun, secondRun]);
    assert.equal(firstResult.status, 'cancelled');
    assert.equal(secondResult.status, 'completed');
    assert.equal(service.getJob(second.jobId).output.novelName, 'keep-running');
    assert.equal(service.getJob(first.jobId).output, undefined);
});

test('an injected minimal semaphore implementation is accepted', async () => {
    let acquired = 0;
    const semaphore = {
        async acquire() { acquired += 1; },
        release() { acquired -= 1; },
    };
    const service = createBatchSchedulerService({
        maxConcurrentFiles: 1,
        semaphores: { files: semaphore, main: semaphore, director: semaphore, 'chapter-assets': semaphore },
        processJob: async (_job, context) => {
            await context.runWithSemaphore('main', async () => {});
            return { output: { type: 'WestWorld.taskState', memoryQueue: [] } };
        },
    });
    const job = service.addJob({ novelName: 'injected' });
    await service.start(job.jobId);
    assert.equal(acquired, 0);
    assert.equal(service.getJob(job.jobId).status, 'completed');
});

test('resume can start a queued job restored from a batch snapshot', async () => {
    let calls = 0;
    const service = createBatchSchedulerService({
        processJob: async () => {
            calls += 1;
            return { output: { type: 'WestWorld.taskState', memoryQueue: [] } };
        },
    });
    const job = service.addJob({ novelName: 'restored-queued', status: 'queued' });

    service.resume(job.jobId);
    const result = await service.waitForJob(job.jobId);

    assert.equal(calls, 1);
    assert.equal(result.status, 'completed');
});

test('pausing a job does not start chapters queued behind the shared chapter budget', async () => {
    let started = 0;
    let firstStarted;
    const first = new Promise((resolve) => { firstStarted = resolve; });
    const service = createBatchSchedulerService({
        maxConcurrentFiles: 2,
        chapterAssetsConcurrency: 1,
        processJob: async (_job, context) => {
            for (let index = 0; index < 3; index += 1) {
                await context.runWithSemaphore('chapter-assets', async () => {
                    started += 1;
                    if (index === 0) firstStarted();
                    await delay(4);
                });
            }
            return { output: { type: 'WestWorld.taskState', memoryQueue: [] } };
        },
    });
    const job = service.addJob({ novelName: 'pause-queued' });
    const run = service.start(job.jobId);
    await first;
    service.pause(job.jobId);
    await delay(8);
    assert.equal(started, 1);
    service.resume(job.jobId);
    const result = await run;
    assert.equal(result.status, 'completed');
    assert.equal(started, 3);
});

test('retry waits for a cancelled run to unwind before replacing its run token', async () => {
    let active = 0;
    let maxActive = 0;
    const service = createBatchSchedulerService({
        maxConcurrentFiles: 1,
        processJob: async (_job, context) => {
            active += 1;
            maxActive = Math.max(maxActive, active);
            await delay(8);
            active -= 1;
            context.throwIfCancelled();
            return { output: { type: 'WestWorld.taskState', memoryQueue: [] } };
        },
    });
    const job = service.addJob({ novelName: 'cancel-then-retry' });
    const firstRun = service.start(job.jobId);
    await delay(1);
    service.cancel(job.jobId);
    const retryRun = service.retry(job.jobId, { failedOnly: false });
    const [cancelled, retried] = await Promise.all([firstRun, retryRun]);
    assert.equal(cancelled.status, 'cancelled');
    assert.equal(retried.status, 'completed');
    assert.equal(maxActive, 1);
});
