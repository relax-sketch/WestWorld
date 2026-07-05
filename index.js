import * as scriptApi from '../../../../script.js';
import { extension_settings, renderExtensionTemplateAsync } from '../../../extensions.js';
import { promptManager } from '../../../../scripts/openai.js';
import { INJECTION_POSITION } from '../../../../scripts/PromptManager.js';
import { getDirectorSkipReason as getDirectorGateSkipReason } from './txtToWorldbook/services/directorGateService.js';
import {
    clearDirectorPromptManagerContent,
    ensureDirectorPromptManagerEntry,
    getDirectorPromptManagerStatus,
    setDirectorPromptManagerContent,
} from './txtToWorldbook/services/directorPromptManagerService.js';

const { saveSettingsDebounced, eventSource, event_types } = scriptApi;

const BRAND_NAME = 'WestWorld';
const LEGACY_BRAND_NAME = 'StoryWeaver';
const extensionName = 'westworld';
const legacyExtensionName = 'storyweaver';
const setupEventNamespace = '.westworld';
const WESTWORLD_REPO_URL = 'https://github.com/relax-sketch/WestWorld';
const LEGACY_REPO_URL = 'https://github.com/lokenpee/StoryWeaver';
const WESTWORLD_DIRECTOR_DEBUG_KEY = 'westworld-director-debug';
const LEGACY_DIRECTOR_DEBUG_KEY = 'storyweaver-director-debug';
const CHAT_CONTROL_BAR_ID = 'westworld-chat-control-bar';
const CHAT_CONTROL_PAUSE_ID = 'westworld-chat-pause-toggle';
const CHAT_CONTROL_PROGRESS_BADGE_ID = 'westworld-chat-progress-badge';
const CHAT_CONTROL_STYLE_ID = 'westworld-chat-control-style';
const CHAT_CONTROL_WAND_CONTAINER_ID = 'westworld-wand-control-container';
const CHAT_CONTROL_WAND_STYLE_ID = 'westworld-wand-control-style';
const EXTERNAL_DIRECTOR_PREPARE_TTL_MS = 60000;
const PROMPT_MANAGER_READY_TIMEOUT_MS = 5000;
const PROMPT_MANAGER_READY_POLL_MS = 150;

const defaultSettings = {
    panelCollapsed: true,
    directorSuffixEnabled: true,
};

let settings = {};
let txtToWorldbookModule = null;
let txtToWorldbookInitPromise = null;
let bootstrapPromise = null;
let directorPromptReadyHandler = null;
let directorMessageSentHandler = null;
let directorGenerationStartedHandler = null;
const directorLifecycleHandlers = new Map();
const chatControlRefreshHandlers = new Map();
let chatControlRefreshTimer = null;
const bootstrapStatus = {
    phase: 'idle',
    initialized: false,
    initStartedAt: 0,
    initFinishedAt: 0,
    outerApiReady: false,
    txtApiReady: false,
    promptManagerReady: false,
    uiMounted: false,
    hookRegistered: false,
    chatControlMounted: false,
    chatControlMountTarget: '',
    wandControlMounted: false,
    errors: [],
};
const directorPromptGate = {
    paused: false,
    pausedAt: 0,
    pendingUserSend: false,
    lastUserSendAt: 0,
    lastGeneration: null,
    lastHandledAt: 0,
    inProgress: false,
    hookRegistered: false,
    hookRegisteredAt: 0,
    lastSkipReason: '',
    lastLifecycleEvent: '',
    lastLifecycleAt: 0,
    externalPrepared: null,
};

function isDirectorTraceEnabled() {
    try {
        return localStorage.getItem(WESTWORLD_DIRECTOR_DEBUG_KEY) === 'true'
            || localStorage.getItem(LEGACY_DIRECTOR_DEBUG_KEY) === 'true';
    } catch (_) {
        return false;
    }
}

function directorTrace(message) {
    if (!isDirectorTraceEnabled()) return;
    console.debug(`[${BRAND_NAME}][DirectorGate] ${message}`);
}

function safeToastr(method, message) {
    try {
        if (typeof toastr !== 'undefined' && typeof toastr?.[method] === 'function') {
            toastr[method](message);
        }
    } catch (_) { }
}

function serializeError(error) {
    return {
        message: error?.message || String(error || 'unknown'),
        stack: error?.stack || '',
    };
}

function recordBootstrapError(step, error) {
    const item = {
        step: String(step || 'unknown'),
        at: Date.now(),
        ...serializeError(error),
    };
    bootstrapStatus.errors.push(item);
    if (bootstrapStatus.errors.length > 20) {
        bootstrapStatus.errors.splice(0, bootstrapStatus.errors.length - 20);
    }
    console.warn(`[${BRAND_NAME}] bootstrap step failed: ${item.step}`, error);
    return item;
}

async function runBootstrapStep(step, action) {
    bootstrapStatus.phase = step;
    try {
        return await action();
    } catch (error) {
        recordBootstrapError(step, error);
        return null;
    }
}

function getBootstrapStatus() {
    return {
        ...bootstrapStatus,
        errors: bootstrapStatus.errors.map((item) => ({ ...item })),
        txtApiReady: !!getTxtToWorldbookApiSafe(),
        promptManagerReady: isPromptManagerReady(),
        hookRegistered: directorPromptGate.hookRegistered,
    };
}

function removeEventListenerCompat(source, eventType, handler) {
    if (!source || !eventType || !handler) return;
    if (typeof source.off === 'function') {
        source.off(eventType, handler);
        return;
    }
    if (typeof source.removeListener === 'function') {
        source.removeListener(eventType, handler);
    }
}

function delay(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

function getExtensionFolderName() {
    const match = /\/scripts\/extensions\/third-party\/([^/]+)\//.exec(import.meta.url);
    return match?.[1] ? decodeURIComponent(match[1]) : BRAND_NAME;
}

function normalizeRepoUrl(repoUrl) {
    const raw = String(repoUrl || WESTWORLD_REPO_URL).trim();
    if (!raw) return '';

    try {
        const url = new URL(raw);
        if (!['https:', 'http:'].includes(url.protocol)) return '';
        url.hash = '';
        url.search = '';
        return url.toString().replace(/\/$/, '');
    } catch (_error) {
        return '';
    }
}

function getRepoFolderName(repoUrl) {
    try {
        const url = new URL(repoUrl);
        const segments = url.pathname.split('/').filter(Boolean);
        if (!segments.length) return '';
        return decodeURIComponent(segments[segments.length - 1]).replace(/\.git$/i, '');
    } catch (_error) {
        return '';
    }
}

function getJsonHeaders() {
    if (typeof scriptApi.getRequestHeaders === 'function') {
        return scriptApi.getRequestHeaders();
    }
    return {
        'Content-Type': 'application/json',
    };
}

async function updateExtensionByName(extensionFolder) {
    const response = await fetch('/api/extensions/update', {
        method: 'POST',
        headers: getJsonHeaders(),
        body: JSON.stringify({
            extensionName: extensionFolder,
            global: false,
        }),
    });

    let text = '';
    try {
        text = await response.text();
    } catch (_error) {
        text = '';
    }

    let data = null;
    if (text) {
        try {
            data = JSON.parse(text);
        } catch (_error) {
            data = null;
        }
    }

    return { response, text, data };
}

async function installExtensionFromRepo(repoUrl) {
    const response = await fetch('/api/extensions/install', {
        method: 'POST',
        headers: getJsonHeaders(),
        body: JSON.stringify({
            url: repoUrl,
            global: false,
            branch: '',
        }),
    });

    let text = '';
    try {
        text = await response.text();
    } catch (_error) {
        text = '';
    }

    let data = null;
    if (text) {
        try {
            data = JSON.parse(text);
        } catch (_error) {
            data = null;
        }
    }

    return { response, text, data };
}

async function updateSelfFromRepo(repoUrl = WESTWORLD_REPO_URL) {
    const normalizedRepoUrl = normalizeRepoUrl(repoUrl);
    if (!normalizedRepoUrl) {
        throw new Error('仓库地址无效，请检查后重试。');
    }

    const currentFolder = getExtensionFolderName();
    const repoFolder = getRepoFolderName(normalizedRepoUrl);
    const candidateFolders = [...new Set([currentFolder, repoFolder, BRAND_NAME, LEGACY_BRAND_NAME].filter(Boolean))];

    for (const folder of candidateFolders) {
        const { response, text, data } = await updateExtensionByName(folder);
        if (response.ok) {
            return {
                mode: 'update',
                extensionFolder: folder,
                repoUrl: normalizedRepoUrl,
                ...(data || {}),
            };
        }

        if (response.status !== 404) {
            const detail = text || response.statusText || `HTTP ${response.status}`;
            throw new Error(`更新失败：${detail}`);
        }
    }

    let installResult = await installExtensionFromRepo(normalizedRepoUrl);
    if (!installResult.response.ok && normalizedRepoUrl === WESTWORLD_REPO_URL) {
        // Fallback for users who still host the repository under the legacy name.
        installResult = await installExtensionFromRepo(LEGACY_REPO_URL);
    }
    if (installResult.response.ok) {
        return {
            mode: 'install',
            repoUrl: normalizedRepoUrl,
            ...(installResult.data || {}),
        };
    }

    const installDetail = installResult.text || installResult.response.statusText || `HTTP ${installResult.response.status}`;
    if (installResult.response.status === 409) {
        throw new Error('检测到同名目录已存在但无法直接更新，请到插件管理页确认该插件安装状态。');
    }
    throw new Error(`安装失败：${installDetail}`);
}

function mountDrawerHtml(html) {
    const existingWrapper = document.getElementById('westworld-wrapper');

    const backgroundButton = $('#backgrounds-button');
    if (backgroundButton.length > 0) {
        const backgroundPanel = $('#Backgrounds');
        backgroundButton.addClass('westworld-background-replaced');
        backgroundButton.attr('style', (_, current = '') => {
            const base = String(current || '').replace(/display\s*:\s*[^;]+;?/gi, '').trim();
            return `${base}${base && !base.endsWith(';') ? '; ' : ''}display: none !important;`;
        });
        backgroundPanel.removeClass('openDrawer open').addClass('closedDrawer');
        if (existingWrapper) {
            backgroundButton.after(existingWrapper);
        } else {
            backgroundButton.after(html);
        }
        return true;
    }

    const topbarAnchor = $('#extensions-settings-button');
    if (topbarAnchor.length > 0) {
        if (existingWrapper) {
            topbarAnchor.after(existingWrapper);
        } else {
            topbarAnchor.after(html);
        }
        return true;
    }

    const settingsPanel = $('#extensions_settings2');
    if (settingsPanel.length > 0) {
        if (existingWrapper) {
            settingsPanel.append(existingWrapper);
        } else {
            settingsPanel.append(html);
        }
        return true;
    }

    return false;
}

async function mountDrawerWithRetry(html, maxAttempts = 30, intervalMs = 200) {
    for (let attempt = 0; attempt < maxAttempts; attempt++) {
        if (mountDrawerHtml(html)) {
            return true;
        }
        await delay(intervalMs);
    }
    return false;
}

async function loadTxtToWorldbookModule() {
    if (!txtToWorldbookModule) {
        txtToWorldbookModule = await import('./txtToWorldbook/main.js');
    }
    return txtToWorldbookModule;
}

async function ensureTxtToWorldbookReady() {
    if (!txtToWorldbookInitPromise) {
        txtToWorldbookInitPromise = (async () => {
            const moduleRef = await loadTxtToWorldbookModule();
            await moduleRef.initTxtToWorldbookBridge();
            return moduleRef;
        })();
    }
    return txtToWorldbookInitPromise;
}

function getTxtToWorldbookApiSafe() {
    return txtToWorldbookModule?.getTxtToWorldbookApi?.();
}

function getDirectorGateStatus() {
    return {
        paused: directorPromptGate.paused,
        pausedAt: directorPromptGate.pausedAt,
        pendingUserSend: directorPromptGate.pendingUserSend,
        lastUserSendAt: directorPromptGate.lastUserSendAt,
        lastGeneration: directorPromptGate.lastGeneration,
        lastHandledAt: directorPromptGate.lastHandledAt,
        inProgress: directorPromptGate.inProgress,
        hookRegistered: directorPromptGate.hookRegistered,
        hookRegisteredAt: directorPromptGate.hookRegisteredAt,
        lastSkipReason: directorPromptGate.lastSkipReason,
        lastLifecycleEvent: directorPromptGate.lastLifecycleEvent,
        lastLifecycleAt: directorPromptGate.lastLifecycleAt,
        externalPrepared: directorPromptGate.externalPrepared,
        promptManager: getDirectorPromptManagerStatusSafe(),
    };
}

function markDirectorEvent(eventType, data = {}) {
    const api = getTxtToWorldbookApiSafe();
    api?.markDirectorEvent?.(eventType, data);
}

function markDirectorGateSkipped(reason, data = {}) {
    directorPromptGate.lastSkipReason = String(reason || '');
    const api = getTxtToWorldbookApiSafe();
    api?.markDirectorGateSkipped?.(reason, data);
}

function invalidateDirectorRuntime(reason, data = {}) {
    directorPromptGate.pendingUserSend = false;
    directorPromptGate.lastGeneration = null;
    directorPromptGate.externalPrepared = null;
    directorPromptGate.lastLifecycleEvent = String(reason || '');
    directorPromptGate.lastLifecycleAt = Date.now();
    const api = getTxtToWorldbookApiSafe();
    api?.invalidateDirectorRuntime?.(reason, data);
}

function extractGenerationContext(eventData) {
    if (eventData && typeof eventData === 'object') {
        return {
            type: eventData.type ?? eventData.generationType ?? directorPromptGate.lastGeneration?.type,
            params: eventData.params ?? eventData.generationParams ?? directorPromptGate.lastGeneration?.params,
            dryRun: eventData.dryRun ?? directorPromptGate.lastGeneration?.dryRun,
        };
    }
    return directorPromptGate.lastGeneration || {};
}

function getDirectorSkipReason(eventData) {
    return getDirectorGateSkipReason(eventData, {
        pendingUserSend: directorPromptGate.pendingUserSend,
        lastUserSendAt: directorPromptGate.lastUserSendAt,
        lastGeneration: extractGenerationContext(eventData),
    });
}

function getDirectorPromptManagerOptions() {
    return {
        injectionPosition: INJECTION_POSITION?.RELATIVE ?? 0,
    };
}

function savePromptManagerStructure(result) {
    if (!result?.ok || result.changed !== true) return;
    try {
        promptManager?.saveServiceSettings?.();
    } catch (error) {
        console.warn('[WestWorld] failed to save PromptManager settings:', error?.message || error);
    }
    try {
        saveSettingsDebounced?.();
    } catch (_) { }
}

function isPromptManagerReady() {
    return !!(promptManager?.serviceSettings && typeof promptManager.serviceSettings === 'object');
}

async function waitForPromptManagerReady(timeoutMs = PROMPT_MANAGER_READY_TIMEOUT_MS) {
    const deadline = Date.now() + Math.max(0, Number(timeoutMs) || 0);
    while (!isPromptManagerReady() && Date.now() < deadline) {
        await delay(PROMPT_MANAGER_READY_POLL_MS);
    }
    bootstrapStatus.promptManagerReady = isPromptManagerReady();
    return bootstrapStatus.promptManagerReady;
}

function repairDirectorPromptManagerEntry(options = {}) {
    if (!isPromptManagerReady()) {
        return {
            ok: false,
            reason: 'prompt-manager-settings-missing',
            status: getDirectorPromptManagerStatus(promptManager),
        };
    }
    const result = ensureDirectorPromptManagerEntry(promptManager, {
        ...getDirectorPromptManagerOptions(),
        ...(options.clearContent ? { content: '' } : {}),
    });
    if (options.save !== false) {
        savePromptManagerStructure(result);
    }
    return {
        ...result,
        status: getDirectorPromptManagerStatus(promptManager),
    };
}

async function repairDirectorPromptManagerEntryWhenReady(options = {}) {
    const ready = await waitForPromptManagerReady(options.timeoutMs ?? PROMPT_MANAGER_READY_TIMEOUT_MS);
    if (!ready) {
        return {
            ok: false,
            reason: 'prompt-manager-settings-missing',
            status: getDirectorPromptManagerStatus(promptManager),
        };
    }
    return repairDirectorPromptManagerEntry(options);
}

function getDirectorPromptManagerStatusSafe() {
    return getDirectorPromptManagerStatus(promptManager);
}

function createWestWorldApiShell() {
    return {
        init,
        openTxtConverter: openTxtToWorldbookPanel,
        getBootstrapStatus,
        getTxtToWorldbookApi: getTxtToWorldbookApiSafe,
        updateSelfFromRepo,
        getDirectorGateStatus,
        getDirectorPromptManagerStatus: getDirectorPromptManagerStatusSafe,
        repairDirectorPromptManagerEntry: (options = {}) => repairDirectorPromptManagerEntryWhenReady({ save: true, ...options }),
        clearDirectorPromptManagerContent: (reason) => clearDirectorPromptManager(reason || 'manual-clear'),
        getDirectorStatus: () => getTxtToWorldbookApiSafe()?.getDirectorRuntimeStatus?.() || null,
        getDirectorRuntimeStatus: () => getTxtToWorldbookApiSafe()?.getDirectorRuntimeStatus?.() || null,
        getDirectorLogs: (limit) => getTxtToWorldbookApiSafe()?.getDirectorLogs?.(limit) || [],
        clearDirectorLogs: () => getTxtToWorldbookApiSafe()?.clearDirectorLogs?.() || { ok: false, reason: 'txtToWorldbook-api-not-ready' },
        isDirectorPaused: () => directorPromptGate.paused === true,
        getDirectorPaused: () => ({ paused: directorPromptGate.paused, pausedAt: directorPromptGate.pausedAt }),
        setDirectorPaused: (paused, reason) => setDirectorPaused(paused, reason || 'api'),
        toggleDirectorPaused: (reason) => toggleDirectorPaused(reason || 'api'),
        getDirectorContext: (options) => getTxtToWorldbookApiSafe()?.getDirectorContext?.(options) || { ok: false, reason: 'txtToWorldbook-api-not-ready' },
        getDirectorInjectionPrompt: (options) => getTxtToWorldbookApiSafe()?.getDirectorInjectionPrompt?.(options) || { ok: false, reason: 'txtToWorldbook-api-not-ready' },
        getDirectorPromptForLittleWhiteBox: (options) => directorPromptGate.paused
            ? { ok: false, reason: 'director-paused', paused: true }
            : (getTxtToWorldbookApiSafe()?.getDirectorPromptForLittleWhiteBox?.(options) || { ok: false, reason: 'txtToWorldbook-api-not-ready' }),
        prepareDirectorPromptForInput,
        inspectDirectorInjection: (chat) => getTxtToWorldbookApiSafe()?.inspectDirectorInjection?.(chat) || { injected: false, reason: 'txtToWorldbook-api-not-ready' },
        testDirectorInjection: (options) => getTxtToWorldbookApiSafe()?.testDirectorInjection?.(options) || { ok: false, reason: 'txtToWorldbook-api-not-ready' },
        bindDirectorSessionToCurrentChapter: () => getTxtToWorldbookApiSafe()?.bindDirectorSessionToCurrentChapter?.() || { ok: false, reason: 'txtToWorldbook-api-not-ready' },
        nextBeat: () => getTxtToWorldbookApiSafe()?.nextBeat?.() || Promise.resolve({ ok: false, reason: 'txtToWorldbook-api-not-ready' }),
        nextChapter: () => getTxtToWorldbookApiSafe()?.nextChapter?.() || Promise.resolve({ ok: false, reason: 'txtToWorldbook-api-not-ready' }),
        getReadingProgressStatus: () => getTxtToWorldbookApiSafe()?.getReadingProgressStatus?.() || { ok: false, reason: 'txtToWorldbook-api-not-ready', display: '0/0' },
    };
}

function exposeWestWorldApiShell() {
    if (typeof window === 'undefined') return null;
    const existing = window.WestWorld && typeof window.WestWorld === 'object' ? window.WestWorld : {};
    const api = {
        ...existing,
        ...createWestWorldApiShell(),
    };
    window.WestWorld = api;
    window.StoryWeaver = api;
    bootstrapStatus.outerApiReady = true;
    return api;
}

function clearDirectorPromptManager(reason = '') {
    const result = clearDirectorPromptManagerContent(promptManager, reason, getDirectorPromptManagerOptions());
    directorTrace(`PromptManager director prompt cleared: ${reason || 'no-reason'}`);
    return result;
}

function setDirectorPaused(paused, reason = 'manual-toggle') {
    const nextPaused = paused === true;
    directorPromptGate.paused = nextPaused;
    directorPromptGate.pausedAt = nextPaused ? Date.now() : 0;
    clearExternalPreparedDirectorPrompt(nextPaused ? 'director-paused' : 'director-resumed');
    directorPromptGate.pendingUserSend = false;
    if (nextPaused) {
        clearDirectorPromptManager('director-paused');
        markDirectorGateSkipped('director-paused', { reason });
    } else {
        markDirectorEvent('DIRECTOR_RESUMED', { reason });
    }
    updateChatControlBar();
    return {
        ok: true,
        paused: directorPromptGate.paused,
        pausedAt: directorPromptGate.pausedAt,
        reason,
    };
}

function toggleDirectorPaused(reason = 'manual-toggle') {
    return setDirectorPaused(!directorPromptGate.paused, reason);
}

function setDirectorPromptManagerDirectorContent(content) {
    const result = setDirectorPromptManagerContent(promptManager, content, getDirectorPromptManagerOptions());
    directorTrace(`PromptManager director prompt content length=${String(content || '').length}`);
    return result;
}

function clearExternalPreparedDirectorPrompt(reason = '') {
    if (!directorPromptGate.externalPrepared) return;
    markDirectorEvent('PROMPT_MANAGER_EXTERNAL_PREPARED_CLEARED', {
        reason: String(reason || ''),
        prepared: directorPromptGate.externalPrepared,
    });
    directorPromptGate.externalPrepared = null;
}

function getReusableExternalPreparedDirectorPrompt() {
    const prepared = directorPromptGate.externalPrepared;
    if (!prepared) return null;
    if (Date.now() > prepared.expiresAt) {
        clearExternalPreparedDirectorPrompt('expired');
        return null;
    }
    const status = getDirectorPromptManagerStatusSafe();
    if (!status?.contentLength) {
        clearExternalPreparedDirectorPrompt('prompt-manager-content-empty');
        return null;
    }
    return { prepared, status };
}

async function prepareDirectorPromptForInput(options = {}) {
    if (directorPromptGate.paused) {
        clearDirectorPromptManager('director-paused');
        markDirectorGateSkipped('director-paused', { source: 'external-prepare' });
        return { ok: false, reason: 'director-paused', paused: true };
    }

    const normalizedOptions = typeof options === 'string' ? { userInput: options } : (options || {});
    const userInput = String(
        normalizedOptions.userInput
        || normalizedOptions.rawUserInput
        || normalizedOptions.originalUserInput
        || normalizedOptions.latestUserMessage
        || ''
    ).trim();
    const source = String(normalizedOptions.source || 'external').trim() || 'external';

    if (!userInput) {
        return { ok: false, reason: 'user-input-empty' };
    }

    clearExternalPreparedDirectorPrompt('new-external-prepare');
    directorPromptGate.pendingUserSend = true;
    directorPromptGate.lastUserSendAt = Date.now();

    const result = await prepareDirectorPromptManagerForGeneration({
        type: normalizedOptions.type || source,
        params: {
            ...(normalizedOptions.params || {}),
            external_director_prepare: true,
            source,
        },
        dryRun: normalizedOptions.dryRun === true,
        latestUserMessage: userInput,
        userInput,
        rawUserInput: userInput,
        originalUserInput: userInput,
        source,
    });

    if (!result?.ok) {
        directorPromptGate.externalPrepared = null;
        return result;
    }

    const status = getDirectorPromptManagerStatusSafe();
    directorPromptGate.externalPrepared = {
        source,
        at: Date.now(),
        expiresAt: Date.now() + EXTERNAL_DIRECTOR_PREPARE_TTL_MS,
        inputLength: userInput.length,
        contentLength: status?.contentLength || 0,
        contentHash: result?.meta?.contentHash || '',
        runId: result?.meta?.runId || '',
    };
    markDirectorEvent('PROMPT_MANAGER_EXTERNAL_PREPARED', {
        prepared: directorPromptGate.externalPrepared,
        meta: result?.meta || null,
    });
    return {
        ...result,
        externalPrepared: { ...directorPromptGate.externalPrepared },
        status,
    };
}

async function prepareDirectorPromptManagerForGeneration(eventContext = {}) {
    if (directorPromptGate.paused) {
        clearDirectorPromptManager('director-paused');
        markDirectorGateSkipped('director-paused', { type: eventContext?.type || '' });
        return { ok: false, reason: 'director-paused', paused: true };
    }

    if (scriptApi.main_api !== 'openai') {
        markDirectorGateSkipped('prompt-manager-openai-only', { mainApi: scriptApi.main_api || '' });
        return { ok: false, reason: 'prompt-manager-openai-only' };
    }

    const generationType = String(eventContext?.type || '');
    const generationParams = eventContext?.params || {};
    const isRegenerateOrSwipe = generationType === 'regenerate'
        || generationType === 'swipe'
        || generationParams.regenerate === true
        || generationParams.swipe === true;

    const promptEntry = repairDirectorPromptManagerEntry({ save: true });
    if (!promptEntry.ok) {
        markDirectorGateSkipped(promptEntry.reason || 'prompt-manager-entry-not-ready', promptEntry);
        return { ok: false, reason: promptEntry.reason || 'prompt-manager-entry-not-ready' };
    }
    const promptManagerEntryDisabled = promptEntry.activeEnabled === false;
    if (promptManagerEntryDisabled) {
        markDirectorEvent('PROMPT_MANAGER_ENTRY_DISABLED_DIRECTOR_ONLY', {
            status: promptEntry.status || promptEntry,
        });
        clearDirectorPromptManager('prompt-manager-entry-disabled');
    }

    if (!promptManagerEntryDisabled) {
        const reusableExternal = getReusableExternalPreparedDirectorPrompt();
        if (reusableExternal) {
            markDirectorEvent('PROMPT_MANAGER_EXTERNAL_REUSED', {
                type: generationType,
                params: generationParams,
                prepared: reusableExternal.prepared,
                status: reusableExternal.status,
            });
            return {
                ok: true,
                reused: true,
                reason: 'external-prepared',
                externalPrepared: reusableExternal.prepared,
                status: reusableExternal.status,
            };
        }

        if (isRegenerateOrSwipe) {
            const status = getDirectorPromptManagerStatusSafe();
            if (!status?.contentLength) {
                markDirectorGateSkipped('prompt-manager-reuse-empty', status || promptEntry);
                return { ok: false, reason: 'prompt-manager-reuse-empty' };
            }
            markDirectorEvent('PROMPT_MANAGER_REUSED', {
                type: generationType,
                params: generationParams,
                status,
            });
            return { ok: true, reused: true, reason: 'regenerate-or-swipe' };
        }
    }

    clearDirectorPromptManager('generation-started');

    if (directorPromptGate.inProgress) {
        markDirectorGateSkipped('inProgress-lock');
        return { ok: false, reason: 'inProgress-lock' };
    }

    const skipReason = getDirectorSkipReason(eventContext);
    if (skipReason) {
        markDirectorGateSkipped(skipReason);
        clearDirectorPromptManager(skipReason);
        return { ok: false, reason: skipReason };
    }

    directorPromptGate.inProgress = true;
    directorPromptGate.lastHandledAt = Date.now();
    try {
        const api = getTxtToWorldbookApiSafe();
        if (!api || typeof api.prepareDirectorInjectionForGeneration !== 'function') {
            markDirectorGateSkipped('txtToWorldbook-api-not-ready');
            clearDirectorPromptManager('txtToWorldbook-api-not-ready');
            return { ok: false, reason: 'txtToWorldbook-api-not-ready' };
        }

        const prepared = await api.prepareDirectorInjectionForGeneration(eventContext);
        let promptToSet = prepared;
        if (!promptToSet?.ok || !promptToSet.content) {
            const reason = prepared?.reason || 'director-content-empty';
            const shouldRespectSkip = [
                'directorEnabled=false',
                'directorMode=off',
                'directorFallbackOnError=false',
                'directorRunEveryTurn=false',
                'state-missing',
                'chapter-missing',
                'beats-missing',
            ].includes(reason);
            if (shouldRespectSkip) {
                markDirectorGateSkipped(reason, prepared || {});
                clearDirectorPromptManager(reason);
                return { ok: false, reason };
            }
            const fallbackPrompt = typeof api.getDirectorInjectionPrompt === 'function'
                ? api.getDirectorInjectionPrompt({ includeMarker: true })
                : null;
            if (!fallbackPrompt?.ok || !fallbackPrompt.content) {
                markDirectorGateSkipped(reason, {
                    prepared: prepared || {},
                    fallback: fallbackPrompt || null,
                });
                clearDirectorPromptManager(reason);
                return { ok: false, reason };
            }
            markDirectorEvent('PROMPT_MANAGER_FALLBACK_CURRENT_BEAT', {
                reason,
                meta: fallbackPrompt.meta || null,
            });
            promptToSet = fallbackPrompt;
        }

        if (promptManagerEntryDisabled) {
            clearDirectorPromptManager('prompt-manager-entry-disabled');
            const status = getDirectorPromptManagerStatusSafe();
            markDirectorEvent('PROMPT_MANAGER_ENTRY_DISABLED_DIRECTOR_READY', {
                contentLength: String(promptToSet.content || '').length,
                meta: promptToSet.meta || null,
                status,
            });
            return {
                ok: true,
                reason: 'prompt-manager-entry-disabled',
                promptManagerDisabled: true,
                injectionSkipped: true,
                meta: promptToSet.meta || null,
                status,
            };
        }

        const setResult = setDirectorPromptManagerDirectorContent(promptToSet.content);
        if (!setResult.ok) {
            markDirectorGateSkipped(setResult.reason || 'prompt-manager-set-failed', setResult);
            return { ok: false, reason: setResult.reason || 'prompt-manager-set-failed' };
        }

        markDirectorEvent('PROMPT_MANAGER_READY', {
            contentLength: promptToSet.content.length,
            meta: promptToSet.meta || null,
            status: getDirectorPromptManagerStatusSafe(),
        });
        return { ok: true, meta: promptToSet.meta || null };
    } catch (error) {
        clearDirectorPromptManager('prepare-error');
        console.warn('[WestWorld] director PromptManager prepare failed:', error?.message || error);
        invalidateDirectorRuntime('prompt-manager-prepare-error', { error: error?.message || String(error) });
        return { ok: false, reason: 'prompt-manager-prepare-error' };
    } finally {
        directorPromptGate.inProgress = false;
    }
}

function registerDirectorPromptHook() {
    if (!eventSource || !event_types?.CHAT_COMPLETION_PROMPT_READY) {
        directorTrace('eventSource or CHAT_COMPLETION_PROMPT_READY missing, skip register');
        return;
    }

    if (!directorMessageSentHandler && event_types?.MESSAGE_SENT) {
        directorMessageSentHandler = () => {
            directorPromptGate.pendingUserSend = true;
            directorPromptGate.lastUserSendAt = Date.now();
            markDirectorEvent('MESSAGE_SENT');
            directorTrace('MESSAGE_SENT received, mark pendingUserSend=true');
        };
    }

    if (!directorGenerationStartedHandler && event_types?.GENERATION_STARTED) {
        directorGenerationStartedHandler = async (type, params, dryRun) => {
            directorPromptGate.lastGeneration = {
                type,
                params,
                dryRun,
                at: Date.now(),
            };
            markDirectorEvent('GENERATION_STARTED', { type, dryRun, params });
            const isRegenerate = type === 'regenerate' || type === 'swipe' || !!params?.regenerate || !!params?.swipe;
            if (isRegenerate) {
                directorPromptGate.pendingUserSend = true;
                directorPromptGate.lastUserSendAt = Date.now();
                directorTrace(`GENERATION_STARTED(${type}) treated as user-triggered regenerate/swipe`);
            }
            await prepareDirectorPromptManagerForGeneration({ type, params, dryRun });
        };
    }

    if (!directorPromptReadyHandler) {
        directorPromptReadyHandler = async (eventData) => {
            markDirectorEvent('CHAT_COMPLETION_PROMPT_READY', {
                chatLength: Array.isArray(eventData?.chat) ? eventData.chat.length : -1,
                promptManager: getDirectorPromptManagerStatusSafe(),
            });

            try {
                const api = getTxtToWorldbookApiSafe();
                if (!api || typeof api.recordDirectorPromptReadyInspection !== 'function') {
                    directorTrace('skip ready inspection: txtToWorldbook api not ready');
                    markDirectorGateSkipped('txtToWorldbook-api-not-ready');
                    return;
                }
                const inspected = api.recordDirectorPromptReadyInspection(eventData?.chat);
                if (!inspected?.injected) {
                    directorTrace(`ready inspection miss: ${inspected?.reason || 'director-injection-not-found'}`);
                } else {
                    directorTrace(`ready inspection ok at index=${inspected.insertionIndex}`);
                }
            } catch (error) {
                console.warn('[WestWorld] director ready inspection failed:', error?.message || error);
                invalidateDirectorRuntime('ready-inspection-error', { error: error?.message || String(error) });
            } finally {
                directorPromptGate.pendingUserSend = false;
                clearExternalPreparedDirectorPrompt('prompt-ready');
            }
        };
    }

    if (event_types?.MESSAGE_SENT && directorMessageSentHandler) {
        removeEventListenerCompat(eventSource, event_types.MESSAGE_SENT, directorMessageSentHandler);
        eventSource.on(event_types.MESSAGE_SENT, directorMessageSentHandler);
    }

    if (event_types?.GENERATION_STARTED && directorGenerationStartedHandler) {
        removeEventListenerCompat(eventSource, event_types.GENERATION_STARTED, directorGenerationStartedHandler);
        eventSource.on(event_types.GENERATION_STARTED, directorGenerationStartedHandler);
    }

    removeEventListenerCompat(eventSource, event_types.CHAT_COMPLETION_PROMPT_READY, directorPromptReadyHandler);
    eventSource.on(event_types.CHAT_COMPLETION_PROMPT_READY, directorPromptReadyHandler);
    registerDirectorLifecycleHooks();
    directorPromptGate.hookRegistered = true;
    directorPromptGate.hookRegisteredAt = Date.now();
    bootstrapStatus.hookRegistered = true;
    getTxtToWorldbookApiSafe()?.markDirectorHookRegistered?.({
        gate: getDirectorGateStatus(),
    });
    directorTrace('director prompt hook registered');
}

function registerDirectorLifecycleHooks() {
    const lifecycleEvents = [
        'CHAT_CHANGED',
        'CHAT_CREATED',
        'MESSAGE_SWIPED',
        'MESSAGE_DELETED',
        'MESSAGE_EDITED',
        'MESSAGE_UPDATED',
        'CHARACTER_SELECTED',
    ];

    for (const eventName of lifecycleEvents) {
        const eventType = event_types?.[eventName];
        if (!eventType) continue;
        if (!directorLifecycleHandlers.has(eventName)) {
            directorLifecycleHandlers.set(eventName, (...args) => {
                invalidateDirectorRuntime(eventName.toLowerCase().replace(/_/g, '-'), { args });
                directorTrace(`${eventName} received, director runtime invalidated`);
            });
        }
        const handler = directorLifecycleHandlers.get(eventName);
        removeEventListenerCompat(eventSource, eventType, handler);
        eventSource.on(eventType, handler);
    }
}

function ensureSettings() {
    const legacySettings = extension_settings[legacyExtensionName] && typeof extension_settings[legacyExtensionName] === 'object'
        ? extension_settings[legacyExtensionName]
        : null;

    if (!extension_settings[extensionName]) {
        extension_settings[extensionName] = {
            ...defaultSettings,
            ...(legacySettings || {}),
        };
    }
    settings = {
        ...defaultSettings,
        ...(legacySettings || {}),
        ...extension_settings[extensionName],
    };
    extension_settings[extensionName] = settings;
    extension_settings[legacyExtensionName] = settings;
}

function persistSettings() {
    extension_settings[extensionName] = settings;
    extension_settings[legacyExtensionName] = settings;
    saveSettingsDebounced();
}

function updateDrawerUI() {
    const iconEl = document.getElementById('westworld-icon');
    const panelEl = document.getElementById('westworld-content-panel');
    if (!iconEl) return;

    if (settings.panelCollapsed) {
        iconEl.classList.remove('openIcon');
        iconEl.classList.add('closedIcon');
        if (panelEl) {
            panelEl.classList.remove('openDrawer');
            panelEl.classList.add('closedDrawer');
        }
    } else {
        iconEl.classList.remove('closedIcon');
        iconEl.classList.add('openIcon');
        if (panelEl) {
            panelEl.classList.remove('closedDrawer');
            panelEl.classList.add('openDrawer');
        }
    }
}

async function openTxtToWorldbookPanel() {
    try {
        await ensureTxtToWorldbookReady();
        const api = getTxtToWorldbookApiSafe();
        if (!api || typeof api.open !== 'function') {
            toastr.error('WestWorld converter is not ready yet.');
            return;
        }
        api.open();
    } catch (error) {
        console.error('[WestWorld] failed to open TXT converter:', error);
        toastr.error('WestWorld converter failed to load.');
    }
}

function ensureChatControlStyle() {
    if (document.getElementById(CHAT_CONTROL_STYLE_ID)) return;
    const style = document.createElement('style');
    style.id = CHAT_CONTROL_STYLE_ID;
    style.textContent = `
#${CHAT_CONTROL_BAR_ID},
#${CHAT_CONTROL_PAUSE_ID} {
    display: flex;
    align-items: center;
    gap: 10px;
}
#${CHAT_CONTROL_BAR_ID} .westworld-chat-control-icon,
#${CHAT_CONTROL_PAUSE_ID} .westworld-chat-control-icon {
    height: 20px;
    width: 20px;
    min-width: 20px;
    font-size: calc(var(--mainFontSize) * 1.1);
    display: flex;
    align-items: center;
    justify-content: center;
    pointer-events: none;
}
#${CHAT_CONTROL_BAR_ID}.westworld-chat-control-disabled {
    opacity: 0.45;
    cursor: not-allowed;
}
#${CHAT_CONTROL_PROGRESS_BADGE_ID} {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    min-width: 32px;
    height: 22px;
    box-sizing: border-box;
    margin-left: 4px;
    align-self: center;
    padding: 0 6px;
    border: 1px solid var(--SmartThemeBorderColor, rgba(255,255,255,0.2));
    border-radius: 999px;
    background: var(--black30a, rgba(0,0,0,0.28));
    color: var(--SmartThemeBodyColor, inherit);
    font-size: 11px;
    line-height: 1;
    font-variant-numeric: tabular-nums;
    text-align: center;
    white-space: nowrap;
    pointer-events: none;
    opacity: 0.88;
    order: 5;
}
`;
    document.head.appendChild(style);
}

function getChatControlStatus() {
    const api = getTxtToWorldbookApiSafe();
    if (!api || typeof api.getReadingProgressStatus !== 'function') {
        return { ok: false, reason: 'txtToWorldbook-api-not-ready', display: '0/0', canNextBeat: false, canNextChapter: false, totalBeats: 0 };
    }
    try {
        return api.getReadingProgressStatus();
    } catch (error) {
        console.warn('[WestWorld] failed to read progress status:', error?.message || error);
        return { ok: false, reason: 'status-error', display: '0/0', canNextBeat: false, canNextChapter: false, totalBeats: 0 };
    }
}

function updateChatControlBar() {
    const bar = document.getElementById(CHAT_CONTROL_BAR_ID);
    const badge = document.getElementById(CHAT_CONTROL_PROGRESS_BADGE_ID);
    if (!bar && !badge) return;

    const status = getChatControlStatus();
    const hasBeat = status?.ok === true && Number(status.totalBeats || 0) > 0;
    const nextBeatItem = bar?.querySelector('[data-westworld-action="next-beat"]') || bar;
    const pauseItem = document.getElementById(CHAT_CONTROL_PAUSE_ID);
    const busy = bar?.dataset.busy === '1';

    if (badge) {
        badge.textContent = String(status?.display || '0/0');
        badge.title = status?.ok
            ? `WestWorld ${status.currentChapter || 0}/${status.totalChapters || 0}`
            : 'WestWorld 未就绪';
    }
    if (nextBeatItem) {
        const disabled = busy || !hasBeat || (status.canNextBeat !== true && status.canNextChapter !== true);
        nextBeatItem.classList.toggle('westworld-chat-control-disabled', disabled);
        nextBeatItem.setAttribute('aria-disabled', disabled ? 'true' : 'false');
        nextBeatItem.title = status?.ok
            ? `WestWorld 下一拍 ${status?.display || '0/0'}`
            : 'WestWorld 未就绪';
    }
    if (pauseItem) {
        pauseItem.dataset.westworldPaused = directorPromptGate.paused ? '1' : '0';
        pauseItem.title = directorPromptGate.paused
            ? '恢复 WestWorld 导演 prompt'
            : '暂停 WestWorld 导演 prompt';
        const text = pauseItem.querySelector('[data-westworld-role="pause-label"]');
        if (text) text.textContent = directorPromptGate.paused ? '恢复' : '停止';
        const icon = pauseItem.querySelector('.westworld-chat-control-icon');
        if (icon) {
            icon.classList.toggle('fa-pause', !directorPromptGate.paused);
            icon.classList.toggle('fa-play', directorPromptGate.paused);
        }
    }
}

function scheduleChatControlRefresh(delayMs = 60) {
    if (chatControlRefreshTimer) {
        clearTimeout(chatControlRefreshTimer);
    }
    chatControlRefreshTimer = setTimeout(() => {
        chatControlRefreshTimer = null;
        const bar = document.getElementById(CHAT_CONTROL_BAR_ID);
        const badge = document.getElementById(CHAT_CONTROL_PROGRESS_BADGE_ID);
        if (!bar || !badge) {
            mountChatControlBar();
            return;
        }
        updateChatControlBar();
    }, Math.max(0, delayMs));
}

function setChatControlBusy(busy) {
    const bar = document.getElementById(CHAT_CONTROL_BAR_ID);
    if (!bar) return;
    bar.dataset.busy = busy ? '1' : '0';
    updateChatControlBar();
}

async function handleChatControlAction() {
    const api = getTxtToWorldbookApiSafe();
    if (!api) {
        toastr.warning('WestWorld 未就绪');
        updateChatControlBar();
        return;
    }

    if (typeof api.nextBeat !== 'function') {
        toastr.warning('WestWorld 控制接口不可用');
        updateChatControlBar();
        return;
    }

    setChatControlBusy(true);
    try {
        const before = getChatControlStatus();
        let result = null;
        let advancedChapter = false;

        if (before?.canNextBeat === true) {
            result = await api.nextBeat();
        } else if (before?.canNextChapter === true && typeof api.nextChapter === 'function') {
            result = await api.nextChapter();
            advancedChapter = true;
        } else {
            result = await api.nextBeat();
        }

        if (!result?.ok && result?.reason === 'last-beat' && typeof api.nextChapter === 'function') {
            const fallbackStatus = result?.status || getChatControlStatus();
            if (fallbackStatus?.canNextChapter === true) {
                result = await api.nextChapter();
                advancedChapter = true;
            }
        }

        const status = result?.status || getChatControlStatus();
        if (result?.ok) {
            toastr.success(advancedChapter ? '已进入下一章' : `已切换到 ${status?.display || '0/0'}`);
        } else {
            toastr.warning('无法切换下一拍');
        }
    } catch (error) {
        console.warn('[WestWorld] chat control action failed:', error?.message || error);
        toastr.error(error?.message || 'WestWorld 控制失败');
    } finally {
        setChatControlBusy(false);
        scheduleChatControlRefresh(0);
    }
}

function createChatControlBarElement() {
    const existing = document.getElementById(CHAT_CONTROL_BAR_ID);
    if (existing) {
        existing.remove();
    }
    const existingPause = document.getElementById(CHAT_CONTROL_PAUSE_ID);
    if (existingPause) {
        existingPause.remove();
    }

    const fragment = document.createDocumentFragment();

    const nextBeatItem = document.createElement('div');
    nextBeatItem.id = CHAT_CONTROL_BAR_ID;
    nextBeatItem.setAttribute('role', 'menuitem');
    nextBeatItem.tabIndex = 0;
    nextBeatItem.dataset.westworldAction = 'next-beat';
    nextBeatItem.dataset.busy = '0';
    nextBeatItem.innerHTML = `
        <div class="fa-solid fa-forward-step westworld-chat-control-icon"></div>
        <span>下一拍</span>
    `;

    nextBeatItem.addEventListener('click', () => {
        if (nextBeatItem.getAttribute('aria-disabled') === 'true') return;
        void handleChatControlAction();
    });
    nextBeatItem.addEventListener('keydown', (event) => {
        if (event.key !== 'Enter' && event.key !== ' ') return;
        event.preventDefault();
        if (nextBeatItem.getAttribute('aria-disabled') === 'true') return;
        void handleChatControlAction();
    });

    const pauseItem = document.createElement('div');
    pauseItem.id = CHAT_CONTROL_PAUSE_ID;
    pauseItem.setAttribute('role', 'menuitem');
    pauseItem.tabIndex = 0;
    pauseItem.dataset.westworldAction = 'toggle-pause';
    pauseItem.innerHTML = `
        <div class="fa-solid fa-pause westworld-chat-control-icon"></div>
        <span data-westworld-role="pause-label">停止</span>
    `;
    pauseItem.addEventListener('click', () => {
        toggleDirectorPaused('magic-wand');
    });
    pauseItem.addEventListener('keydown', (event) => {
        if (event.key !== 'Enter' && event.key !== ' ') return;
        event.preventDefault();
        toggleDirectorPaused('magic-wand');
    });

    fragment.appendChild(nextBeatItem);
    fragment.appendChild(pauseItem);
    return fragment;
}

function ensureChatControlWandStyle() {
    if (document.getElementById(CHAT_CONTROL_WAND_STYLE_ID)) return;
    const style = document.createElement('style');
    style.id = CHAT_CONTROL_WAND_STYLE_ID;
    style.textContent = `
#${CHAT_CONTROL_WAND_CONTAINER_ID} {
    display: flex;
    align-items: baseline;
}
`;
    document.head.appendChild(style);
}

function mountChatControlInWand() {
    const menu = document.getElementById('extensionsMenu');
    if (!menu) return false;

    ensureChatControlStyle();
    ensureChatControlWandStyle();

    let container = document.getElementById(CHAT_CONTROL_WAND_CONTAINER_ID);
    if (!container) {
        container = document.createElement('div');
        container.id = CHAT_CONTROL_WAND_CONTAINER_ID;
        container.className = 'extension_container';
        menu.appendChild(container);
    }

    container.innerHTML = '';
    container.appendChild(createChatControlBarElement());
    updateChatControlBar();
    bootstrapStatus.wandControlMounted = true;
    bootstrapStatus.chatControlMountTarget = 'extensionsMenu';
    return true;
}

function mountChatControlProgressBadge() {
    const wandButton = document.getElementById('extensionsMenuButton');
    if (!wandButton) return false;

    ensureChatControlStyle();

    let badge = document.getElementById(CHAT_CONTROL_PROGRESS_BADGE_ID);
    if (!badge) {
        badge = document.createElement('span');
        badge.id = CHAT_CONTROL_PROGRESS_BADGE_ID;
        badge.setAttribute('aria-label', 'WestWorld reading progress');
    }

    if (badge.previousElementSibling !== wandButton) {
        wandButton.insertAdjacentElement('afterend', badge);
    }

    updateChatControlBar();
    return true;
}

function mountChatControlBar() {
    const mountedInWand = mountChatControlInWand();
    const mountedBadge = mountChatControlProgressBadge();
    bootstrapStatus.chatControlMounted = mountedInWand || mountedBadge;
    bootstrapStatus.chatControlMountTarget = [
        mountedInWand ? 'extensionsMenu' : '',
        mountedBadge ? 'extensionsMenuButton-after' : '',
    ].filter(Boolean).join('+');
    return bootstrapStatus.chatControlMounted;
}

function registerChatControlRefreshHooks() {
    const refreshEvents = [
        'MESSAGE_SENT',
        'CHAT_CHANGED',
        'CHAT_CREATED',
        'MESSAGE_SWIPED',
        'MESSAGE_DELETED',
        'MESSAGE_EDITED',
        'MESSAGE_UPDATED',
        'MESSAGE_RECEIVED',
        'GENERATION_ENDED',
    ];

    for (const eventName of refreshEvents) {
        const eventType = event_types?.[eventName];
        if (!eventType) continue;
        if (!chatControlRefreshHandlers.has(eventName)) {
            chatControlRefreshHandlers.set(eventName, () => scheduleChatControlRefresh());
        }
        const handler = chatControlRefreshHandlers.get(eventName);
        removeEventListenerCompat(eventSource, eventType, handler);
        eventSource.on(eventType, handler);
    }

    $(document)
        .off('click.westworldChatControlRefresh', '#ttw-next-beat-btn,#ttw-prev-beat-btn,#ttw-next-chapter-btn,#ttw-prev-chapter-btn,#ttw-start-reading-first')
        .on('click.westworldChatControlRefresh', '#ttw-next-beat-btn,#ttw-prev-beat-btn,#ttw-next-chapter-btn,#ttw-prev-chapter-btn,#ttw-start-reading-first', () => {
            scheduleChatControlRefresh(160);
        });
}

async function setupUI() {
    const extensionFolder = getExtensionFolderName();

    // Load template using detected folder first, then fallback to the canonical name.
    let html = '';
    try {
        html = await renderExtensionTemplateAsync(`third-party/${extensionFolder}`, 'drawer-component');
    } catch (error) {
        if (extensionFolder !== BRAND_NAME) {
            try {
                html = await renderExtensionTemplateAsync(`third-party/${BRAND_NAME}`, 'drawer-component');
            } catch (_fallbackError) {
                html = await renderExtensionTemplateAsync(`third-party/${LEGACY_BRAND_NAME}`, 'drawer-component');
            }
        } else {
            html = await renderExtensionTemplateAsync(`third-party/${LEGACY_BRAND_NAME}`, 'drawer-component');
        }
    }

    if (!html || !String(html).trim()) {
        throw new Error('WestWorld drawer template is empty.');
    }

    const mounted = await mountDrawerWithRetry(html, 60, 250);
    if (!mounted) {
        // Fallback mount so the icon can still appear even if target selectors change.
        const existingWrapper = document.getElementById('westworld-wrapper');
        if (!existingWrapper) {
            document.body.insertAdjacentHTML('beforeend', html);
        }
        console.warn('[WestWorld] mount target not found, mounted to body fallback.');
    }

    // Rebind with namespace to avoid duplicated handlers on reload.
    $(document).off('click.storyweaver');
    $(document).off(`click${setupEventNamespace}`);
    $(document).on(`click${setupEventNamespace}`, '#westworld-wrapper .drawer-toggle', async (e) => {
        e.stopPropagation();
        await openTxtToWorldbookPanel();
    });
}

async function bootstrap() {
    bootstrapStatus.initStartedAt = Date.now();
    bootstrapStatus.initFinishedAt = 0;
    bootstrapStatus.initialized = false;
    bootstrapStatus.phase = 'starting';
    bootstrapStatus.errors = [];
    ensureSettings();
    exposeWestWorldApiShell();

    const uiMounted = await runBootstrapStep('setup-ui', async () => {
        await setupUI();
        return true;
    });
    bootstrapStatus.uiMounted = uiMounted === true;
    if (!bootstrapStatus.uiMounted) {
        safeToastr('error', 'WestWorld UI mount failed. Please reload extensions.');
    }

    const txtReady = await runBootstrapStep('txt-to-worldbook-init', async () => {
        await ensureTxtToWorldbookReady();
        return !!getTxtToWorldbookApiSafe();
    });
    bootstrapStatus.txtApiReady = txtReady === true;
    if (!bootstrapStatus.txtApiReady) {
        safeToastr('error', 'WestWorld failed to initialize TXT converter.');
    }

    if (bootstrapStatus.txtApiReady) {
        await runBootstrapStep('register-director-hook', async () => {
            registerDirectorPromptHook();
            return true;
        });
        await runBootstrapStep('mount-chat-control', async () => {
            mountChatControlBar();
            return true;
        });
        await runBootstrapStep('register-chat-control-hooks', async () => {
            registerChatControlRefreshHooks();
            return true;
        });
        void repairDirectorPromptManagerEntryWhenReady({
            save: true,
            clearContent: true,
            timeoutMs: PROMPT_MANAGER_READY_TIMEOUT_MS,
        }).then((result) => {
            if (!result?.ok) {
                recordBootstrapError('repair-prompt-manager-entry', new Error(result?.reason || 'prompt-manager-repair-failed'));
            }
        }).catch((error) => {
            recordBootstrapError('repair-prompt-manager-entry', error);
        });
        scheduleChatControlRefresh(0);
    }

    exposeWestWorldApiShell();
    bootstrapStatus.phase = 'ready';
    bootstrapStatus.initialized = true;
    bootstrapStatus.initFinishedAt = Date.now();
    console.log('[WestWorld] Plugin initialized', getBootstrapStatus());
    return getBootstrapStatus();
}

export async function init(options = {}) {
    if (bootstrapPromise) return bootstrapPromise;
    const force = options?.force === true;
    if (!force && bootstrapStatus.initialized && bootstrapStatus.txtApiReady) {
        return getBootstrapStatus();
    }
    bootstrapPromise = bootstrap().finally(() => {
        bootstrapPromise = null;
    });
    return bootstrapPromise;
}

if (typeof jQuery === 'function') {
    jQuery(() => {
        void init();
    });
} else {
    void init();
}
