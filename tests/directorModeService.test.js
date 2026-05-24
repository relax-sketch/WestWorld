import test from 'node:test';
import assert from 'node:assert/strict';

import { createDirectorService } from '../txtToWorldbook/services/directorService.js';
import {
    PROMPT_MODULE_IDS,
    createPromptRegistryService,
} from '../txtToWorldbook/services/promptRegistryService.js';

function createState(mode = 'api', fallbackOnError = true, promptOverrides = {}) {
    return {
        settings: {
            language: 'en',
            promptGlobal: { prefix: 'GLOBAL DIRECTOR START', suffix: 'GLOBAL DIRECTOR END' },
            promptOverrides,
            promptMessageChain: [{ role: 'user', content: 'MAIN CHAIN SHOULD NOT INJECT {PROMPT}' }],
            directorMode: mode,
            directorEnabled: mode !== 'off',
            directorFallbackOnError: fallbackOnError,
            directorRunEveryTurn: true,
            directorInjectionMarkerEnabled: false,
        },
        memory: {
            queue: [{
                chapterTitle: '第1章',
                chapterOutline: 'outline',
                chapterCurrentBeatIndex: 0,
                chapterScript: {
                    beats: [{
                        id: 'b1',
                        summary: 'current beat',
                        entryEvent: 'entry event',
                        exitCondition: 'exit event',
                        original_text: 'current original',
                    }],
                },
            }],
        },
        experience: { currentChapterIndex: 0, currentBeatIndex: 0, lastChapterIdx: 0, lastBeatIdx: 0 },
    };
}

function createService({ mode = 'api', fallbackOnError = true, response, fail = false, overrides = {} } = {}) {
    const standardOverrides = {
        [PROMPT_MODULE_IDS.DIRECTOR_FRAMEWORK]: {
            prefix: 'FRAME PREFIX',
            body: 'FRAME BODY {CURRENT_BEAT_INDEX}',
            suffix: 'FRAME SUFFIX',
        },
        [PROMPT_MODULE_IDS.DIRECTOR_INJECTION]: {
            prefix: 'INJECT PREFIX',
            body: 'INJECT BODY {DIRECTION_ACTION_CHAIN}',
            suffix: 'INJECT SUFFIX',
        },
        [PROMPT_MODULE_IDS.DIRECTOR_FALLBACK_END]: {
            prefix: '',
            body: 'LOCAL FALLBACK START→LOCAL FALLBACK MIDDLE→LOCAL FALLBACK END',
            suffix: '',
        },
        [PROMPT_MODULE_IDS.DIRECTOR_FALLBACK_NEW_BEAT]: {
            prefix: '',
            body: 'LOCAL FALLBACK START→LOCAL FALLBACK MIDDLE→LOCAL FALLBACK END',
            suffix: '',
        },
        [PROMPT_MODULE_IDS.DIRECTOR_FALLBACK_IN_BEAT]: {
            prefix: '',
            body: 'LOCAL FALLBACK START→LOCAL FALLBACK MIDDLE→LOCAL FALLBACK END',
            suffix: '',
        },
        ...overrides,
    };
    const AppState = createState(mode, fallbackOnError, standardOverrides);
    const promptRegistryService = createPromptRegistryService({ AppState });
    let apiCalls = 0;
    let sentPrompt = '';
    const service = createDirectorService({
        AppState,
        promptRegistryService,
        MemoryHistoryDB: {},
        Logger: { info: () => {}, warn: () => {} },
        callDirectorAPI: async (prompt) => {
            apiCalls += 1;
            sentPrompt = prompt;
            if (fail) throw new Error('director API failed');
            return response ?? '{"stage_idx":0,"direction_script":{"start":"model start action","action_chain":"model start action→model middle action→model end action","end":"model end action"}}';
        },
        debugLog: () => {},
        updateStreamContent: () => {},
        directorTelemetry: {
            makeRunId: () => 'run-test',
            markRunStarted: () => {},
            markApiResult: () => {},
            markGateSkipped: () => {},
            writeLog: () => {},
        },
    });
    return { AppState, service, getApiCalls: () => apiCalls, getSentPrompt: () => sentPrompt };
}

async function prepare(service) {
    return service.prepareDirectorInjectionForGeneration({
        type: 'normal',
        params: {},
        chat: [{ role: 'user', is_user: true, content: 'continue' }],
    });
}

test('api mode calls the director API with one global layer and renders injection without global or main chain', async () => {
    const setup = createService();
    const result = await prepare(setup.service);

    assert.equal(result.ok, true);
    assert.equal(setup.getApiCalls(), 1);
    assert.equal(setup.getSentPrompt().includes('FRAME PREFIX'), true);
    assert.equal(setup.getSentPrompt().match(/GLOBAL DIRECTOR START/g)?.length, 1);
    assert.equal(setup.getSentPrompt().match(/GLOBAL DIRECTOR END/g)?.length, 1);
    assert.equal(result.content.includes('INJECT PREFIX'), true);
    assert.equal(result.content.includes('INJECT SUFFIX'), true);
    assert.equal(result.content.includes('GLOBAL DIRECTOR'), false);
    assert.equal(result.content.includes('MAIN CHAIN SHOULD NOT INJECT'), false);

    const littleWhite = setup.service.getDirectorPromptForLittleWhiteBox({ mode: 'lastInjected' });
    assert.equal(littleWhite.ok, true);
    assert.equal(littleWhite.injection.identifier, 'westworld-director-current');
    assert.equal(littleWhite.injection.position, 'IN_PROMPT');
    assert.equal(littleWhite.injection.depth, 0);
    assert.equal(littleWhite.injection.content.includes('GLOBAL DIRECTOR'), false);
});

test('local-fallback mode skips the director API and uses the editable fallback module', async () => {
    const setup = createService({ mode: 'local-fallback' });
    const result = await prepare(setup.service);

    assert.equal(result.ok, true);
    assert.equal(setup.getApiCalls(), 0);
    assert.equal(result.content.includes('LOCAL FALLBACK'), true);
});

test('director context and actor injection guidance fragments are editable registry modules', async () => {
    const setup = createService({
        mode: 'local-fallback',
        overrides: {
            [PROMPT_MODULE_IDS.DIRECTOR_CONTEXT_START_ENTRY]: {
                prefix: '',
                body: 'EDITABLE CONTEXT START',
                suffix: '',
            },
            [PROMPT_MODULE_IDS.DIRECTOR_INJECTION_REQUIREMENT_STAY]: {
                prefix: '',
                body: 'EDITABLE STAY REQUIREMENT',
                suffix: '',
            },
            [PROMPT_MODULE_IDS.DIRECTOR_INJECTION]: {
                prefix: '',
                body: '{DIRECTION_START}|{STAGE_EXECUTION_REQUIREMENT}',
                suffix: '',
            },
        },
    });
    const result = await prepare(setup.service);

    assert.equal(result.ok, true);
    assert.equal(result.content.includes('EDITABLE CONTEXT START'), true);
    assert.equal(result.content.includes('EDITABLE STAY REQUIREMENT'), true);
});

test('off mode skips director prompt preparation without calling API', async () => {
    const setup = createService({ mode: 'off' });
    const result = await prepare(setup.service);

    assert.equal(setup.getApiCalls(), 0);
    assert.deepEqual(result, { ok: false, reason: 'directorMode=off' });
});

test('API failure and parse failure do not silently inject fallback when disabled', async () => {
    const failed = createService({ fallbackOnError: false, fail: true });
    const failedResult = await prepare(failed.service);
    assert.deepEqual(failedResult, { ok: false, reason: 'directorFallbackOnError=false' });

    const malformed = createService({ fallbackOnError: false, response: 'not-json' });
    const malformedResult = await prepare(malformed.service);
    assert.deepEqual(malformedResult, { ok: false, reason: 'directorFallbackOnError=false' });
});
