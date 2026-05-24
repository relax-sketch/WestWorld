import test from 'node:test';
import assert from 'node:assert/strict';

import {
    applyPromptConfigPackage,
    applyResourcePackage,
    buildPromptConfigPackage,
    buildResourcePackage,
} from '../txtToWorldbook/services/packagePolicyService.js';
import { PROMPT_MODULE_IDS } from '../txtToWorldbook/services/promptRegistryService.js';

function createState() {
    return {
        settings: {
            promptConfigVersion: 1,
            promptGlobal: { prefix: 'GLOBAL START', suffix: 'GLOBAL END' },
            promptOverrides: {
                [PROMPT_MODULE_IDS.WORLDBOOK_SYSTEM]: { prefix: '', body: 'SYSTEM BODY', suffix: '' },
            },
            promptPrefixPresets: [{ name: 'preset', content: 'PREFIX PRESET' }],
            selectedPromptPrefixPreset: 'preset',
            promptMessageChain: [{ role: 'user', content: '{PROMPT}', enabled: true }],
            consolidatePromptPresets: [{ name: 'merge', prompt: 'MERGE PRESET' }],
            consolidateCategoryPresetMap: { role: 'merge' },
            mainApi: { apiKey: 'MAIN SECRET', endpoint: 'https://main', model: 'main-model' },
            directorApi: { apiKey: 'DIRECTOR SECRET', endpoint: 'https://director', model: 'director-model' },
            aiRoutePresets: [{ apiKey: 'ROUTE SECRET' }],
            selectedAiRoutePreset: 'route',
            chunkSize: 9000,
            minChunkSize: 1700,
            enablePlotOutline: true,
            directorMode: 'local-fallback',
        },
        config: {
            categoryLight: { role: true },
            parallel: { concurrency: 2 },
            chapterRegex: { pattern: '^chapter' },
            categoryDefault: { role: { position: 0 } },
            entryPosition: { role: 1 },
        },
        persistent: {
            customCategories: [{
                name: 'role',
                enabled: true,
                contentGuide: 'CATEGORY GUIDE',
                promptLayers: { prefix: 'CAT START', body: 'CAT BODY', suffix: 'CAT END' },
                promptDefaultLayers: { prefix: '', body: 'FIXED DEFAULT', suffix: '' },
                entryExample: 'PROMPT ENTRY EXAMPLE',
                keywordsExample: ['PROMPT KEYWORD EXAMPLE'],
                defaultPosition: 0,
            }],
            defaultEntries: [{ name: 'entry' }],
        },
        memory: { queue: [{ title: 'memory', result: { role: {} } }], startIndex: 0, userSelectedIndex: null },
        worldbook: { generated: { role: {} }, volumes: [], currentVolumeIndex: 0 },
        file: { hash: 'hash', novelName: 'novel', current: null },
        experience: {
            currentChapterIndex: 0,
            directorLastDecision: { stage_idx: 1 },
            directorLastInjectionPrompt: 'CACHED EDITABLE INJECTION',
            directorLastInjectionMeta: { contentHash: 'hash' },
        },
        processing: { incrementalMode: true, volumeMode: false },
    };
}

test('prompt configuration package carries editable prompts and presets but excludes API fields', () => {
    const state = createState();
    const payload = buildPromptConfigPackage(state);
    const serialized = JSON.stringify(payload);

    assert.equal(payload.type, 'WestWorld.promptConfig');
    assert.deepEqual(payload.promptGlobal, state.settings.promptGlobal);
    assert.deepEqual(payload.promptOverrides, state.settings.promptOverrides);
    assert.deepEqual(payload.promptMessageChain, state.settings.promptMessageChain);
    assert.deepEqual(payload.categoryPromptLayers, [{
        name: 'role',
        entryExample: 'PROMPT ENTRY EXAMPLE',
        keywordsExample: ['PROMPT KEYWORD EXAMPLE'],
        promptLayers: { prefix: 'CAT START', body: 'CAT BODY', suffix: 'CAT END' },
    }]);
    assert.equal(serialized.includes('MAIN SECRET'), false);
    assert.equal(serialized.includes('DIRECTOR SECRET'), false);
    assert.equal(serialized.includes('ROUTE SECRET'), false);
    assert.equal(Object.hasOwn(payload, 'settings'), false);
});

test('prompt configuration import modifies only editable prompt data even for legacy full settings', () => {
    const target = createState();
    target.settings.promptGlobal = { prefix: 'LOCAL PREFIX', suffix: 'LOCAL SUFFIX' };
    target.settings.mainApi.apiKey = 'KEEP MAIN';
    target.settings.directorApi.apiKey = 'KEEP DIRECTOR';
    target.persistent.customCategories[0].promptDefaultLayers.body = 'LOCAL FIXED DEFAULT';

    applyPromptConfigPackage(target, {
        type: 'AppState.settings',
        settings: {
            mainApi: { apiKey: 'DO NOT IMPORT' },
            directorApi: { apiKey: 'DO NOT IMPORT' },
            customWorldbookPrompt: 'LEGACY SYSTEM BODY',
            customSuffixPrompt: 'LEGACY GLOBAL SUFFIX',
        },
        customWorldbookCategories: [{
            name: 'role',
            promptLayers: { prefix: 'IMPORTED CAT', body: 'IMPORTED BODY', suffix: '' },
            promptDefaultLayers: { body: 'DO NOT IMPORT DEFAULT' },
        }],
    });

    assert.equal(target.settings.mainApi.apiKey, 'KEEP MAIN');
    assert.equal(target.settings.directorApi.apiKey, 'KEEP DIRECTOR');
    assert.equal(target.settings.promptGlobal.suffix, 'LEGACY GLOBAL SUFFIX');
    assert.equal(target.settings.promptOverrides[PROMPT_MODULE_IDS.WORLDBOOK_SYSTEM].body, 'LEGACY SYSTEM BODY');
    assert.equal(target.persistent.customCategories[0].promptLayers.body, 'IMPORTED BODY');
    assert.equal(target.persistent.customCategories[0].promptDefaultLayers.body, 'LOCAL FIXED DEFAULT');
});

test('resource package retains results and replay parameters but strips API and editable prompt configuration', () => {
    const state = createState();
    const payload = buildResourcePackage(state);
    const serialized = JSON.stringify(payload);

    assert.equal(payload.type, 'WestWorld.taskState');
    assert.deepEqual(payload.memoryQueue, state.memory.queue);
    assert.deepEqual(payload.generatedWorldbook, state.worldbook.generated);
    assert.equal(payload.resourceSettings.minChunkSize, 1700);
    assert.deepEqual(payload.experience.directorLastDecision, { stage_idx: 1 });
    assert.equal(Object.hasOwn(payload.experience, 'directorLastInjectionPrompt'), false);
    assert.deepEqual(payload.customWorldbookCategories, [{
        name: 'role',
        enabled: true,
        defaultPosition: 0,
    }]);
    assert.equal(serialized.includes('MAIN SECRET'), false);
    assert.equal(serialized.includes('GLOBAL START'), false);
    assert.equal(serialized.includes('CATEGORY GUIDE'), false);
    assert.equal(serialized.includes('PROMPT ENTRY EXAMPLE'), false);
    assert.equal(serialized.includes('CACHED EDITABLE INJECTION'), false);
    assert.equal(serialized.includes('ROUTE SECRET'), false);
});

test('legacy resource import applies replay fields while preserving local API and prompt configuration', () => {
    const target = createState();
    target.settings.mainApi.apiKey = 'KEEP MAIN';
    target.settings.promptGlobal.prefix = 'KEEP PROMPT';
    target.persistent.customCategories[0].contentGuide = 'KEEP GUIDE';

    const filtered = applyResourcePackage(target, {
        type: 'StoryWeaver.taskState',
        memoryQueue: [{ title: 'legacy memory' }],
        settings: {
            minChunkSize: 2200,
            mainApi: { apiKey: 'DO NOT IMPORT' },
            promptGlobal: { prefix: 'DO NOT IMPORT' },
            aiRoutePresets: [{ apiKey: 'DO NOT IMPORT' }],
        },
        customWorldbookCategories: [{
            name: 'role',
            enabled: false,
            contentGuide: 'DO NOT IMPORT GUIDE',
            promptLayers: { body: 'DO NOT IMPORT BODY' },
            defaultPosition: 2,
        }],
    });

    assert.equal(target.settings.minChunkSize, 2200);
    assert.equal(target.settings.mainApi.apiKey, 'KEEP MAIN');
    assert.equal(target.settings.promptGlobal.prefix, 'KEEP PROMPT');
    assert.equal(target.persistent.customCategories[0].contentGuide, 'KEEP GUIDE');
    assert.equal(target.persistent.customCategories[0].entryExample, 'PROMPT ENTRY EXAMPLE');
    assert.equal(target.persistent.customCategories[0].enabled, false);
    assert.equal(filtered.settings, undefined);
});
