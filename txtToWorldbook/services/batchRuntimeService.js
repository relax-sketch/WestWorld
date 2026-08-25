import { createInitialAppState } from '../core/state.js';
import { createBatchSchedulerService } from './batchSchedulerService.js';
import { createBatchPackageService } from './batchPackageService.js';

function clone(value, fallback = undefined) {
    if (value === undefined) return fallback;
    try {
        return JSON.parse(JSON.stringify(value));
    } catch (_) {
        return fallback;
    }
}

function makeBatchId() {
    return `batch-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

function makeRunState(sourceState, job) {
    const state = createInitialAppState({
        defaultCategoryLight: job.configSnapshot?.categoryLight || sourceState.config?.categoryLight,
        defaultPlotOutlineConfig: job.configSnapshot?.plotOutline || sourceState.config?.plotOutline,
        defaultParallelConfig: job.configSnapshot?.parallel || sourceState.config?.parallel,
        defaultChapterRegex: job.configSnapshot?.chapterRegex || sourceState.config?.chapterRegex,
        defaultWorldbookCategories: job.persistentSnapshot?.customCategories || sourceState.persistent?.customCategories,
        defaultSettings: job.settingsSnapshot || sourceState.settings,
    });
    state.memory.queue = clone(job.memoryQueue, []);
    state.file.hash = job.fileHash || null;
    state.file.novelName = job.novelName || '';
    state.file.current = {
        name: job.originalFileName || job.fileName || `${job.novelName || 'batch-job'}.txt`,
    };
    state.settings = clone(job.settingsSnapshot || sourceState.settings, {});
    state.config = clone(job.configSnapshot || sourceState.config, state.config);
    state.persistent = clone(job.persistentSnapshot || sourceState.persistent, state.persistent);
    state.processing.runId = job.runId || null;
    state.processing.isStopped = false;
    state.processing.status = 'running';
    state.processing.isRunning = true;
    return state;
}

function buildTaskState(packagePolicyService, runState, job) {
    const payload = packagePolicyService.buildResourcePackage({
        // The package must reflect the FileJob snapshot, not the currently
        // selected legacy AppState, which may belong to another file.
        ...runState,
        memory: {
            ...runState.memory,
            queue: runState.memory.queue,
        },
        worldbook: runState.worldbook,
        file: {
            ...runState.file,
            hash: job.fileHash || null,
            novelName: job.novelName || '',
            current: {
                name: job.originalFileName || job.fileName || `${job.novelName || 'batch-job'}.txt`,
            },
        },
        experience: runState.experience,
    });
    payload.type = 'WestWorld.taskState';
    payload.version = '3.6.0';
    payload.fileHash = job.fileHash || null;
    payload.originalFileName = job.originalFileName || job.fileName || null;
    payload.novelName = job.novelName || '';
    payload.queueState = {
        startIndex: 0,
        userSelectedIndex: null,
    };
    return payload;
}

export function createBatchRuntimeService(deps = {}) {
    const {
        AppState,
        MemoryHistoryDB,
        packagePolicyService,
        createProcessingServiceForState,
        createMemoryQueueFromContent,
        fileUtils,
        updateMemoryQueueUI,
        updateProgress,
        updateWorldbookPreview,
        showQueueSection,
        showResultSection,
        ErrorHandler,
        Logger,
        renderBatchJobs,
    } = deps;

    if (!AppState || typeof createProcessingServiceForState !== 'function') {
        throw new Error('批量运行时缺少 AppState 或 processing factory');
    }

    const packageService = deps.batchPackageService || createBatchPackageService();
    let scheduler = null;
    let activeBatchId = null;
    let selectedJobId = null;

    function resolveLimits() {
        const settings = AppState.settings || {};
        const parallel = AppState.config?.parallel || {};
        const positive = (value, fallback, max = 64) => {
            const parsed = parseInt(value, 10);
            return Number.isFinite(parsed) ? Math.max(1, Math.min(max, parsed)) : fallback;
        };
        return {
            files: positive(settings.batchFileConcurrency, 2, 5),
            chapterAssets: positive(settings.chapterAssetsConcurrency, 2, 64),
            main: positive(parallel.mainConcurrency ?? settings.parallelMainConcurrency ?? parallel.concurrency, 1, 10),
            director: positive(parallel.directorConcurrency ?? settings.parallelDirectorConcurrency ?? parallel.concurrency, 1, 10),
        };
    }

    function writeBatchProjection() {
        if (!scheduler) return;
        const jobs = scheduler.getJobs();
        const selected = selectedJobId ? jobs.find((job) => job.jobId === selectedJobId) : jobs[0];
        if (selected && !selectedJobId) selectedJobId = selected.jobId;
        AppState.batch = {
            ...(AppState.batch || {}),
            activeBatchId,
            selectedJobId,
            status: jobs.length === 0
                ? 'idle'
                : (jobs.some((job) => job.status === 'running')
                    ? 'running'
                    : (jobs.some((job) => job.status === 'queued' || job.status === 'paused') ? 'incomplete' : 'completed')),
            progress: jobs.length > 0
                ? jobs.reduce((sum, job) => sum + Number(job.progress?.percent || 0), 0) / jobs.length
                : 0,
            jobs,
            errors: jobs.flatMap((job) => Array.isArray(job.errors) ? job.errors.map((error) => ({ ...error, jobId: job.jobId })) : []),
        };
        renderBatchJobs?.(jobs);

        if (!selected) return;
        AppState.memory.queue = clone(selected.memoryQueue, []);
        AppState.file.hash = selected.fileHash || null;
        AppState.file.novelName = selected.novelName || '';
        AppState.file.current = { name: selected.originalFileName || selected.fileName || `${selected.novelName || 'batch-job'}.txt` };
        const taskState = ['WestWorld.taskState', 'StoryWeaver.taskState'].includes(selected.output?.type)
            ? selected.output
            : (['WestWorld.taskState', 'StoryWeaver.taskState'].includes(selected.output?.taskState?.type)
                ? selected.output.taskState
                : null);
        if (taskState) {
            AppState.worldbook.generated = clone(taskState.generatedWorldbook, {});
            AppState.worldbook.volumes = clone(taskState.worldbookVolumes, []);
            AppState.worldbook.currentVolumeIndex = Number(taskState.currentVolumeIndex || 0);
        }
        showQueueSection?.(true);
        updateMemoryQueueUI?.();
        if (taskState && Object.keys(AppState.worldbook.generated || {}).length > 0) {
            showResultSection?.(true);
            updateWorldbookPreview?.();
        }
    }

    function persistJob(job) {
        if (typeof MemoryHistoryDB?.saveJobSnapshot !== 'function') return;
        Promise.resolve(MemoryHistoryDB.saveJobSnapshot({ ...job, batchId: activeBatchId }))
            .catch((error) => Logger?.error?.('Batch', '保存 Job 快照失败:', error));
    }

    function persistBatch() {
        if (typeof MemoryHistoryDB?.saveBatchSnapshot !== 'function' || !scheduler || !activeBatchId) return;
        Promise.resolve(MemoryHistoryDB.saveBatchSnapshot({
            batchId: activeBatchId,
            status: AppState.batch?.status || 'running',
            selectedJobId,
            jobs: scheduler.getJobs(),
            updatedAt: Date.now(),
        })).catch((error) => Logger?.error?.('Batch', '保存批次快照失败:', error));
    }

    function ensureScheduler(batchId = activeBatchId || makeBatchId()) {
        if (scheduler && activeBatchId === batchId) return scheduler;
        activeBatchId = batchId;
        const limits = resolveLimits();
        scheduler = createBatchSchedulerService({
            files: limits.files,
            chapterAssets: limits.chapterAssets,
            main: limits.main,
            director: limits.director,
            onChange: (job) => {
                persistJob(job);
                writeBatchProjection();
                persistBatch();
            },
            processJob: runJob,
        });
        return scheduler;
    }

    async function runJob(job, context) {
        const runState = makeRunState(AppState, job);
        runState.processing.runId = context.runId;
        runState.processing.abortSignal = context.signal;
        runState.processing.mainApiSemaphore = context.semaphores.main;
        runState.processing.directorApiSemaphore = context.semaphores.director;
        runState.processing.chapterAssetsApiSemaphore = context.semaphores['chapter-assets'];
        runState.processing.mainApiConcurrency = resolveLimits().main;
        runState.processing.directorApiConcurrency = resolveLimits().director;
        runState.processing.chapterAssetsApiConcurrency = resolveLimits().chapterAssets;

        let completed = 0;
        const indices = job.retryFailedOnly
            ? runState.memory.queue
                .map((memory, index) => ({ memory, index }))
                .filter(({ memory }) => memory?.failed === true
                    || memory?.chapterOutlineStatus === 'failed'
                    || memory?.chapterOutlineStatus === 'polish_failed')
                .map(({ index }) => index)
            : Array.from({ length: runState.memory.queue.length }, (_, index) => index);
        const total = indices.length;
        const logs = [];
        const childHistory = {
            saveState: async () => {},
            saveRollResult: async () => {},
        };
        const processor = createProcessingServiceForState(runState, {
            MemoryHistoryDB: childHistory,
            updateMemoryQueueUI: () => {},
            updateProgress: () => {},
            updateStreamContent: (message) => {
                const text = String(message || '');
                if (text) logs.push(text);
            },
            updateWorldbookPreview: () => {},
            showProgressSection: () => {},
            updateStopButtonVisibility: () => {},
            updateVolumeIndicator: () => {},
            updateStartButtonState: () => {},
            showResultSection: () => {},
            setProcessingStatus: (status) => { runState.processing.status = status; },
            getProcessingStatus: () => runState.processing.status,
        });

        const processOne = async (index) => {
            await context.waitIfPaused();
            context.throwIfCancelled();
            let ok = false;
            if (typeof processor.processDirectorChunk === 'function') {
                // File jobs share one chapter-assets budget. The processing
                // service still applies the per-target main/director budget
                // inside this scope, so the limits never multiply.
                ok = await context.runWithSemaphore('chapter-assets', async () => (
                    processor.processDirectorChunk(index, { runId: context.runId })
                ));
            } else if (typeof processor.generateChapterAssets === 'function') {
                await context.runWithSemaphore('chapter-assets', async () => processor.generateChapterAssets(
                    index,
                    { force: true, taskId: index + 1, runId: context.runId },
                ));
                ok = true;
            } else {
                throw new Error('章节资产处理器未暴露批量入口');
            }
            // Cancellation can happen while the API request is in flight;
            // discard that chapter's result before it reaches the job queue.
            context.throwIfCancelled();
            completed += 1;
            context.updateProgress({ completed, total, label: `导演切拍 ${completed}/${total}` });
            job.memoryQueue = clone(runState.memory.queue, []);
            context.setSnapshot({ memoryQueue: job.memoryQueue, logs: logs.slice(-50), updatedAt: Date.now() });
            if (!ok) {
                const memory = runState.memory.queue[index];
                context.addError({
                    name: 'ChapterAssetsError',
                    message: memory?.chapterOutlineError || `第${index + 1}章章节资产失败`,
                    chapterIndex: index,
                });
            }
            return ok;
        };

        const waitPrevious = runState.settings?.chapterAssetsWaitForPrevious !== false;
        if (waitPrevious) {
            for (const index of indices) await processOne(index);
        } else {
            await Promise.all(indices.map((index) => processOne(index)));
        }

        context.throwIfCancelled();
        job.memoryQueue = clone(runState.memory.queue, []);
        const taskState = buildTaskState(packagePolicyService, runState, job);
        context.setOutput(taskState);
        context.setSnapshot({ taskState, memoryQueue: job.memoryQueue, logs: logs.slice(-50), updatedAt: Date.now() });
        return {
            taskState,
            snapshot: { taskState, memoryQueue: job.memoryQueue, logs: logs.slice(-50) },
            progress: { completed, total },
        };
    }

    async function addFiles(files, options = {}) {
        const list = Array.from(files || []).filter((file) => file && /\.txt$/i.test(file.name || ''));
        if (list.length === 0) throw new Error('请选择至少一个 TXT 文件');
        const service = ensureScheduler(options.batchId);
        const jobs = [];
        for (const file of list) {
            const { encoding, content } = await fileUtils.detectBestEncoding(file);
            const fileHash = await fileUtils.calculateFileHash(content);
            const queue = await createMemoryQueueFromContent(content);
            const novelName = String(file.name || '').replace(/\.[^/.]+$/, '');
            const jobInput = {
                batchId: activeBatchId,
                fileName: file.name,
                originalFileName: file.name,
                fileHash,
                novelName,
                encoding,
                settingsSnapshot: clone(AppState.settings, {}),
                configSnapshot: clone(AppState.config, {}),
                persistentSnapshot: clone(AppState.persistent, {}),
                memoryQueue: queue,
            };
            const taskState = buildTaskState(packagePolicyService, {
                ...makeRunState(AppState, jobInput),
                memory: { queue },
            }, jobInput);
            const job = service.createJob({
                ...jobInput,
                output: taskState,
                progress: { completed: 0, total: queue.length, percent: 0 },
            });
            jobs.push(job);
        }
        if (!selectedJobId && jobs[0]) selectedJobId = jobs[0].jobId;
        writeBatchProjection();
        persistBatch();
        void service.start().catch((error) => {
            Logger?.error?.('Batch', '批量任务调度失败:', error);
        });
        return { batchId: activeBatchId, jobs: service.getJobs() };
    }

    function getJobs() {
        return scheduler ? scheduler.getJobs() : [];
    }

    function selectJob(jobId) {
        if (!scheduler || !scheduler.getJob(jobId)) return false;
        selectedJobId = String(jobId);
        writeBatchProjection();
        return true;
    }

    function pauseJob(jobId) { return scheduler?.pause(jobId) || null; }
    function resumeJob(jobId) { return scheduler?.resume(jobId) || null; }
    function cancelJob(jobId) { return scheduler?.cancel(jobId) || null; }
    function retryJob(jobId, options = {}) { return scheduler?.retry(jobId, options) || null; }

    function exportBatch(options = {}) {
        const jobs = getJobs();
        let selected = jobs;
        if (options.onlySuccessful) selected = jobs.filter((job) => job.status === 'completed' && !(job.errors || []).length);
        if (options.selectedJobId) selected = jobs.filter((job) => job.jobId === options.selectedJobId);
        return packageService.exportBatch(selected);
    }

    async function importBatch(input) {
        const parsed = packageService.parseBatchPackage(input);
        const service = ensureScheduler(makeBatchId());
        for (const item of parsed.jobs || []) {
            service.createJob({
                batchId: activeBatchId,
                jobId: item.jobId,
                fileName: item.taskState?.originalFileName || item.novelName,
                originalFileName: item.taskState?.originalFileName || item.novelName,
                fileHash: item.fileHash || item.taskState?.fileHash || null,
                novelName: item.novelName || item.taskState?.novelName || '',
                memoryQueue: item.taskState?.memoryQueue || [],
                output: item.taskState,
                progress: item.progress,
                status: item.status,
                settingsSnapshot: clone(AppState.settings, {}),
                configSnapshot: clone(AppState.config, {}),
                persistentSnapshot: clone(AppState.persistent, {}),
            });
        }
        selectedJobId = service.getJobs()[0]?.jobId || null;
        writeBatchProjection();
        service.startQueued();
        persistBatch();
        return { batchId: activeBatchId, manifest: parsed.manifest, jobs: service.getJobs() };
    }

    async function restoreBatch(batchId) {
        if (typeof MemoryHistoryDB?.loadBatchSnapshot !== 'function') return null;
        const snapshot = await MemoryHistoryDB.loadBatchSnapshot(batchId);
        if (!snapshot || !Array.isArray(snapshot.jobs)) return null;
        const service = ensureScheduler(snapshot.batchId || batchId);
        for (const item of snapshot.jobs) {
            if (service.getJob(item.jobId)) continue;
            service.createJob({
                ...item,
                status: item.status === 'running' ? 'queued' : item.status,
            });
        }
        selectedJobId = snapshot.selectedJobId || service.getJobs()[0]?.jobId || null;
        writeBatchProjection();
        service.startQueued();
        return { batchId: activeBatchId, jobs: service.getJobs() };
    }

    async function restoreLatestBatch() {
        if (typeof MemoryHistoryDB?.listBatchSnapshots !== 'function') return null;
        const snapshots = await MemoryHistoryDB.listBatchSnapshots();
        const sorted = Array.isArray(snapshots)
            ? snapshots.slice().sort((left, right) => Number(left?.updatedAt || 0) - Number(right?.updatedAt || 0))
            : [];
        const latest = sorted.length > 0 ? sorted[sorted.length - 1] : null;
        return latest ? restoreBatch(latest.batchId) : null;
    }

    function downloadBatch(options = {}) {
        const result = exportBatch(options);
        const stamp = new Date().toISOString().slice(0, 10).replace(/-/g, '');
        const blob = new Blob([result.bytes], { type: 'application/zip' });
        const url = URL.createObjectURL(blob);
        const anchor = document.createElement('a');
        anchor.href = url;
        anchor.download = `小说批量资产-${stamp}.zip`;
        anchor.click();
        URL.revokeObjectURL(url);
        ErrorHandler?.showUserSuccess?.(`批量工程包已导出：${result.manifest.count} 项`);
        return result;
    }

    async function loadBatchFile(file) {
        if (!file) return null;
        return importBatch(await file.arrayBuffer());
    }

    return {
        addFiles,
        getJobs,
        selectJob,
        pauseJob,
        resumeJob,
        cancelJob,
        retryJob,
        exportBatch,
        downloadBatch,
        importBatch,
        loadBatchFile,
        restoreBatch,
        restoreLatestBatch,
        getActiveBatchId: () => activeBatchId,
        getScheduler: () => scheduler,
    };
}

export default createBatchRuntimeService;
