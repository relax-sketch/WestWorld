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

const defaultSettings = {
    panelCollapsed: true,
    directorSuffixEnabled: true,
};

let settings = {};
let txtToWorldbookModule = null;
let txtToWorldbookInitPromise = null;
let directorPromptReadyHandler = null;
let directorMessageSentHandler = null;
let directorGenerationStartedHandler = null;
const directorLifecycleHandlers = new Map();
const directorPromptGate = {
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

function delay(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

function mountDrawerHtml(html) {
    const existingWrapper = document.getElementById('westworld-wrapper');

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
        injectionPosition: INJECTION_POSITION?.ABSOLUTE ?? 1,
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

function repairDirectorPromptManagerEntry(options = {}) {
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

function getDirectorPromptManagerStatusSafe() {
    return getDirectorPromptManagerStatus(promptManager);
}

function clearDirectorPromptManager(reason = '') {
    const result = clearDirectorPromptManagerContent(promptManager, reason, getDirectorPromptManagerOptions());
    directorTrace(`PromptManager director prompt cleared: ${reason || 'no-reason'}`);
    return result;
}

function setDirectorPromptManagerDirectorContent(content) {
    const result = setDirectorPromptManagerContent(promptManager, content, getDirectorPromptManagerOptions());
    directorTrace(`PromptManager director prompt content length=${String(content || '').length}`);
    return result;
}

async function prepareDirectorPromptManagerForGeneration(eventContext = {}) {
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
    if (isRegenerateOrSwipe) {
        markDirectorEvent('PROMPT_MANAGER_REUSED', {
            type: generationType,
            params: generationParams,
            status: getDirectorPromptManagerStatusSafe(),
        });
        return { ok: true, reused: true, reason: 'regenerate-or-swipe' };
    }

    clearDirectorPromptManager('generation-started');

    if (directorPromptGate.inProgress) {
        markDirectorGateSkipped('inProgress-lock');
        return { ok: false, reason: 'inProgress-lock' };
    }

    const promptEntry = repairDirectorPromptManagerEntry({ save: false });
    if (!promptEntry.ok) {
        markDirectorGateSkipped(promptEntry.reason || 'prompt-manager-entry-not-ready', promptEntry);
        return { ok: false, reason: promptEntry.reason || 'prompt-manager-entry-not-ready' };
    }
    if (promptEntry.activeEnabled === false) {
        markDirectorGateSkipped('prompt-manager-entry-disabled', promptEntry.status || promptEntry);
        return { ok: false, reason: 'prompt-manager-entry-disabled' };
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
        if (!prepared?.ok || !prepared.content) {
            const reason = prepared?.reason || 'director-content-empty';
            markDirectorGateSkipped(reason, prepared || {});
            clearDirectorPromptManager(reason);
            return { ok: false, reason };
        }

        const setResult = setDirectorPromptManagerDirectorContent(prepared.content);
        if (!setResult.ok) {
            markDirectorGateSkipped(setResult.reason || 'prompt-manager-set-failed', setResult);
            return { ok: false, reason: setResult.reason || 'prompt-manager-set-failed' };
        }

        markDirectorEvent('PROMPT_MANAGER_READY', {
            contentLength: prepared.content.length,
            meta: prepared.meta || null,
            status: getDirectorPromptManagerStatusSafe(),
        });
        return { ok: true, meta: prepared.meta || null };
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
            }
        };
    }

    if (event_types?.MESSAGE_SENT && directorMessageSentHandler) {
        eventSource.off?.(event_types.MESSAGE_SENT, directorMessageSentHandler);
        eventSource.on(event_types.MESSAGE_SENT, directorMessageSentHandler);
    }

    if (event_types?.GENERATION_STARTED && directorGenerationStartedHandler) {
        eventSource.off?.(event_types.GENERATION_STARTED, directorGenerationStartedHandler);
        eventSource.on(event_types.GENERATION_STARTED, directorGenerationStartedHandler);
    }

    eventSource.off?.(event_types.CHAT_COMPLETION_PROMPT_READY, directorPromptReadyHandler);
    eventSource.on(event_types.CHAT_COMPLETION_PROMPT_READY, directorPromptReadyHandler);
    registerDirectorLifecycleHooks();
    directorPromptGate.hookRegistered = true;
    directorPromptGate.hookRegisteredAt = Date.now();
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
        eventSource.off?.(eventType, handler);
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
    ensureSettings();
    try {
        await setupUI();
    } catch (error) {
        console.error('[WestWorld] UI mount failed:', error);
        toastr.error('WestWorld UI mount failed. Please reload extensions.');
    }

    try {
        await ensureTxtToWorldbookReady();
        registerDirectorPromptHook();
        repairDirectorPromptManagerEntry({ save: true, clearContent: true });
        window.WestWorld = {
            openTxtConverter: openTxtToWorldbookPanel,
            getTxtToWorldbookApi: getTxtToWorldbookApiSafe,
            updateSelfFromRepo,
            getDirectorGateStatus,
            getDirectorPromptManagerStatus: getDirectorPromptManagerStatusSafe,
            repairDirectorPromptManagerEntry: () => repairDirectorPromptManagerEntry({ save: true }),
            clearDirectorPromptManagerContent: (reason) => clearDirectorPromptManager(reason || 'manual-clear'),
            getDirectorStatus: () => getTxtToWorldbookApiSafe()?.getDirectorRuntimeStatus?.() || null,
            getDirectorRuntimeStatus: () => getTxtToWorldbookApiSafe()?.getDirectorRuntimeStatus?.() || null,
            getDirectorLogs: (limit) => getTxtToWorldbookApiSafe()?.getDirectorLogs?.(limit) || [],
            clearDirectorLogs: () => getTxtToWorldbookApiSafe()?.clearDirectorLogs?.(),
            getDirectorContext: (options) => getTxtToWorldbookApiSafe()?.getDirectorContext?.(options) || { ok: false, reason: 'txtToWorldbook-api-not-ready' },
            getDirectorInjectionPrompt: (options) => getTxtToWorldbookApiSafe()?.getDirectorInjectionPrompt?.(options) || { ok: false, reason: 'txtToWorldbook-api-not-ready' },
            getDirectorPromptForLittleWhiteBox: (options) => getTxtToWorldbookApiSafe()?.getDirectorPromptForLittleWhiteBox?.(options) || { ok: false, reason: 'txtToWorldbook-api-not-ready' },
            inspectDirectorInjection: (chat) => getTxtToWorldbookApiSafe()?.inspectDirectorInjection?.(chat) || { injected: false, reason: 'txtToWorldbook-api-not-ready' },
            testDirectorInjection: (options) => getTxtToWorldbookApiSafe()?.testDirectorInjection?.(options) || { ok: false, reason: 'txtToWorldbook-api-not-ready' },
            bindDirectorSessionToCurrentChapter: () => getTxtToWorldbookApiSafe()?.bindDirectorSessionToCurrentChapter?.() || { ok: false, reason: 'txtToWorldbook-api-not-ready' },
        };
        window.StoryWeaver = window.WestWorld;
        console.log('[WestWorld] Plugin initialized successfully');
    } catch (error) {
        console.error('[WestWorld] txtToWorldbook init failed:', error);
        toastr.error('WestWorld failed to initialize TXT converter.');
    }
}

jQuery(() => {
    bootstrap();
});
