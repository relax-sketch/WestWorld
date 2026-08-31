import test from 'node:test';
import assert from 'node:assert/strict';

import { defaultSettings } from '../txtToWorldbook/core/constants.js';
import { createPromptRegistryService, PROMPT_MODULE_IDS } from '../txtToWorldbook/services/promptRegistryService.js';
import { createSettingsPersistenceService } from '../txtToWorldbook/services/settingsPersistenceService.js';

test('loading saved settings migrates prompt fields while retaining local API configuration', () => {
    const saved = {
        customWorldbookPrompt: 'OLD PROMPT',
        promptPrefixPreset: 'OLD PREFIX',
        mainApi: { provider: 'openai-compatible', apiKey: 'secret', endpoint: 'local', model: 'm', maxTokens: 500 },
    };
    globalThis.localStorage = {
        getItem: () => JSON.stringify(saved),
        setItem() {},
    };
    const AppState = {
        settings: {},
        processing: {},
        config: {
            parallel: {},
            chapterRegex: {},
            categoryDefault: {},
            entryPosition: {},
        },
        persistent: {},
    };
    const registry = createPromptRegistryService({ AppState });
    const service = createSettingsPersistenceService({
        AppState,
        defaultSettings,
        migrateLegacyPromptSettings: registry.migrateLegacySettings,
        updateSettingsUI() {},
        updateChapterRegexUI() {},
        handleProviderChange() {},
    });

    service.loadSavedSettings();

    assert.equal(AppState.settings.mainApi.apiKey, 'secret');
    assert.equal(
        AppState.settings.promptOverrides[PROMPT_MODULE_IDS.WORLDBOOK_SYSTEM].body,
        'OLD PROMPT',
    );
    assert.equal(AppState.settings.promptGlobal.prefix, 'OLD PREFIX');
});

test('loading saved chapter asset settings does not alter director mode semantics', () => {
    const saved = {
        directorMode: 'off',
        directorEnabled: false,
        chapterAssetsMode: 'local-presplit-ai-polish',
        chapterAssetsUseSpecializedPreset: true,
        chapterAssetsApiTarget: 'main',
        chapterAssetsConcurrency: 32,
        chapterAssetsWaitForPrevious: false,
        chapterAssetsLocalBeatCount: 7,
        chapterAssetsLocalSearchWindow: 1000,
        chapterAssetsLocalBoundaryPreference: 'sentence-first',
        customChapterAssetsPolishPrompt: 'CUSTOM POLISH',
        chapterAssetsShowRetryPolishButton: false,
        chapterAssetsShowUseLocalFallbackButton: true,
    };
    globalThis.localStorage = {
        getItem: () => JSON.stringify(saved),
        setItem() {},
    };
    const AppState = {
        settings: {},
        processing: {},
        config: {
            parallel: {},
            chapterRegex: {},
            categoryDefault: {},
            entryPosition: {},
        },
        persistent: {},
    };
    const registry = createPromptRegistryService({ AppState });
    const service = createSettingsPersistenceService({
        AppState,
        defaultSettings,
        migrateLegacyPromptSettings: registry.migrateLegacySettings,
        updateSettingsUI() {},
        updateChapterRegexUI() {},
        handleProviderChange() {},
    });

    service.loadSavedSettings();

    assert.equal(AppState.settings.directorMode, 'off');
    assert.equal(AppState.settings.directorEnabled, false);
    assert.equal(AppState.settings.chapterAssetsMode, 'local-presplit-ai-polish');
    assert.equal(AppState.settings.chapterAssetsUseSpecializedPreset, true);
    assert.equal(AppState.settings.chapterAssetsApiTarget, 'main');
    assert.equal(AppState.settings.chapterAssetsConcurrency, 32);
    assert.equal(AppState.settings.chapterAssetsWaitForPrevious, false);
    assert.equal(AppState.settings.chapterAssetsLocalBeatCount, 7);
    assert.equal(AppState.settings.chapterAssetsLocalSearchWindow, 1000);
    assert.equal(AppState.settings.chapterAssetsLocalBoundaryPreference, 'sentence-first');
    assert.equal(AppState.settings.customChapterAssetsPolishPrompt, 'CUSTOM POLISH');
    assert.equal(AppState.settings.chapterAssetsShowRetryPolishButton, false);
    assert.equal(AppState.settings.chapterAssetsShowUseLocalFallbackButton, true);
});

test('loading saved chapter asset settings accepts main-then-director routing', () => {
    assert.equal(defaultSettings.chapterAssetsApiTarget, 'director');
    globalThis.localStorage = {
        getItem: () => JSON.stringify({ chapterAssetsApiTarget: 'main-then-director' }),
        setItem() {},
    };
    const AppState = {
        settings: {},
        processing: {},
        config: {
            parallel: {},
            chapterRegex: {},
            categoryDefault: {},
            entryPosition: {},
        },
        persistent: {},
    };
    const registry = createPromptRegistryService({ AppState });
    const service = createSettingsPersistenceService({
        AppState,
        defaultSettings,
        migrateLegacyPromptSettings: registry.migrateLegacySettings,
        updateSettingsUI() {},
        updateChapterRegexUI() {},
        handleProviderChange() {},
    });

    service.loadSavedSettings();

    assert.equal(AppState.settings.chapterAssetsApiTarget, 'main-then-director');
});

test('next beat prefill uses the default when no saved value exists', () => {
    globalThis.localStorage = {
        getItem: () => null,
        setItem() {},
    };
    const service = createSettingsPersistenceService({
        AppState: { settings: {} },
        defaultSettings,
        updateSettingsUI() {},
        updateChapterRegexUI() {},
        handleProviderChange() {},
    });

    assert.equal(defaultSettings.nextBeatPrefillText, '开始这一拍');
    assert.equal(service.getNextBeatPrefillText(), '开始这一拍');
});

test('next beat prefill is saved, loaded, and read from persistent settings', () => {
    const storage = new Map();
    globalThis.localStorage = {
        getItem: (key) => storage.get(key) ?? null,
        setItem: (key, value) => storage.set(key, value),
    };
    globalThis.document = {
        getElementById: (id) => id === 'ttw-next-beat-prefill-text' ? { value: '进入新节拍' } : null,
    };
    const AppState = {
        settings: { ...defaultSettings },
        processing: {},
        config: {
            parallel: {},
            chapterRegex: {},
            categoryLight: {},
            categoryDefault: {},
            entryPosition: {},
            plotOutline: {},
        },
        persistent: {},
    };
    const service = createSettingsPersistenceService({
        AppState,
        defaultSettings,
        updateSettingsUI() {},
        updateChapterRegexUI() {},
        handleProviderChange() {},
    });

    service.saveCurrentSettings();
    AppState.settings.nextBeatPrefillText = '开始这一拍';
    service.loadSavedSettings();

    assert.equal(AppState.settings.nextBeatPrefillText, '进入新节拍');
    assert.equal(service.getNextBeatPrefillText(), '进入新节拍');
});
