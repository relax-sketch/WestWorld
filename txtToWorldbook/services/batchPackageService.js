const TASK_STATE_TYPE = 'WestWorld.taskState';
const LEGACY_TASK_STATE_TYPE = 'StoryWeaver.taskState';
const BATCH_MANIFEST_TYPE = 'WestWorld.batchManifest';
const BATCH_PACKAGE_VERSION = '1.0.0';

const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder();

function clone(value) {
    if (value === undefined) return undefined;
    if (typeof structuredClone === 'function') {
        try {
            return structuredClone(value);
        } catch {
            // JSON is sufficient for taskState data and keeps the service portable.
        }
    }
    return JSON.parse(JSON.stringify(value));
}

function asBytes(value) {
    if (value instanceof Uint8Array) return value;
    if (value instanceof ArrayBuffer) return new Uint8Array(value);
    if (ArrayBuffer.isView(value)) return new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
    throw new TypeError('expected Uint8Array or ArrayBuffer');
}

function asTaskState(jobOrState) {
    if (jobOrState && typeof jobOrState === 'object' && jobOrState.type === TASK_STATE_TYPE) {
        return clone(jobOrState);
    }
    const source = jobOrState && typeof jobOrState === 'object' ? jobOrState : {};
    const candidate = source.taskState
        || source.snapshot
        || source.output
        || source.result;
    const taskState = candidate?.type === TASK_STATE_TYPE
        ? candidate
        : (candidate?.taskState?.type === TASK_STATE_TYPE ? candidate.taskState : candidate);
    if (!taskState || typeof taskState !== 'object' || Array.isArray(taskState)) {
        throw new TypeError('job does not contain a WestWorld.taskState object');
    }
    if (!taskState.type || ![TASK_STATE_TYPE, LEGACY_TASK_STATE_TYPE].includes(taskState.type)) {
        throw new TypeError(`unsupported task state type: ${taskState.type}`);
    }
    return clone(taskState);
}

function jsonBytes(value) {
    return textEncoder.encode(JSON.stringify(value, null, 2));
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

function writeUInt16(bytes, offset, value) {
    bytes[offset] = value & 0xff;
    bytes[offset + 1] = (value >>> 8) & 0xff;
}

function writeUInt32(bytes, offset, value) {
    bytes[offset] = value & 0xff;
    bytes[offset + 1] = (value >>> 8) & 0xff;
    bytes[offset + 2] = (value >>> 16) & 0xff;
    bytes[offset + 3] = (value >>> 24) & 0xff;
}

const CRC_TABLE = (() => {
    const table = new Uint32Array(256);
    for (let i = 0; i < 256; i += 1) {
        let value = i;
        for (let bit = 0; bit < 8; bit += 1) value = (value & 1) ? (value >>> 1) ^ 0xedb88320 : value >>> 1;
        table[i] = value >>> 0;
    }
    return table;
})();

function crc32(bytes) {
    let value = 0xffffffff;
    for (const byte of bytes) value = (value >>> 8) ^ CRC_TABLE[(value ^ byte) & 0xff];
    return (value ^ 0xffffffff) >>> 0;
}

function zipEntries(entries) {
    const localParts = [];
    const centralParts = [];
    let offset = 0;
    for (const entry of entries) {
        const name = String(entry.name);
        const nameBytes = textEncoder.encode(name);
        const data = asBytes(entry.data);
        const crc = crc32(data);
        const local = new Uint8Array(30 + nameBytes.length + data.length);
        writeUInt32(local, 0, 0x04034b50);
        writeUInt16(local, 4, 20);
        writeUInt16(local, 6, 0x0800);
        writeUInt16(local, 8, 0);
        writeUInt16(local, 10, 0);
        writeUInt16(local, 12, 0);
        writeUInt32(local, 14, crc);
        writeUInt32(local, 18, data.length);
        writeUInt32(local, 22, data.length);
        writeUInt16(local, 26, nameBytes.length);
        writeUInt16(local, 28, 0);
        local.set(nameBytes, 30);
        local.set(data, 30 + nameBytes.length);
        localParts.push(local);

        const central = new Uint8Array(46 + nameBytes.length);
        writeUInt32(central, 0, 0x02014b50);
        writeUInt16(central, 4, 20);
        writeUInt16(central, 6, 20);
        writeUInt16(central, 8, 0x0800);
        writeUInt16(central, 10, 0);
        writeUInt16(central, 12, 0);
        writeUInt16(central, 14, 0);
        writeUInt32(central, 16, crc);
        writeUInt32(central, 20, data.length);
        writeUInt32(central, 24, data.length);
        writeUInt16(central, 28, nameBytes.length);
        writeUInt16(central, 30, 0);
        writeUInt16(central, 32, 0);
        writeUInt16(central, 34, 0);
        writeUInt16(central, 36, 0);
        writeUInt32(central, 38, 0);
        writeUInt32(central, 42, offset);
        central.set(nameBytes, 46);
        centralParts.push(central);
        offset += local.length;
    }

    const centralSize = centralParts.reduce((sum, part) => sum + part.length, 0);
    const eocd = new Uint8Array(22);
    writeUInt32(eocd, 0, 0x06054b50);
    writeUInt16(eocd, 4, 0);
    writeUInt16(eocd, 6, 0);
    writeUInt16(eocd, 8, entries.length);
    writeUInt16(eocd, 10, entries.length);
    writeUInt32(eocd, 12, centralSize);
    writeUInt32(eocd, 16, offset);
    writeUInt16(eocd, 20, 0);

    const output = new Uint8Array(offset + centralSize + eocd.length);
    let cursor = 0;
    for (const part of localParts) {
        output.set(part, cursor);
        cursor += part.length;
    }
    for (const part of centralParts) {
        output.set(part, cursor);
        cursor += part.length;
    }
    output.set(eocd, cursor);
    return output;
}

function parseZipEntries(input) {
    const bytes = asBytes(input);
    let eocdOffset = -1;
    for (let i = bytes.length - 22; i >= Math.max(0, bytes.length - 65557); i -= 1) {
        if (readUInt32(bytes, i) === 0x06054b50) {
            eocdOffset = i;
            break;
        }
    }
    if (eocdOffset < 0) throw new Error('invalid ZIP: end of central directory not found');
    const count = readUInt16(bytes, eocdOffset + 10);
    const centralSize = readUInt32(bytes, eocdOffset + 12);
    const centralOffset = readUInt32(bytes, eocdOffset + 16);
    if (centralOffset + centralSize > bytes.length) throw new Error('invalid ZIP: central directory is truncated');

    const entries = {};
    let cursor = centralOffset;
    for (let index = 0; index < count; index += 1) {
        if (readUInt32(bytes, cursor) !== 0x02014b50) throw new Error('invalid ZIP: central directory entry');
        const flags = readUInt16(bytes, cursor + 8);
        const method = readUInt16(bytes, cursor + 10);
        const compressedSize = readUInt32(bytes, cursor + 20);
        const uncompressedSize = readUInt32(bytes, cursor + 24);
        const nameLength = readUInt16(bytes, cursor + 28);
        const extraLength = readUInt16(bytes, cursor + 30);
        const commentLength = readUInt16(bytes, cursor + 32);
        const localOffset = readUInt32(bytes, cursor + 42);
        const name = textDecoder.decode(bytes.slice(cursor + 46, cursor + 46 + nameLength));
        cursor += 46 + nameLength + extraLength + commentLength;
        if (method !== 0) throw new Error(`unsupported ZIP compression method for ${name}`);
        if ((flags & 0x08) !== 0) throw new Error(`unsupported ZIP data descriptor for ${name}`);
        if (readUInt32(bytes, localOffset) !== 0x04034b50) throw new Error(`invalid ZIP local entry for ${name}`);
        const localNameLength = readUInt16(bytes, localOffset + 26);
        const localExtraLength = readUInt16(bytes, localOffset + 28);
        const dataStart = localOffset + 30 + localNameLength + localExtraLength;
        const dataEnd = dataStart + compressedSize;
        if (dataEnd > bytes.length || uncompressedSize !== compressedSize) throw new Error(`invalid ZIP data for ${name}`);
        const data = bytes.slice(dataStart, dataEnd);
        entries[name] = data;
    }
    return entries;
}

function countStatuses(jobs) {
    const counts = { queued: 0, running: 0, paused: 0, completed: 0, failed: 0, cancelled: 0 };
    for (const job of jobs) {
        const status = String(job?.status || 'queued');
        if (Object.prototype.hasOwnProperty.call(counts, status)) counts[status] += 1;
        else counts.queued += 1;
    }
    return counts;
}

function overallStatus(counts) {
    const total = Object.values(counts).reduce((sum, value) => sum + value, 0);
    if (total === 0) return 'empty';
    if (counts.running > 0) return 'running';
    if (counts.queued > 0 || counts.paused > 0) return 'incomplete';
    if (counts.failed > 0 && counts.completed === 0) return 'failed';
    if (counts.cancelled > 0 && counts.completed === 0 && counts.failed === 0) return 'cancelled';
    return 'completed';
}

export class BatchPackageService {
    constructor(options = {}) {
        this.taskStateType = options.taskStateType || TASK_STATE_TYPE;
    }

    buildTaskState(jobOrState) {
        const state = asTaskState(jobOrState);
        if (state.type && ![this.taskStateType, LEGACY_TASK_STATE_TYPE].includes(state.type)) {
            throw new TypeError(`unsupported task state type: ${state.type}`);
        }
        return state;
    }

    serializeTaskState(jobOrState) {
        return JSON.stringify(this.buildTaskState(jobOrState), null, 2);
    }

    exportTaskState(jobOrState) {
        return this.serializeTaskState(jobOrState);
    }

    parseTaskState(jsonOrBytes) {
        const text = typeof jsonOrBytes === 'string' ? jsonOrBytes : textDecoder.decode(asBytes(jsonOrBytes));
        const state = JSON.parse(text);
        if (state?.type && ![this.taskStateType, LEGACY_TASK_STATE_TYPE].includes(state.type)) {
            throw new TypeError(`unsupported task state type: ${state.type}`);
        }
        return state;
    }

    buildManifest(jobs = []) {
        const snapshots = Array.from(jobs, (job) => job?.jobId ? job : { jobId: job?.jobId });
        const counts = countStatuses(snapshots);
        const items = snapshots.map((job, index) => ({
            jobId: String(job?.jobId || `job-${index + 1}`),
            fileName: job?.originalFileName || job?.fileName || null,
            fileHash: job?.fileHash ?? null,
            novelName: String(job?.novelName || ''),
            status: String(job?.status || 'queued'),
            chapterCount: Array.isArray(job?.memoryQueue) ? job.memoryQueue.length : Number(job?.progress?.total || 0),
            successCount: Array.isArray(job?.memoryQueue)
                ? job.memoryQueue.filter((memory) => memory?.chapterOutlineStatus === 'done' && !memory?.failed).length
                : null,
            failedCount: Math.max(
                Array.isArray(job?.memoryQueue)
                    ? job.memoryQueue.filter((memory) => memory?.chapterOutlineStatus === 'failed' || memory?.chapterOutlineStatus === 'polish_failed' || memory?.failed).length
                    : 0,
                Array.isArray(job?.errors) ? job.errors.length : 0,
            ),
            progress: clone(job?.progress || {}),
            errorCount: Array.isArray(job?.errors) ? job.errors.length : 0,
            packageFile: `jobs/${String(job?.jobId || `job-${index + 1}`)}.json`,
            path: `jobs/${String(job?.jobId || `job-${index + 1}`)}.json`,
        }));
        return {
            version: BATCH_PACKAGE_VERSION,
            type: BATCH_MANIFEST_TYPE,
            createdAt: Date.now(),
            count: snapshots.length,
            status: overallStatus(counts),
            counts,
            // `items` is the documented batch index. Keep `jobs` as an alias
            // so early 3.7 previews can still inspect the manifest.
            items,
            jobs: items,
        };
    }

    createZip(entries) {
        const normalized = Array.isArray(entries)
            ? entries
            : Object.entries(entries || {}).map(([name, data]) => ({ name, data }));
        return zipEntries(normalized.map((entry) => ({
            name: entry.name,
            data: typeof entry.data === 'string' ? textEncoder.encode(entry.data) : entry.data,
        })));
    }

    exportBatch(jobs = []) {
        const list = Array.from(jobs);
        const manifest = this.buildManifest(list);
        const entries = [{ name: 'manifest.json', data: jsonBytes(manifest) }];
        const taskStates = list.map((job, index) => ({
            job,
            jobId: String(job?.jobId || `job-${index + 1}`),
        }));
        for (const item of taskStates) {
            entries.push({
                name: `jobs/${item.jobId}.json`,
                data: jsonBytes(this.buildTaskState(item.job)),
            });
        }
        return {
            manifest,
            bytes: this.createZip(entries),
            entries: entries.map((entry) => entry.name),
        };
    }

    createBatchPackage(jobs) {
        return this.exportBatch(jobs);
    }

    parseZip(input) {
        const entries = parseZipEntries(input);
        if (!entries['manifest.json']) throw new Error('batch ZIP is missing manifest.json');
        const manifest = JSON.parse(textDecoder.decode(entries['manifest.json']));
        if (manifest?.type !== BATCH_MANIFEST_TYPE) throw new Error('invalid WestWorld batch manifest');
        const jobs = [];
        const manifestItems = Array.isArray(manifest.items)
            ? manifest.items
            : (Array.isArray(manifest.jobs) ? manifest.jobs : []);
        for (const item of manifestItems) {
            const path = item.packageFile || item.path || `jobs/${item.jobId}.json`;
            if (!entries[path]) throw new Error(`batch ZIP is missing ${path}`);
            jobs.push({
                jobId: item.jobId,
                fileHash: item.fileHash ?? null,
                novelName: item.novelName || '',
                status: item.status || 'queued',
                progress: clone(item.progress || {}),
                errors: [],
                taskState: this.parseTaskState(entries[path]),
            });
        }
        return { manifest, jobs, entries };
    }

    parseBatchPackage(input) {
        return this.parseZip(input);
    }
}

export function createBatchPackageService(options = {}) {
    return new BatchPackageService(options);
}

export { BATCH_MANIFEST_TYPE, BATCH_PACKAGE_VERSION, TASK_STATE_TYPE };
export default createBatchPackageService;
