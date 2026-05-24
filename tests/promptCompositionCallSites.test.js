import test from 'node:test';
import assert from 'node:assert/strict';

import { createPromptService } from '../txtToWorldbook/services/promptService.js';
import { createProcessingService } from '../txtToWorldbook/services/processingService.js';
import { createRepairService } from '../txtToWorldbook/services/repairService.js';
import { createRerollService } from '../txtToWorldbook/services/rerollService.js';
import { createImportMergeService } from '../txtToWorldbook/services/importMergeService.js';
import { createMergeWorkflowService } from '../txtToWorldbook/services/mergeWorkflowService.js';
import { createMergeService } from '../txtToWorldbook/services/mergeService.js';
import { createChapterExperienceView } from '../txtToWorldbook/ui/chapterExperienceView.js';
import {
    PROMPT_MODULE_IDS,
    createPromptRegistryService,
} from '../txtToWorldbook/services/promptRegistryService.js';
import {
    defaultConsolidatePrompt,
    defaultMergePrompt,
    defaultPlotPrompt,
    defaultStylePrompt,
    defaultWorldbookPrompt,
} from '../txtToWorldbook/core/constants.js';

function createState(promptOverrides = {}) {
    return {
        settings: {
            language: 'en',
            promptGlobal: { prefix: 'GLOBAL START', suffix: 'GLOBAL END' },
            promptOverrides,
            forceChapterMarker: false,
            enablePlotOutline: false,
            enableLiteraryStyle: false,
        },
        config: { parallel: { concurrency: 1 } },
        processing: { isStopped: false },
        memory: {
            queue: [{ title: 'Chapter', content: 'SOURCE', result: { 角色: { Alice: { 内容: 'OLD' } } } }],
        },
        persistent: {
            customCategories: [{ name: '角色', promptLayers: { prefix: '', body: 'GUIDE', suffix: '' }, contentGuide: 'GUIDE' }],
        },
        worldbook: { generated: { 角色: { Alice: { 关键词: ['A'], 内容: 'OLD' }, Alicia: { 关键词: ['A'], 内容: 'OLD2' } } } },
    };
}

function withModule(body, marker) {
    return { prefix: `${marker} PREFIX`, body, suffix: `${marker} SUFFIX` };
}

function assertCompletePrompt(prompt, marker) {
    assert.equal(prompt.includes(`${marker} PREFIX`), true);
    assert.equal(prompt.includes(`${marker} SUFFIX`), true);
    assert.equal(prompt.match(/GLOBAL START/g)?.length, 1);
    assert.equal(prompt.match(/GLOBAL END/g)?.length, 1);
}

test('prompt service renders editable system, previous-context and force-chapter modules', () => {
    const AppState = createState({
        [PROMPT_MODULE_IDS.WORLDBOOK_SYSTEM]: withModule('SYSTEM {DYNAMIC_JSON_TEMPLATE} {ENABLED_CATEGORY_NAMES}', 'SYSTEM'),
        [PROMPT_MODULE_IDS.WORLDBOOK_PREVIOUS_CONTEXT]: withModule('PREVIOUS {PREVIOUS_CHAPTER_INDEX} {PLOT_CONTEXT}', 'PREVIOUS'),
        [PROMPT_MODULE_IDS.WORLDBOOK_FORCE_CHAPTER]: withModule('FORCE {CHAPTER_INDEX}', 'FORCE'),
        [PROMPT_MODULE_IDS.GEMINI_USER_BRIDGE]: withModule('BRIDGE', 'BRIDGE'),
    });
    AppState.memory.queue.unshift({
        processed: true,
        failed: false,
        result: { 剧情节点: { Start: { 内容: 'context' } } },
    });
    const promptRegistryService = createPromptRegistryService({ AppState });
    const service = createPromptService({
        AppState,
        promptRegistryService,
        getEnabledCategories: () => [{ name: '角色' }],
        generateDynamicJsonTemplate: () => '{"角色":{}}',
        defaultWorldbookPrompt,
        defaultPlotPrompt,
        defaultStylePrompt,
    });

    const system = service.buildSystemPrompt();
    const previous = service.getPreviousMemoryContext(1);
    const forced = service.getChapterForcePrompt(7);
    const gemini = service.convertToGeminiContents([{ role: 'assistant', content: 'response' }]);

    assert.equal(system.includes('SYSTEM PREFIX'), true);
    assert.equal(system.includes('{"角色":{}}'), true);
    assert.equal(previous.includes('PREVIOUS PREFIX'), true);
    assert.equal(previous.includes('context'), true);
    assert.equal(forced.includes('FORCE 7'), true);
    assert.equal(gemini.contents[0].parts[0].text.includes('BRIDGE PREFIX'), true);
});

test('repair and single reroll requests use editable modules and one global layer', async () => {
    const AppState = createState({
        [PROMPT_MODULE_IDS.WORLDBOOK_REPAIR]: withModule(
            'REPAIR {CHAPTER_INDEX} {DYNAMIC_JSON_TEMPLATE} {CONTENT}',
            'REPAIR',
        ),
        [PROMPT_MODULE_IDS.WORLDBOOK_SINGLE_REROLL]: withModule(
            'REROLL {CATEGORY} {ENTRY_NAME} {CONTENT} {CATEGORY_GUIDE}',
            'REROLL',
        ),
    });
    const promptRegistryService = createPromptRegistryService({ AppState });
    const sent = [];
    const callAPI = async (prompt) => {
        sent.push(prompt);
        return '{"角色":{"Alice":{"关键词":["Alice"],"内容":"NEW"}}}';
    };

    const repair = createRepairService({
        AppState,
        promptRegistryService,
        MemoryHistoryDB: { saveRollResult: async () => {} },
        getChapterForcePrompt: () => '',
        generateDynamicJsonTemplate: () => '{"角色":{}}',
        getPreviousMemoryContext: () => '',
        callAPI,
        parseAIResponse: JSON.parse,
        postProcessResultWithChapterIndex: (value) => value,
        mergeWorldbookDataWithHistory: async () => {},
    });
    await repair.handleRepairSingleMemory(0);

    const reroll = createRerollService({
        AppState,
        promptRegistryService,
        MemoryHistoryDB: { saveRollResult: async () => {}, saveEntryRollResult: async () => {} },
        updateStopButtonVisibility: () => {},
        updateStreamContent: () => {},
        updateMemoryQueueUI: () => {},
        updateWorldbookPreview: () => {},
        callAPI,
        parseAIResponse: JSON.parse,
        getChapterForcePrompt: () => '',
        getPreviousMemoryContext: () => '',
    });
    await reroll.handleRerollSingleEntry({ memoryIndex: 0, category: '角色', entryName: 'Alice' });

    assertCompletePrompt(sent[0], 'REPAIR');
    assertCompletePrompt(sent[1], 'REROLL');
});

test('parallel worldbook extraction composes the editable request wrapper and globals once', async () => {
    const AppState = createState({
        [PROMPT_MODULE_IDS.WORLDBOOK_PARALLEL_REQUEST]: withModule(
            'PROCESS {SYSTEM_PROMPT} {CHAPTER_CONTENT} {REROLL_EXTRA}',
            'PROCESS',
        ),
        [PROMPT_MODULE_IDS.WORLDBOOK_REROLL_EXTRA]: withModule('EXTRA {CUSTOM_REQUIREMENT}', 'EXTRA'),
    });
    const promptRegistryService = createPromptRegistryService({ AppState });
    let sent = '';
    const service = createProcessingService({
        AppState,
        promptRegistryService,
        updateMemoryQueueUI: () => {},
        updateStreamContent: () => {},
        debugLog: () => {},
        callAPI: async (prompt) => {
            sent = prompt;
            return '{}';
        },
        isTokenLimitError: () => false,
        parseAIResponse: JSON.parse,
        postProcessResultWithChapterIndex: (value) => value,
        getChapterForcePrompt: () => '',
        buildSystemPrompt: () => 'SYSTEM',
        getPreviousMemoryContext: () => '',
        getEnabledCategories: () => [{ name: '角色' }],
    });

    await service.processMemoryChunkIndependent({
        index: 0,
        mode: 'worldbook-only',
        customPromptSuffix: 'CUSTOM',
    });

    assertCompletePrompt(sent, 'PROCESS');
    assert.equal(sent.includes('EXTRA PREFIX'), true);
    assert.equal(sent.includes('CUSTOM'), true);
});

test('imported merge, consolidate and alias requests use module layers and globals once', async () => {
    const AppState = createState({
        [PROMPT_MODULE_IDS.MERGE_IMPORTED]: withModule('IMPORTED {ENTRY_A} {ENTRY_B}', 'IMPORTED'),
        [PROMPT_MODULE_IDS.MERGE_CONSOLIDATE]: withModule('CONSOLIDATE {CONTENT}', 'CONSOLIDATE'),
        [PROMPT_MODULE_IDS.MERGE_CONSOLIDATE_RULES]: withModule('RULES', 'RULES'),
        [PROMPT_MODULE_IDS.MERGE_ALIAS]: withModule('ALIAS {pairsContent}', 'ALIAS'),
    });
    const promptRegistryService = createPromptRegistryService({ AppState });
    const sent = [];
    const callAPI = async (prompt) => {
        sent.push(prompt);
        if (prompt.includes('ALIAS')) {
            return '{"results":[{"pair":1,"nameA":"Alice","nameB":"Alicia","isSamePerson":false,"reason":"different"}]}';
        }
        return '{"关键词":["A"],"内容":"MERGED"}';
    };

    const imported = createImportMergeService({
        AppState,
        defaultMergePrompt,
        promptRegistryService,
        callAPI,
        parseAIResponse: JSON.parse,
    });
    await imported.mergeEntriesWithAI({ 内容: 'A' }, { 内容: 'B' });

    const workflow = createMergeWorkflowService({
        AppState,
        defaultConsolidatePrompt,
        promptRegistryService,
        mergeService: {},
        callAPI: async (prompt) => {
            sent.push(prompt);
            return 'CLEAN';
        },
        filterResponseContent: (value) => value,
    });
    await workflow.consolidateEntry('角色', 'Alice');

    const alias = createMergeService({
        AppState,
        promptRegistryService,
        callAPI,
        parseAIResponse: JSON.parse,
        updateStreamContent: () => {},
    });
    await alias.verifyDuplicatesWithAI([['Alice', 'Alicia']], false, 5, '角色');

    assertCompletePrompt(sent[0], 'IMPORTED');
    assertCompletePrompt(sent[1], 'CONSOLIDATE');
    assert.equal(sent[1].includes('RULES PREFIX'), true);
    assertCompletePrompt(sent[2], 'ALIAS');
});

test('chapter opening request is registry-composed and globally wrapped once', async () => {
    const AppState = createState({
        [PROMPT_MODULE_IDS.CHAPTER_OPENING]: withModule(
            'OPENING {CHAPTER_TITLE} {CHAPTER_SUMMARY} {CARRY_SOURCE} {CARRY_TEXT} {LEAD_TEXT}',
            'OPENING',
        ),
    });
    const promptRegistryService = createPromptRegistryService({ AppState });
    let sent = '';
    const view = createChapterExperienceView({
        AppState,
        promptRegistryService,
        callAPI: async (prompt) => {
            sent = prompt;
            return '开场正文。';
        },
    });

    await view.generateOpeningText({ chapterTitle: '第1章', chapterOutline: '摘要', content: '起始文本' }, 0);

    assertCompletePrompt(sent, 'OPENING');
});
