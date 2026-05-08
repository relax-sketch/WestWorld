export const DIRECTOR_INJECTION_MARKER = '[WestWorld Director Injection]';
export const DIRECTOR_INJECTION_IDENTIFIER = 'westworld-director-current';
export const DEFAULT_DIRECTOR_INJECTION_DEPTH = 0;
export const DEFAULT_DIRECTOR_INJECTION_ORDER = 100;

function clampInteger(value, fallback, min, max) {
    const parsed = Number(value);
    if (!Number.isFinite(parsed)) return fallback;
    return Math.max(min, Math.min(max, Math.floor(parsed)));
}

export function normalizeDirectorInjectionPlacement(settings = {}, overrides = {}) {
    const depth = clampInteger(
        overrides.depth ?? settings.directorInjectionDepth,
        DEFAULT_DIRECTOR_INJECTION_DEPTH,
        0,
        100,
    );
    const order = clampInteger(
        overrides.order ?? settings.directorInjectionOrder,
        DEFAULT_DIRECTOR_INJECTION_ORDER,
        -10000,
        10000,
    );
    return {
        placement: 'post-depth',
        depth,
        order,
    };
}

export function resolveDirectorInjectionIndex(chatLength, depth = DEFAULT_DIRECTOR_INJECTION_DEPTH) {
    const length = Math.max(0, Number.isFinite(Number(chatLength)) ? Math.floor(Number(chatLength)) : 0);
    const normalizedDepth = clampInteger(depth, DEFAULT_DIRECTOR_INJECTION_DEPTH, 0, 100);
    return Math.max(0, Math.min(length, length - normalizedDepth));
}

export function hashText(text = '') {
    const source = String(text || '');
    let hash = 5381;
    for (let i = 0; i < source.length; i++) {
        hash = ((hash << 5) + hash) ^ source.charCodeAt(i);
    }
    return (hash >>> 0).toString(16).padStart(8, '0');
}

export function previewText(text = '', maxLen = 180) {
    const plain = String(text || '').replace(/\s+/g, ' ').trim();
    if (!plain) return '';
    return plain.length > maxLen ? `${plain.slice(0, maxLen)}...` : plain;
}

export function buildDirectorInjectionMarker({
    runId = '',
    chapterIndex = -1,
    beatIndex = -1,
} = {}) {
    const chapter = Number.isInteger(chapterIndex) && chapterIndex >= 0 ? chapterIndex + 1 : 0;
    const beat = Number.isInteger(beatIndex) && beatIndex >= 0 ? beatIndex + 1 : 0;
    return `${DIRECTOR_INJECTION_MARKER}\nrun_id: ${runId || 'unknown'}\nchapter: ${chapter}\nbeat: ${beat}`;
}

export function withDirectorInjectionMarker(content = '', meta = {}, options = {}) {
    if (options.includeMarker === false) return String(content || '');
    const body = String(content || '');
    if (body.includes(DIRECTOR_INJECTION_MARKER)) return body;
    return `${buildDirectorInjectionMarker(meta)}\n\n${body}`;
}

export function isDirectorInjectionItem(item) {
    if (!item || typeof item !== 'object') return false;
    if (item.is_westworld_director === true || item.is_storyweaver_director === true) return true;
    const content = String(item.content || item.mes || '');
    return content.includes(DIRECTOR_INJECTION_MARKER)
        || content.includes('# StoryWeaver 导演提示（宽松模式）')
        || content.includes('# StoryWeaver 导演提示（硬导演模式）')
        || content.includes('# WestWorld 导演提示（宽松模式）')
        || content.includes('# WestWorld 导演提示（硬导演模式）')
        || content.includes('# WestWorld 导演->演员执行单');
}

export function stripExistingDirectorInjection(chat) {
    if (!Array.isArray(chat)) return { removed: 0, reason: 'chat-not-array' };
    let removed = 0;
    for (let i = chat.length - 1; i >= 0; i--) {
        if (isDirectorInjectionItem(chat[i])) {
            chat.splice(i, 1);
            removed += 1;
        }
    }
    return { removed };
}

export function inspectDirectorInjection(chat) {
    if (!Array.isArray(chat)) {
        return {
            injected: false,
            reason: 'chat-not-array',
            insertionIndex: -1,
            role: '',
            contentLength: 0,
            contentHash: '',
            contentPreview: '',
            markerFoundAfterInsert: false,
            depth: 0,
            order: 0,
            depthFromEnd: 0,
            placement: '',
        };
    }

    for (let i = 0; i < chat.length; i++) {
        const item = chat[i] || {};
        if (!isDirectorInjectionItem(item)) continue;
        const content = String(item.content || item.mes || '');
        const depthFromEnd = Math.max(0, chat.length - i - 1);
        const storedDepth = Number(item.westworld_director_depth);
        const storedOrder = Number(item.westworld_director_order);
        return {
            injected: true,
            reason: '',
            insertionIndex: i,
            role: String(item.role || ''),
            contentLength: content.length,
            contentHash: hashText(content),
            contentPreview: previewText(content),
            markerFoundAfterInsert: content.includes(DIRECTOR_INJECTION_MARKER),
            runId: item.westworld_director_run_id || '',
            identifier: item.identifier || DIRECTOR_INJECTION_IDENTIFIER,
            depth: Number.isFinite(storedDepth) ? storedDepth : depthFromEnd,
            order: Number.isFinite(storedOrder) ? storedOrder : 0,
            depthFromEnd,
            placement: item.westworld_director_placement || 'post-depth',
        };
    }

    return {
        injected: false,
        reason: 'director-injection-not-found',
        insertionIndex: -1,
        role: '',
        contentLength: 0,
        contentHash: '',
        contentPreview: '',
        markerFoundAfterInsert: false,
        depth: 0,
        order: 0,
        depthFromEnd: 0,
        placement: '',
    };
}

export function insertDirectorInjection(chat, injection, meta = {}) {
    if (!Array.isArray(chat)) {
        return {
            injected: false,
            reason: 'chat-not-array',
            chatLengthBefore: 0,
            chatLengthAfter: 0,
            insertionIndex: -1,
        };
    }

    const chatLengthBefore = chat.length;
    const stripResult = stripExistingDirectorInjection(chat);
    const placement = normalizeDirectorInjectionPlacement(meta.settings || {}, meta);
    const insertionIndex = resolveDirectorInjectionIndex(chat.length, placement.depth);
    const content = String(injection || '');
    const message = {
        role: 'system',
        content,
        name: 'system',
        is_user: false,
        is_system: true,
        mes: content,
        identifier: DIRECTOR_INJECTION_IDENTIFIER,
        is_westworld_director: true,
        is_storyweaver_director: true,
        westworld_director_run_id: meta.runId || '',
        westworld_director_depth: placement.depth,
        westworld_director_order: placement.order,
        westworld_director_placement: placement.placement,
        westworld_director_meta: {
            runId: meta.runId || '',
            chapterIndex: Number.isInteger(meta.chapterIndex) ? meta.chapterIndex : -1,
            beatIndex: Number.isInteger(meta.beatIndex) ? meta.beatIndex : -1,
            source: meta.source || '',
            depth: placement.depth,
            order: placement.order,
            placement: placement.placement,
        },
    };
    chat.splice(insertionIndex, 0, message);

    const inspected = inspectDirectorInjection(chat);
    return {
        ...inspected,
        at: Date.now(),
        runId: meta.runId || '',
        chatLengthBefore,
        chatLengthAfter: chat.length,
        removedExisting: stripResult.removed || 0,
        depth: placement.depth,
        order: placement.order,
        placement: placement.placement,
    };
}
