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
