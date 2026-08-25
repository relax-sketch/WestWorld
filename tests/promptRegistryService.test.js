import test from 'node:test';
import assert from 'node:assert/strict';

import {
    PROMPT_MODULE_IDS,
    createPromptRegistryService,
} from '../txtToWorldbook/services/promptRegistryService.js';
import {
    defaultChapterAssetsPolishPrompt,
    defaultChapterAssetsPolishPromptLegacy,
    defaultDirectorInjectionPrompt,
    defaultWorldbookPrompt,
} from '../txtToWorldbook/core/constants.js';

function createState(overrides = {}) {
    return {
        settings: {
            language: 'en',
            promptGlobal: { prefix: '', suffix: '' },
            promptOverrides: {},
            ...overrides,
        },
    };
}

test('registry exposes immutable project defaults for existing prompts', () => {
    const registry = createPromptRegistryService({ AppState: createState() });

    assert.equal(
        registry.getResolvedModule(PROMPT_MODULE_IDS.WORLDBOOK_SYSTEM).body,
        defaultWorldbookPrompt,
    );
    assert.equal(
        registry.getResolvedModule(PROMPT_MODULE_IDS.DIRECTOR_INJECTION).body,
        defaultDirectorInjectionPrompt,
    );
});

test('chapter assets polish prompt is internal and hidden from general prompt editor modules', () => {
    const registry = createPromptRegistryService({
        AppState: createState({ chapterAssetsUseSpecializedPreset: true }),
    });

    assert.equal(
        registry.getResolvedModule(PROMPT_MODULE_IDS.DIRECTOR_CHAPTER_ASSETS_POLISH).body,
        defaultChapterAssetsPolishPrompt,
    );
    assert.equal(
        registry.listModules().some((module) => module.id === PROMPT_MODULE_IDS.DIRECTOR_CHAPTER_ASSETS_POLISH),
        false,
    );
    assert.equal(
        registry.listModules({ includeInternal: true }).some((module) => module.id === PROMPT_MODULE_IDS.DIRECTOR_CHAPTER_ASSETS_POLISH),
        true,
    );
});

test('chapter assets polish uses the legacy prompt until the specialized preset is selected', () => {
    const legacyRegistry = createPromptRegistryService({ AppState: createState() });
    const legacyResolved = legacyRegistry.getResolvedModule(PROMPT_MODULE_IDS.DIRECTOR_CHAPTER_ASSETS_POLISH);

    assert.equal(legacyResolved.body, defaultChapterAssetsPolishPromptLegacy);
    assert.deepEqual(legacyResolved.requiredPlaceholders, [
        '{CHAPTER_TITLE}',
        '{PREVIOUS_OUTLINE}',
        '{BEAT_COUNT}',
        '{LOCAL_BEATS_JSON}',
    ]);
    assert.deepEqual(legacyRegistry.getWarnings(
        PROMPT_MODULE_IDS.DIRECTOR_CHAPTER_ASSETS_POLISH,
        legacyResolved,
    ), []);

    const specializedRegistry = createPromptRegistryService({
        AppState: createState({ chapterAssetsUseSpecializedPreset: true }),
    });
    const specializedResolved = specializedRegistry.getResolvedModule(PROMPT_MODULE_IDS.DIRECTOR_CHAPTER_ASSETS_POLISH);

    assert.equal(specializedResolved.body, defaultChapterAssetsPolishPrompt);
    assert.deepEqual(specializedResolved.requiredPlaceholders, [
        '{CHAPTER_TITLE}',
        '{PREVIOUS_OUTLINE}',
        '{LOCAL_BEATS_JSON}',
        '{BEAT_COUNT}',
    ]);
});

test('chapter assets polish default is the offline-compiled single-message director template', () => {
    const task = '你是章节导演资产元信息补全助手';
    const taskMarker = `<interactive_input>\n${task}`;
    const removedModules = [
        '✅️我不是主角。（不讨好）',
        '🎁对白风格（ooc了自己改）配合对白生动化',
        '❄️文风：轻小说（上一版本默认）',
        '➡️文风结束',
        '🤖防机器人',
        '⚙️自定义设置',
        '⚙️正文添加标签',
        '🎁去八股',
    ];

    assert.equal((defaultChapterAssetsPolishPrompt.match(new RegExp(task, 'g')) || []).length, 1);
    assert.equal((defaultChapterAssetsPolishPrompt.match(new RegExp(taskMarker, 'g')) || []).length, 1);
    assert.equal((defaultChapterAssetsPolishPrompt.match(/<\/interactive_input>/g) || []).length, 1);
    assert.equal(defaultChapterAssetsPolishPrompt.includes('<Interaction_history>'), true);
    assert.equal(defaultChapterAssetsPolishPrompt.includes('<Creating_guidance>'), false);
    assert.equal(defaultChapterAssetsPolishPrompt.includes('赋予角色自主性：鼓励角色通过自己的性格情感做出选择，推动剧情'), false);
    assert.equal(defaultChapterAssetsPolishPrompt.includes('<think_format>'), true);
    assert.equal(defaultChapterAssetsPolishPrompt.includes('Avant de produire le résultat'), true);
    assert.equal(defaultChapterAssetsPolishPrompt.includes('<think><|no-trans|>'), true);
    assert.deepEqual(
        ['{CHAPTER_TITLE}', '{PREVIOUS_OUTLINE}', '{BEAT_COUNT}', '{LOCAL_BEATS_JSON}']
            .filter((placeholder) => !defaultChapterAssetsPolishPrompt.includes(placeholder)),
        [],
    );
    for (const moduleName of removedModules) {
        assert.equal(defaultChapterAssetsPolishPrompt.includes(moduleName), false, moduleName);
    }
});

test('an explicit empty override is preserved and warns rather than restoring default', () => {
    const AppState = createState({
        promptOverrides: {
            [PROMPT_MODULE_IDS.WORLDBOOK_SYSTEM]: { body: '' },
        },
    });
    const registry = createPromptRegistryService({ AppState });

    const resolved = registry.getResolvedModule(PROMPT_MODULE_IDS.WORLDBOOK_SYSTEM);
    const warnings = registry.getWarnings(PROMPT_MODULE_IDS.WORLDBOOK_SYSTEM, resolved);

    assert.equal(resolved.body, '');
    assert.equal(warnings.some((warning) => warning.type === 'empty-body'), true);
    assert.equal(warnings.some((warning) => warning.type === 'missing-placeholder'), true);
});

test('complete requests apply global layers once and language prompt when enabled', () => {
    const AppState = createState({
        language: 'zh',
        promptGlobal: { prefix: 'GLOBAL BEFORE', suffix: 'GLOBAL AFTER' },
        promptOverrides: {
            [PROMPT_MODULE_IDS.WORLDBOOK_SYSTEM]: { body: 'MAIN {DYNAMIC_JSON_TEMPLATE}' },
            [PROMPT_MODULE_IDS.WORLDBOOK_PLOT]: { body: 'PLOT' },
        },
    });
    const registry = createPromptRegistryService({ AppState });

    const result = registry.composeRequest([
        PROMPT_MODULE_IDS.WORLDBOOK_SYSTEM,
        PROMPT_MODULE_IDS.WORLDBOOK_PLOT,
    ]);

    assert.equal(result.includes('\u8bf7\u7528\u4e2d\u6587\u56de\u590d\u3002'), true);
    assert.equal(result.match(/GLOBAL BEFORE/g)?.length, 1);
    assert.equal(result.match(/GLOBAL AFTER/g)?.length, 1);
    assert.equal(result.includes('MAIN {DYNAMIC_JSON_TEMPLATE}'), true);
    assert.equal(result.includes('PLOT'), true);
});

test('complete requests can wrap pre-rendered runtime fragments with global layers once', () => {
    const AppState = createState({
        language: 'zh',
        promptGlobal: { prefix: 'GLOBAL BEFORE', suffix: 'GLOBAL AFTER' },
    });
    const registry = createPromptRegistryService({ AppState });

    const result = registry.composeFragments(['RUNTIME CONTEXT', 'RUNTIME CONTENT']);

    assert.equal(result.match(/GLOBAL BEFORE/g)?.length, 1);
    assert.equal(result.match(/GLOBAL AFTER/g)?.length, 1);
    assert.equal(result.includes('RUNTIME CONTEXT'), true);
    assert.equal(result.includes('RUNTIME CONTENT'), true);
});

test('injection rendering can bypass global and language layers', () => {
    const AppState = createState({
        language: 'zh',
        promptGlobal: { prefix: 'GLOBAL BEFORE', suffix: 'GLOBAL AFTER' },
        promptOverrides: {
            [PROMPT_MODULE_IDS.DIRECTOR_INJECTION]: { body: 'INJECTION ONLY' },
        },
    });
    const registry = createPromptRegistryService({ AppState });

    const result = registry.composeRequest(
        [PROMPT_MODULE_IDS.DIRECTOR_INJECTION],
        {},
        { includeGlobal: false },
    );

    assert.equal(result, 'INJECTION ONLY');
    assert.equal(result.includes('GLOBAL'), false);
    assert.equal(result.includes('\u8bf7\u7528\u4e2d\u6587'), false);
});

test('reset override restores the fixed project baseline', () => {
    const AppState = createState();
    const registry = createPromptRegistryService({ AppState });

    registry.setOverride(PROMPT_MODULE_IDS.WORLDBOOK_SYSTEM, { body: 'CHANGED' });
    assert.equal(registry.getResolvedModule(PROMPT_MODULE_IDS.WORLDBOOK_SYSTEM).body, 'CHANGED');

    registry.resetOverride(PROMPT_MODULE_IDS.WORLDBOOK_SYSTEM);
    assert.equal(
        registry.getResolvedModule(PROMPT_MODULE_IDS.WORLDBOOK_SYSTEM).body,
        defaultWorldbookPrompt,
    );
});

test('legacy prompt fields migrate into layered overrides without losing API settings', () => {
    const AppState = createState();
    const registry = createPromptRegistryService({ AppState });
    const legacy = {
        customWorldbookPrompt: 'LEGACY WORLDBOOK',
        customDirectorFrameworkPrompt: 'LEGACY FRAMEWORK',
        customDirectorFrameworkSuffix: 'FRAMEWORK END',
        customDirectorInjectionPrompt: 'LEGACY INJECTION',
        customDirectorInjectionSuffix: 'INJECTION END',
        promptPrefixPreset: 'LEGACY GLOBAL START',
        customSuffixPrompt: 'LEGACY GLOBAL END',
        mainApi: { apiKey: 'local-secret' },
        directorEnabled: false,
    };

    const migrated = registry.migrateLegacySettings(legacy);

    assert.equal(migrated.promptConfigVersion, 1);
    assert.deepEqual(migrated.mainApi, { apiKey: 'local-secret' });
    assert.deepEqual(migrated.promptGlobal, {
        prefix: 'LEGACY GLOBAL START',
        suffix: 'LEGACY GLOBAL END',
    });
    assert.equal(migrated.promptOverrides[PROMPT_MODULE_IDS.WORLDBOOK_SYSTEM].body, 'LEGACY WORLDBOOK');
    assert.deepEqual(migrated.promptOverrides[PROMPT_MODULE_IDS.DIRECTOR_FRAMEWORK], {
        body: 'LEGACY FRAMEWORK',
        suffix: 'FRAMEWORK END',
    });
    assert.deepEqual(migrated.promptOverrides[PROMPT_MODULE_IDS.DIRECTOR_INJECTION], {
        body: 'LEGACY INJECTION',
        suffix: 'INJECTION END',
    });
    assert.equal(migrated.directorMode, 'off');
});
