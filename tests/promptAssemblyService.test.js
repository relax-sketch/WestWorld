import test from 'node:test';
import assert from 'node:assert/strict';

import {
    PROMPT_TARGETS,
    assemblePromptParts,
    createPromptAssemblyService,
} from '../txtToWorldbook/services/promptAssemblyService.js';
import { createPromptService } from '../txtToWorldbook/services/promptService.js';

function makeAppState(overrides = {}) {
    return {
        settings: {
            language: 'zh',
            promptPrefixPreset: 'GLOBAL PREFIX',
            customSuffixPrompt: 'GLOBAL SUFFIX',
            customDirectorFrameworkSuffix: 'DIRECTOR FRAMEWORK SUFFIX',
            customDirectorInjectionSuffix: 'DIRECTOR INJECTION SUFFIX',
            directorSuffixEnabled: true,
            ...overrides,
        },
    };
}

test('assemblePromptParts joins non-empty prompt sections in stable order', () => {
    const prompt = assemblePromptParts({
        languagePrefix: 'LANG',
        globalPrefix: 'PREFIX',
        body: 'BODY',
        targetSuffix: 'TARGET SUFFIX',
        globalSuffix: 'GLOBAL SUFFIX',
        finalInstruction: 'FINAL',
    });

    assert.equal(prompt, 'LANG\n\nPREFIX\n\nBODY\n\nTARGET SUFFIX\n\nGLOBAL SUFFIX\n\nFINAL');
});

test('assembleTargetPrompt applies global prefix and suffix to every configured target', () => {
    const service = createPromptAssemblyService({ AppState: makeAppState() });
    for (const target of Object.values(PROMPT_TARGETS)) {
        const prompt = service.assembleTargetPrompt(target, `${target} BODY`, {
            targetSuffix: `${target} TARGET`,
            finalInstruction: `${target} FINAL`,
        });
        assert.match(prompt, /^请用中文回复。\n\nGLOBAL PREFIX\n\n/);
        assert.match(prompt, new RegExp(`${target} BODY`));
        assert.match(prompt, new RegExp(`${target} TARGET`));
        assert.match(prompt, /GLOBAL SUFFIX/);
        assert.match(prompt, new RegExp(`${target} FINAL$`));
    }
});

test('director suffix can be disabled without disabling global suffix', () => {
    const service = createPromptAssemblyService({
        AppState: makeAppState({ directorSuffixEnabled: false }),
    });

    const prompt = service.assembleDirectorFrameworkPrompt('FRAMEWORK BODY');

    assert.equal(prompt.includes('DIRECTOR FRAMEWORK SUFFIX'), false);
    assert.equal(prompt.includes('GLOBAL SUFFIX'), true);
});

test('global prefix and suffix can be disabled for nested category guide bodies', () => {
    const service = createPromptAssemblyService({ AppState: makeAppState() });

    const prompt = service.assembleTargetPrompt(PROMPT_TARGETS.CATEGORY_EXTRACTION, '角色内容指南', {
        includeLanguagePrefix: false,
        includeGlobalPrefix: false,
        includeGlobalSuffix: false,
    });

    assert.equal(prompt, '角色内容指南');
});

test('createPromptService exposes assembleTargetPrompt and PROMPT_TARGETS', () => {
    const promptService = createPromptService({
        AppState: makeAppState(),
        getEnabledCategories: () => [],
        generateDynamicJsonTemplate: () => '{}',
        defaultWorldbookPrompt: 'WORLD BODY',
        defaultPlotPrompt: '',
        defaultStylePrompt: '',
    });

    const prompt = promptService.assembleTargetPrompt(
        promptService.PROMPT_TARGETS.TXT_TO_WORLDBOOK,
        'BODY',
    );

    assert.equal(prompt, '请用中文回复。\n\nGLOBAL PREFIX\n\nBODY\n\nGLOBAL SUFFIX');
});

test('txt-to-worldbook and director chapter-assets targets append final JSON instructions after global suffix', () => {
    const service = createPromptAssemblyService({ AppState: makeAppState() });

    const worldbookPrompt = service.assembleTargetPrompt(PROMPT_TARGETS.TXT_TO_WORLDBOOK, 'WORLD BODY', {
        finalInstruction: '直接输出JSON格式结果，不要有其他内容。',
    });
    assert.equal(
        worldbookPrompt,
        '请用中文回复。\n\nGLOBAL PREFIX\n\nWORLD BODY\n\nGLOBAL SUFFIX\n\n直接输出JSON格式结果，不要有其他内容。',
    );

    const assetsPrompt = service.assembleTargetPrompt(PROMPT_TARGETS.DIRECTOR_CHAPTER_ASSETS, 'ASSETS BODY', {
        finalInstruction: '只输出章节资产JSON。',
    });
    assert.equal(
        assetsPrompt,
        '请用中文回复。\n\nGLOBAL PREFIX\n\nASSETS BODY\n\nGLOBAL SUFFIX\n\n只输出章节资产JSON。',
    );
});

test('consolidate and alias merge prompts use the same global prefix and suffix path', () => {
    const service = createPromptAssemblyService({ AppState: makeAppState() });

    const consolidatePrompt = service.assembleTargetPrompt(PROMPT_TARGETS.CONSOLIDATE_ENTRY, '整理正文', {
        finalInstruction: '不要输出解释文字，只输出整理后的正文。',
    });
    assert.equal(consolidatePrompt.endsWith('不要输出解释文字，只输出整理后的正文。'), true);
    assert.equal(consolidatePrompt.includes('GLOBAL PREFIX'), true);
    assert.equal(consolidatePrompt.includes('GLOBAL SUFFIX'), true);

    const aliasPrompt = service.assembleTargetPrompt(PROMPT_TARGETS.ALIAS_MERGE, '别名判断正文', {
        finalInstruction: '返回JSON格式。',
    });
    assert.equal(aliasPrompt.endsWith('返回JSON格式。'), true);
    assert.equal(aliasPrompt.includes('GLOBAL PREFIX'), true);
    assert.equal(aliasPrompt.includes('GLOBAL SUFFIX'), true);
});

test('director framework and director injection use target suffix before global suffix', () => {
    const service = createPromptAssemblyService({ AppState: makeAppState() });

    const framework = service.assembleDirectorFrameworkPrompt('FRAMEWORK BODY');
    assert.equal(
        framework,
        '请用中文回复。\n\nGLOBAL PREFIX\n\nFRAMEWORK BODY\n\nDIRECTOR FRAMEWORK SUFFIX\n\nGLOBAL SUFFIX',
    );

    const injection = service.assembleDirectorInjectionPrompt('INJECTION BODY');
    assert.equal(
        injection,
        '请用中文回复。\n\nGLOBAL PREFIX\n\nINJECTION BODY\n\nDIRECTOR INJECTION SUFFIX\n\nGLOBAL SUFFIX',
    );
});
