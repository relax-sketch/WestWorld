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
