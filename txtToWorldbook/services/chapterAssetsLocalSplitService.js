const DEFAULT_BEAT_COUNT = 4;
const DEFAULT_SEARCH_WINDOW = 500;
const DEFAULT_BOUNDARY_PREFERENCE = 'paragraph-first';
const MIN_BEAT_COUNT = 3;
const MAX_BEAT_COUNT = 8;

const SENTENCE_END_RE = /[。！？!?；;.!?]/;
const PARAGRAPH_BOUNDARY_RE = /\n[ \t\u3000]*\n+/g;

function clampInteger(value, min, max, fallback) {
    const parsed = Number(value);
    if (!Number.isFinite(parsed)) return fallback;
    return Math.max(min, Math.min(max, Math.round(parsed)));
}

function normalizeSplitOptions(options = {}) {
    const beatCount = clampInteger(options.beatCount, MIN_BEAT_COUNT, MAX_BEAT_COUNT, DEFAULT_BEAT_COUNT);
    const searchWindow = clampInteger(options.searchWindow, 0, 5000, DEFAULT_SEARCH_WINDOW);
    const preference = String(options.boundaryPreference || DEFAULT_BOUNDARY_PREFERENCE).trim();
    const boundaryPreference = ['paragraph-first', 'sentence-first', 'balanced'].includes(preference)
        ? preference
        : DEFAULT_BOUNDARY_PREFERENCE;

    return {
        beatCount,
        searchWindow,
        boundaryPreference,
    };
}

function collectParagraphBoundaries(text) {
    const source = String(text || '');
    const boundaries = [];
    let match = null;
    PARAGRAPH_BOUNDARY_RE.lastIndex = 0;
    while ((match = PARAGRAPH_BOUNDARY_RE.exec(source)) !== null) {
        boundaries.push(match.index + match[0].length);
    }
    return boundaries;
}

function collectSentenceBoundaries(text) {
    const source = String(text || '');
    const boundaries = [];
    for (let i = 0; i < source.length - 1; i++) {
        if (SENTENCE_END_RE.test(source[i])) {
            boundaries.push(i + 1);
        }
    }
    return boundaries;
}

function rankCandidate(candidate, target, preference) {
    const distance = Math.abs(candidate.position - target);
    if (preference === 'paragraph-first') {
        return candidate.type === 'paragraph'
            ? distance
            : distance + 100000;
    }
    if (preference === 'sentence-first') {
        return candidate.type === 'sentence'
            ? distance
            : distance + 100000;
    }
    return distance + (candidate.type === 'paragraph' ? 0 : 1000);
}

function findBoundaryCut({ text, target, minCut, maxCut, searchWindow, boundaryPreference }) {
    const source = String(text || '');
    const lower = Math.max(minCut, target - searchWindow);
    const upper = Math.min(maxCut, target + searchWindow);
    const paragraphBoundaries = collectParagraphBoundaries(source);
    const sentenceBoundaries = collectSentenceBoundaries(source);
    const candidates = [
        ...paragraphBoundaries.map((position) => ({ position, type: 'paragraph' })),
        ...sentenceBoundaries.map((position) => ({ position, type: 'sentence' })),
    ]
        .filter((candidate) => candidate.position >= lower && candidate.position <= upper)
        .filter((candidate) => candidate.position > minCut - 1 && candidate.position < maxCut + 1)
        .sort((a, b) => {
            const rankDelta = rankCandidate(a, target, boundaryPreference) - rankCandidate(b, target, boundaryPreference);
            if (rankDelta !== 0) return rankDelta;
            return a.position - b.position;
        });

    if (candidates.length > 0) {
        return candidates[0];
    }

    return {
        position: Math.max(minCut, Math.min(maxCut, target)),
        type: 'hard',
    };
}

function validateSegments(source, segments, beatCount) {
    if (!Array.isArray(segments) || segments.length !== beatCount) {
        throw new Error(`本地预切失败：期望 ${beatCount} 段，实际 ${Array.isArray(segments) ? segments.length : 0} 段`);
    }
    const emptyIndex = segments.findIndex((segment) => String(segment || '').trim().length === 0);
    if (emptyIndex >= 0) {
        throw new Error(`本地预切失败：第 ${emptyIndex + 1} 段为空`);
    }
    const joined = segments.join('');
    if (joined !== source) {
        throw new Error(`本地预切失败：拼接结果与原文不一致，拼接长度=${joined.length}，原文长度=${source.length}`);
    }
}

export function splitContentIntoBalancedSegments(content, options = {}) {
    const source = String(content ?? '');
    if (!source.trim()) {
        throw new Error('本地预切失败：章节正文为空');
    }

    const normalized = normalizeSplitOptions(options);
    const { beatCount, searchWindow, boundaryPreference } = normalized;
    if (source.length < beatCount) {
        throw new Error(`本地预切失败：正文长度不足以切成 ${beatCount} 个非空节拍`);
    }

    const cuts = [];
    const cutMeta = [];
    let previousCut = 0;

    for (let i = 1; i < beatCount; i++) {
        const remainingSegments = beatCount - i;
        const minCut = previousCut + 1;
        const maxCut = source.length - remainingSegments;
        const theoretical = Math.round((source.length * i) / beatCount);
        const target = Math.max(minCut, Math.min(maxCut, theoretical));
        const selected = findBoundaryCut({
            text: source,
            target,
            minCut,
            maxCut,
            searchWindow,
            boundaryPreference,
        });
        const position = Math.max(minCut, Math.min(maxCut, selected.position));
        cuts.push(position);
        cutMeta.push({
            index: i,
            theoretical,
            position,
            boundary: selected.type,
            searchWindow,
            boundaryPreference,
        });
        previousCut = position;
    }

    const segments = [];
    let start = 0;
    for (const cut of cuts) {
        segments.push(source.slice(start, cut));
        start = cut;
    }
    segments.push(source.slice(start));

    validateSegments(source, segments, beatCount);

    return {
        segments,
        cuts,
        meta: {
            ...normalized,
            contentLength: source.length,
            segmentLengths: segments.map((segment) => segment.length),
            cutMeta,
            preserved: segments.join('') === source,
        },
    };
}

function toShortText(text, maxLen = 80) {
    const plain = String(text || '').replace(/\s+/g, ' ').trim();
    if (!plain) return '';
    return plain.length > maxLen ? `${plain.slice(0, maxLen)}...` : plain;
}

function buildFallbackSummary(segment, chapterIndex, beatIndex) {
    const snippet = toShortText(segment, 56);
    return snippet
        ? `第${chapterIndex}章第${beatIndex}拍：${snippet}`
        : `第${chapterIndex}章第${beatIndex}拍`;
}

function tagForBeat(index, count) {
    if (index === 0) return ['开场'];
    if (index === count - 1) return ['收束'];
    return ['推进'];
}

export function buildLocalPresplitAssets(content, chapterIndex = 1, options = {}) {
    const split = splitContentIntoBalancedSegments(content, options);
    const beats = split.segments.map((segment, idx) => {
        const summary = buildFallbackSummary(segment, chapterIndex, idx + 1);
        const cutMeta = split.meta.cutMeta[idx] || null;
        return {
            id: `b${idx + 1}`,
            summary,
            event_summary: summary,
            entryEvent: idx === 0
                ? '从章节开场进入当前事件。'
                : '从上一节拍结果自然衔接进入当前事件。',
            exitCondition: idx === split.segments.length - 1
                ? '当本章当前阶段完成并形成可承接结尾时。'
                : '当本节拍目标完成或局势发生明显变化时。',
            split_reason: cutMeta
                ? `本地预切根据 ${cutMeta.boundary} 边界接近理论切点 ${cutMeta.theoretical}。`
                : '本地预切生成的最终节拍。',
            tags: tagForBeat(idx, split.segments.length),
            original_text: segment,
            split_rule: {
                primary: idx === split.segments.length - 1 ? 'conflict_closed' : 'goal_shift',
                rationale: cutMeta
                    ? `本地预切选择 ${cutMeta.boundary} 边界，保持节拍长度均衡并保留原文。`
                    : '本地预切保留章节尾段作为收束节拍。',
            },
            self_check: 'local-presplit',
            self_review: 'local-presplit',
        };
    });

    const localOutline = `第${chapterIndex}章本地预切草稿：${beats
        .map((beat, index) => `${index + 1}. ${beat.summary}`)
        .join('；')}`;

    return {
        outline: localOutline,
        script: {
            keyNodes: beats.slice(0, 3).map((beat) => beat.summary),
            beats,
        },
        meta: {
            source: 'local-presplit',
            chapterIndex,
            beatCount: beats.length,
            contentLength: split.meta.contentLength,
            segmentLengths: split.meta.segmentLengths,
            split_rule: {
                mode: 'balanced-local',
                boundaryPreference: split.meta.boundaryPreference,
                searchWindow: split.meta.searchWindow,
            },
            cuts: split.cuts,
            cutMeta: split.meta.cutMeta,
            preserved: split.meta.preserved,
        },
    };
}

export const chapterAssetsLocalSplitDefaults = Object.freeze({
    beatCount: DEFAULT_BEAT_COUNT,
    searchWindow: DEFAULT_SEARCH_WINDOW,
    boundaryPreference: DEFAULT_BOUNDARY_PREFERENCE,
});
