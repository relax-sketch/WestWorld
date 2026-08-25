import test from 'node:test';
import assert from 'node:assert/strict';

import { createInitialAppState } from '../txtToWorldbook/core/state.js';
import { createBatchRuntimeService } from '../txtToWorldbook/services/batchRuntimeService.js';

const delay = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

function createSourceState() {
    const state = createInitialAppState({
        defaultSettings: {
            batchFileConcurrency: 2,
            chapterAssetsConcurrency: 1,
            chapterAssetsWaitForPrevious: false,
            chapterAssetsMode: 'ai-anchor',
        },
        defaultParallelConfig: {
            enabled: true,
            concurrency: 2,
            mainConcurrency: 1,
            directorConcurrency: 1,
            mode: 'independent',
        },
    });
    state.settings.batchFileConcurrency = 2;
    state.settings.chapterAssetsConcurrency = 1;
    state.settings.chapterAssetsWaitForPrevious = false;
    state.config.parallel = {
        enabled: true,
        concurrency: 2,
        mainConcurrency: 1,
        directorConcurrency: 1,
        mode: 'independent',
    };
    return state;
}

test('batch runtime isolates file state and keeps chapter failures inside one FileJob', async () => {
    const AppState = createSourceState();
    let activeChapters = 0;
    let maxActiveChapters = 0;
    const seen = [];
    let processingStarted;
    const processingStartedPromise = new Promise((resolve) => { processingStarted = resolve; });

    const packagePolicyService = {
        buildResourcePackage(state) {
            return {
                type: 'WestWorld.taskState',
                version: '3.6.0',
                memoryQueue: JSON.parse(JSON.stringify(state.memory.queue)),
                generatedWorldbook: {},
                worldbookVolumes: [],
                currentVolumeIndex: 0,
                fileHash: state.file.hash,
                originalFileName: state.file.current?.name || null,
                novelName: state.file.novelName,
                resourceSettings: { chapterAssetsMode: state.settings.chapterAssetsMode },
                parallelConfig: { ...state.config.parallel },
            };
        },
    };

    const runtime = createBatchRuntimeService({
        AppState,
        packagePolicyService,
        MemoryHistoryDB: {
            async saveJobSnapshot() {},
            async saveBatchSnapshot() {},
        },
        fileUtils: {
            async detectBestEncoding(file) {
                return { encoding: 'utf-8', content: `content:${file.name}` };
            },
            async calculateFileHash(content) {
                return `hash:${content}`;
            },
        },
        createMemoryQueueFromContent(content) {
            return [{
                title: 'chapter',
                content,
                processed: false,
                failed: false,
                chapterOutlineStatus: 'pending',
                chapterScript: { keyNodes: [], beats: [] },
            }];
        },
        createProcessingServiceForState(state) {
            return {
                async processDirectorChunk(index) {
                    processingStarted();
                    seen.push({ novelName: state.file.novelName, content: state.memory.queue[index].content });
                    activeChapters += 1;
                    maxActiveChapters = Math.max(maxActiveChapters, activeChapters);
                    await delay(3);
                    activeChapters -= 1;
                    if (state.file.novelName === 'B') {
                        state.memory.queue[index].chapterOutlineStatus = 'failed';
                        state.memory.queue[index].chapterOutlineError = 'B only';
                        return false;
                    }
                    state.memory.queue[index].chapterOutlineStatus = 'done';
                    return true;
                },
            };
        },
        showQueueSection() {},
        showResultSection() {},
        updateMemoryQueueUI() {},
        updateWorldbookPreview() {},
        renderBatchJobs() {},
    });

    await runtime.addFiles([{ name: 'A.txt' }, { name: 'B.txt' }]);
    await processingStartedPromise;
    AppState.settings.chapterAssetsMode = 'mutated-after-start';
    AppState.config.parallel.mainConcurrency = 9;
    await runtime.getScheduler().start();

    const jobs = runtime.getJobs();
    assert.equal(jobs.length, 2);
    assert.ok(maxActiveChapters <= 1, 'chapter-assets limit must be global across files');
    assert.deepEqual(seen.map((item) => item.novelName).sort(), ['A', 'B']);
    assert.deepEqual(seen.map((item) => item.content).sort(), ['content:A.txt', 'content:B.txt']);

    const jobA = jobs.find((job) => job.novelName === 'A');
    const jobB = jobs.find((job) => job.novelName === 'B');
    assert.equal(jobA.status, 'completed');
    assert.equal(jobB.status, 'completed');
    assert.equal(jobA.errors.length, 0);
    assert.equal(jobB.errors.length, 1);
    assert.equal(jobA.output.type, 'WestWorld.taskState');
    assert.equal(jobB.output.type, 'WestWorld.taskState');
    assert.equal(jobA.output.resourceSettings.chapterAssetsMode, 'ai-anchor');
    assert.equal(jobA.output.parallelConfig.mainConcurrency, 1);
});
