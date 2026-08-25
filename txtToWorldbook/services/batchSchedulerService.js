const DEFAULT_FILE_CONCURRENCY = 1;
const DEFAULT_API_CONCURRENCY = 1;

function clone(value) {
    if (value === undefined) return undefined;
    if (typeof structuredClone === 'function') {
        try {
            return structuredClone(value);
        } catch {
            // Fall through for values such as functions supplied by a test adapter.
        }
    }
    if (value === undefined) return undefined;
    return JSON.parse(JSON.stringify(value));
}

function positiveInteger(value, fallback) {
    const parsed = Number.parseInt(value, 10);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function makeId(prefix) {
    const random = Math.random().toString(36).slice(2, 10);
    return `${prefix}-${Date.now().toString(36)}-${random}`;
}

function isAbortError(error) {
    return error?.name === 'AbortError'
        || error?.code === 'ABORT_ERR'
        || error?.message === 'ABORTED'
        || error?.message === 'Aborted';
}

function abortError() {
    const error = new Error('ABORTED');
    error.name = 'AbortError';
    return error;
}

export class LocalSemaphore {
    constructor(max = DEFAULT_API_CONCURRENCY) {
        this.max = positiveInteger(max, DEFAULT_API_CONCURRENCY);
        this.current = 0;
        this.queue = [];
    }

    acquire(signal) {
        if (signal?.aborted) return Promise.reject(abortError());
        if (this.current < this.max) {
            this.current += 1;
            return Promise.resolve();
        }
        return new Promise((resolve, reject) => {
            const item = { resolve, reject, signal, onAbort: null };
            item.onAbort = () => {
                const index = this.queue.indexOf(item);
                if (index !== -1) this.queue.splice(index, 1);
                reject(abortError());
            };
            if (signal) signal.addEventListener('abort', item.onAbort, { once: true });
            this.queue.push(item);
        });
    }

    release() {
        if (this.current > 0) this.current -= 1;
        while (this.queue.length > 0 && this.current < this.max) {
            const next = this.queue.shift();
            if (next.signal?.aborted) {
                next.reject(abortError());
                continue;
            }
            if (next.signal && next.onAbort) next.signal.removeEventListener('abort', next.onAbort);
            this.current += 1;
            next.resolve();
        }
    }
}

function createSemaphore(factory, limit, injected) {
    if (injected && typeof injected.acquire === 'function' && typeof injected.release === 'function') {
        return injected;
    }
    if (typeof factory === 'function') {
        try {
            const result = new factory(limit);
            if (result && typeof result.acquire === 'function' && typeof result.release === 'function') return result;
        } catch {
            const result = factory(limit);
            if (result && typeof result.acquire === 'function' && typeof result.release === 'function') return result;
        }
    }
    return new LocalSemaphore(limit);
}

function getLimit(options, name, fallback) {
    const nested = options.concurrency && typeof options.concurrency === 'object'
        ? options.concurrency[name]
        : undefined;
    return positiveInteger(options[name] ?? nested, fallback);
}

export class BatchSchedulerService {
    constructor(options = {}) {
        const {
            processJob,
            Semaphore,
            semaphoreFactory,
            semaphores = {},
        } = options;
        if (typeof processJob !== 'function') {
            throw new TypeError('batch scheduler requires processJob(job, context)');
        }

        this.processJob = processJob;
        this.maxConcurrentFiles = positiveInteger(
            options.maxConcurrentFiles ?? options.fileConcurrency ?? getLimit(options, 'files', DEFAULT_FILE_CONCURRENCY),
            DEFAULT_FILE_CONCURRENCY,
        );
        this.fileSemaphore = createSemaphore(
            semaphoreFactory || Semaphore,
            this.maxConcurrentFiles,
            semaphores.files || options.fileSemaphore || options.semaphore,
        );
        this.semaphores = {
            'chapter-assets': createSemaphore(
                semaphoreFactory || Semaphore,
                getLimit(options, 'chapterAssets', DEFAULT_API_CONCURRENCY),
                semaphores['chapter-assets'] || semaphores.chapterAssets || options.chapterAssetsSemaphore,
            ),
            main: createSemaphore(
                semaphoreFactory || Semaphore,
                getLimit(options, 'main', DEFAULT_API_CONCURRENCY),
                semaphores.main || options.mainSemaphore,
            ),
            director: createSemaphore(
                semaphoreFactory || Semaphore,
                getLimit(options, 'director', DEFAULT_API_CONCURRENCY),
                semaphores.director || options.directorSemaphore,
            ),
        };
        this.jobs = new Map();
        this.waiters = new Map();
        this.activeFiles = 0;
        this.pumpScheduled = false;
    }

    createJob(input = {}) {
        const job = {
            jobId: String(input.jobId || makeId('job')),
            batchId: input.batchId ?? null,
            fileName: String(input.fileName || input.originalFileName || ''),
            originalFileName: String(input.originalFileName || input.fileName || ''),
            encoding: input.encoding || null,
            fileHash: input.fileHash ?? null,
            novelName: String(input.novelName || ''),
            settingsSnapshot: clone(input.settingsSnapshot),
            configSnapshot: clone(input.configSnapshot),
            persistentSnapshot: clone(input.persistentSnapshot),
            retryFailedOnly: input.retryFailedOnly === true,
            memoryQueue: clone(Array.isArray(input.memoryQueue) ? input.memoryQueue : []),
            progress: {
                completed: 0,
                total: Array.isArray(input.memoryQueue) ? input.memoryQueue.length : 0,
                percent: 0,
                ...(clone(input.progress) || {}),
            },
            errors: Array.isArray(input.errors) ? clone(input.errors) : [],
            output: clone(input.output),
            snapshot: clone(input.snapshot),
            runId: null,
            abortController: new AbortController(),
            status: ['queued', 'paused', 'completed', 'failed', 'cancelled'].includes(input.status)
                ? input.status
                : 'queued',
            cancelReason: input.cancelReason || null,
            createdAt: Number.isFinite(input.createdAt) ? input.createdAt : Date.now(),
            startedAt: null,
            finishedAt: null,
        };
        if (this.jobs.has(job.jobId)) throw new Error(`job already exists: ${job.jobId}`);
        this.jobs.set(job.jobId, job);
        return this.getJob(job.jobId);
    }

    addJob(input) {
        return this.createJob(input);
    }

    enqueue(input) {
        return this.createJob(input);
    }

    getJob(jobId) {
        const job = this.jobs.get(String(jobId));
        return job ? this.snapshotOf(job) : null;
    }

    getJobs() {
        return Array.from(this.jobs.values(), (job) => this.snapshotOf(job));
    }

    getStatusSnapshot(jobId) {
        if (jobId !== undefined && jobId !== null) return this.getJob(jobId);
        return this.getJobs();
    }

    getStateSnapshot(jobId) {
        return this.getStatusSnapshot(jobId);
    }

    snapshotOf(job) {
        return {
            jobId: job.jobId,
            batchId: job.batchId,
            fileName: job.fileName,
            originalFileName: job.originalFileName,
            encoding: job.encoding,
            fileHash: job.fileHash,
            novelName: job.novelName,
            settingsSnapshot: clone(job.settingsSnapshot),
            configSnapshot: clone(job.configSnapshot),
            persistentSnapshot: clone(job.persistentSnapshot),
            retryFailedOnly: job.retryFailedOnly === true,
            memoryQueue: clone(job.memoryQueue),
            progress: clone(job.progress),
            errors: clone(job.errors),
            output: clone(job.output),
            snapshot: clone(job.snapshot),
            runId: job.runId,
            status: job.status,
            cancelReason: job.cancelReason,
            createdAt: job.createdAt,
            startedAt: job.startedAt,
            finishedAt: job.finishedAt,
        };
    }

    start(jobId) {
        if (jobId !== undefined && jobId !== null) {
            const job = this.jobs.get(String(jobId));
            if (!job) return Promise.reject(new Error(`unknown job: ${jobId}`));
            this.schedule(job);
            return this.waitForJob(job.jobId);
        }
        for (const job of this.jobs.values()) this.schedule(job);
        return Promise.all(this.getJobs().map((job) => this.waitForJob(job.jobId)));
    }

    startQueued() {
        for (const job of this.jobs.values()) {
            if (job.status === 'queued') this.schedule(job);
        }
        return this.getJobs();
    }

    run(jobId) {
        return this.start(jobId);
    }

    pause(jobId) {
        const job = this.requireJob(jobId);
        if (job.status === 'queued' || job.status === 'running') job.status = 'paused';
        this.notify(job);
        return this.snapshotOf(job);
    }

    resume(jobId) {
        const job = this.requireJob(jobId);
        if (job.status === 'paused') {
            job.status = job.startedAt ? 'running' : 'queued';
            this.schedule(job);
        } else if (job.status === 'queued') {
            this.schedule(job);
        }
        this.notify(job);
        this.pump();
        return this.snapshotOf(job);
    }

    cancel(jobId, reason = 'cancelled') {
        const job = this.requireJob(jobId);
        if (['completed', 'failed', 'cancelled'].includes(job.status)) return this.snapshotOf(job);
        job.status = 'cancelled';
        job.cancelReason = String(reason);
        job.abortController.abort(reason);
        this.notify(job);
        this.pump();
        return this.snapshotOf(job);
    }

    retry(jobId, options = {}) {
        const job = this.requireJob(jobId);
        if (job.runPromise) {
            // A cancelled run may still be unwinding an in-flight API call.
            // Never replace its AbortController while that run can still
            // mutate the job-local queue.
            return job.runPromise.then(() => this.retry(jobId, options));
        }
        if (!['failed', 'cancelled', 'completed'].includes(job.status)) return this.snapshotOf(job);
        job.status = 'queued';
        job.retryFailedOnly = options.failedOnly !== false;
        job.errors = [];
        job.output = undefined;
        job.finishedAt = null;
        job.startedAt = null;
        job.runId = null;
        job.abortController = new AbortController();
        this.notify(job);
        this.schedule(job);
        return this.waitForJob(job.jobId);
    }

    waitForJob(jobId) {
        const job = this.requireJob(jobId);
        if (['completed', 'failed', 'cancelled'].includes(job.status)) return Promise.resolve(this.snapshotOf(job));
        return new Promise((resolve) => {
            const list = this.waiters.get(job.jobId) || [];
            list.push(resolve);
            this.waiters.set(job.jobId, list);
        });
    }

    requireJob(jobId) {
        const job = this.jobs.get(String(jobId));
        if (!job) throw new Error(`unknown job: ${jobId}`);
        return job;
    }

    schedule(job) {
        if (job.status !== 'queued' && job.status !== 'paused') return;
        if (job.status === 'paused') return;
        if (job.runPromise || job.runId) return;
        job.runId = makeId('run');
        job.abortController = new AbortController();
        this.pump();
    }

    pump() {
        if (this.pumpScheduled) return;
        this.pumpScheduled = true;
        queueMicrotask(() => {
            this.pumpScheduled = false;
            for (const job of this.jobs.values()) {
                if (this.activeFiles >= this.maxConcurrentFiles) break;
                if (job.status !== 'queued' || job.runPromise) continue;
                if (!job.runId) this.schedule(job);
                if (job.runPromise) continue;
                job.runPromise = this.execute(job).finally(() => {
                    job.runPromise = null;
                    this.pump();
                });
            }
        });
    }

    async execute(job) {
        let fileAcquired = false;
        this.activeFiles += 1;
        job.status = 'running';
        job.startedAt = job.startedAt || Date.now();
        this.notify(job);
        try {
            await this.acquire(this.fileSemaphore, job.abortController.signal);
            fileAcquired = true;
            await this.waitIfPaused(job);
            this.throwIfCancelled(job);
            const context = this.createContext(job);
            const result = await this.processJob(job, context);
            this.throwIfCancelled(job);
            this.applyResult(job, result);
            job.status = 'completed';
            job.progress.percent = 100;
            if (job.progress.total > 0) job.progress.completed = job.progress.total;
        } catch (error) {
            if (job.status === 'cancelled' || isAbortError(error) || job.abortController.signal.aborted) {
                job.status = 'cancelled';
            } else {
                job.status = 'failed';
                job.errors.push(this.serializeError(error));
            }
        } finally {
            if (fileAcquired) this.fileSemaphore.release();
            this.activeFiles = Math.max(0, this.activeFiles - 1);
            job.finishedAt = Date.now();
            this.notify(job);
            this.resolveWaiters(job);
        }
        return this.snapshotOf(job);
    }

    createContext(job) {
        const context = {
            jobId: job.jobId,
            runId: job.runId,
            signal: job.abortController.signal,
            semaphores: this.semaphores,
            acquire: (kind, fn) => this.withSemaphore(kind, job, fn),
            runWithSemaphore: (kind, fn) => this.withSemaphore(kind, job, fn),
            checkpoint: () => this.waitIfPaused(job),
            waitIfPaused: () => this.waitIfPaused(job),
            throwIfCancelled: () => this.throwIfCancelled(job),
            updateProgress: (progress) => this.updateProgress(job, progress),
            addError: (error) => {
                job.errors.push(this.serializeError(error));
                this.notify(job);
            },
            setSnapshot: (snapshot) => {
                job.snapshot = clone(snapshot);
                this.notify(job);
            },
            setOutput: (output) => {
                job.output = clone(output);
                this.notify(job);
            },
        };
        return context;
    }

    async withSemaphore(kind, job, fn) {
        const semaphore = this.semaphores[kind];
        if (!semaphore) throw new Error(`unknown semaphore: ${kind}`);
        while (true) {
            await this.waitIfPaused(job);
            await this.acquire(semaphore, job.abortController.signal);
            try {
                this.throwIfCancelled(job);
                // If pause happened while this job waited for a slot, do not
                // hold the shared slot while waiting for resume.
                if (job.status === 'paused') continue;
                return await fn();
            } finally {
                semaphore.release();
            }
        }
    }

    async acquire(semaphore, signal) {
        this.throwIfSignalAborted(signal);
        let acquired = false;
        const acquirePromise = Promise.resolve().then(() => semaphore.acquire(signal));
        try {
            await Promise.race([
                acquirePromise.then(() => { acquired = true; }),
                new Promise((_, reject) => {
                    if (signal?.aborted) reject(abortError());
                    else signal?.addEventListener('abort', () => reject(abortError()), { once: true });
                }),
            ]);
        } catch (error) {
            if (isAbortError(error)) {
                acquirePromise.then(() => semaphore.release()).catch(() => {});
            }
            throw error;
        }
        if (!acquired) throw abortError();
    }

    async waitIfPaused(job) {
        while (job.status === 'paused') {
            this.throwIfCancelled(job);
            await new Promise((resolve) => {
                const list = this.waiters.get(`${job.jobId}:resume`) || [];
                list.push(resolve);
                this.waiters.set(`${job.jobId}:resume`, list);
            });
        }
        this.throwIfCancelled(job);
    }

    throwIfSignalAborted(signal) {
        if (signal?.aborted) throw abortError();
    }

    throwIfCancelled(job) {
        if (job.status === 'cancelled' || job.abortController.signal.aborted) throw abortError();
    }

    updateProgress(job, value) {
        if (typeof value === 'number') job.progress.percent = Math.max(0, Math.min(100, value));
        else if (value && typeof value === 'object') job.progress = { ...job.progress, ...clone(value) };
        if (Number.isFinite(job.progress.total) && job.progress.total > 0 && Number.isFinite(job.progress.completed)) {
            job.progress.percent = Math.max(0, Math.min(100, (job.progress.completed / job.progress.total) * 100));
        }
        this.notify(job);
        return this.snapshotOf(job).progress;
    }

    applyResult(job, result) {
        if (result === undefined) return;
        if (result && typeof result === 'object' && !Array.isArray(result)) {
            if (Object.prototype.hasOwnProperty.call(result, 'output')) job.output = clone(result.output);
            else if (Object.prototype.hasOwnProperty.call(result, 'taskState')) job.output = clone(result.taskState);
            else job.output = clone(result);
            if (Object.prototype.hasOwnProperty.call(result, 'snapshot')) job.snapshot = clone(result.snapshot);
            if (result.progress) this.updateProgress(job, result.progress);
            if (Array.isArray(result.errors)) job.errors.push(...clone(result.errors));
            return;
        }
        job.output = clone(result);
    }

    serializeError(error) {
        const serialized = {
            name: error?.name || 'Error',
            message: String(error?.message || error),
        };
        for (const key of ['code', 'chapterIndex', 'chapterAssetsApiTarget', 'chapterAssetsApiLabel']) {
            if (error && error[key] !== undefined) serialized[key] = clone(error[key]);
        }
        return serialized;
    }

    notify(job) {
        const resumeKey = `${job.jobId}:resume`;
        if (job.status !== 'paused' && this.waiters.has(resumeKey)) {
            const waiters = this.waiters.get(resumeKey);
            this.waiters.delete(resumeKey);
            waiters.forEach((resolve) => resolve());
        }
        if (typeof this.onChange === 'function') this.onChange(this.snapshotOf(job));
    }

    resolveWaiters(job) {
        const waiters = this.waiters.get(job.jobId) || [];
        this.waiters.delete(job.jobId);
        waiters.forEach((resolve) => resolve(this.snapshotOf(job)));
    }
}

export function createBatchSchedulerService(options = {}) {
    const service = new BatchSchedulerService(options);
    if (typeof options.onChange === 'function') service.onChange = options.onChange;
    return service;
}

export default createBatchSchedulerService;
