export const RESOURCE_TASK_STATE_VERSION = '3.0.0-resource';
export const RESOURCE_TASK_STATE_TYPE = 'westworld-resource-package';

const SENSITIVE_EXACT_KEYS = new Set([
    'settings',
    'prompts',
    'promptMessageChain',
    'mainApi',
    'directorApi',
    'customApiKey',
    'customApiEndpoint',
    'customApiModel',
    'customApiProvider',
    'customApiMaxTokens',
    'apiKey',
    'endpoint',
    'model',
    'promptPrefixPreset',
    'promptPrefixPresets',
    'selectedPromptPrefixPreset',
    'customSuffixPrompt',
    'customWorldbookPrompt',
    'customPlotPrompt',
    'customStylePrompt',
    'customConsolidatePrompt',
    'customAliasMergePrompt',
    'customChapterAssetsPrompt',
    'customDirectorFrameworkPrompt',
    'customDirectorFrameworkSuffix',
    'customDirectorInjectionPrompt',
    'customDirectorInjectionSuffix',
    'customMergePrompt',
    'customRerollPrompt',
    'customBatchRerollPrompt',
    'consolidatePromptPresets',
    'consolidateCategoryPresetMap',
    'customWorldbookCategories',
    'defaultWorldbookEntries',
    'defaultWorldbookEntriesUI',
    'categoryDefaultConfig',
    'entryPositionConfig',
    'chapterRegexSettings',
    'categoryLightSettings',
    'parallelConfig',
]);

function isSensitiveKey(key) {
    const normalized = String(key || '');
    if (SENSITIVE_EXACT_KEYS.has(normalized)) return true;
    return /prompt|apiKey|endpoint|token|preset/i.test(normalized);
}

function cloneSafe(value) {
    if (Array.isArray(value)) return value.map(cloneSafe);
    if (!value || typeof value !== 'object') return value;

    const next = {};
    for (const [key, item] of Object.entries(value)) {
        if (isSensitiveKey(key)) continue;
        next[key] = cloneSafe(item);
    }
    return next;
}

export function stripSensitiveTaskStateFields(state) {
    return cloneSafe(state || {});
}

export function buildResourceTaskState(AppState, helpers = {}) {
    const normalizeMemoryQueue = helpers.normalizeMemoryQueue || ((queue) => (Array.isArray(queue) ? queue : []));
    const normalizeExperience = helpers.normalizeExperience || ((experience) => experience || {});
    const clampStartIndex = helpers.clampStartIndex || ((value) => value || 0);
    const now = helpers.now || (() => Date.now());

    const normalizedQueue = normalizeMemoryQueue(AppState?.memory?.queue || []);
    const queueLength = normalizedQueue.length;

    const resourceState = {
        version: RESOURCE_TASK_STATE_VERSION,
        type: RESOURCE_TASK_STATE_TYPE,
        timestamp: now(),
        memoryQueue: normalizedQueue,
        generatedWorldbook: AppState?.worldbook?.generated || {},
        worldbookVolumes: Array.isArray(AppState?.worldbook?.volumes) ? AppState.worldbook.volumes : [],
        currentVolumeIndex: AppState?.worldbook?.currentVolumeIndex || 0,
        fileHash: AppState?.file?.hash || null,
        originalFileName: AppState?.file?.current ? AppState.file.current.name : null,
        novelName: AppState?.file?.novelName || '',
        experience: normalizeExperience(AppState?.experience || {}, queueLength),
        processingState: {
            incrementalMode: !!AppState?.processing?.incrementalMode,
            volumeMode: !!AppState?.processing?.volumeMode,
        },
        queueState: {
            startIndex: clampStartIndex(AppState?.memory?.startIndex, queueLength),
            userSelectedIndex: Number.isInteger(AppState?.memory?.userSelectedIndex)
                ? clampStartIndex(AppState.memory.userSelectedIndex, queueLength)
                : null,
        },
    };

    return stripSensitiveTaskStateFields(resourceState);
}

export function getIgnoredLegacyTaskStateKeys(state) {
    if (!state || typeof state !== 'object') return [];
    return Object.keys(state).filter(isSensitiveKey).sort();
}
