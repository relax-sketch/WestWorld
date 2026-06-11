import test from 'node:test';
import assert from 'node:assert/strict';

import { defaultSettings } from '../txtToWorldbook/core/constants.js';
import { createPromptRegistryService } from '../txtToWorldbook/services/promptRegistryService.js';
import { createProcessingService } from '../txtToWorldbook/services/processingService.js';

function splitIntoThree(content) {
    const first = Math.floor(content.length / 3);
    const second = Math.floor((content.length * 2) / 3);
    return [content.slice(0, first), content.slice(first, second), content.slice(second)];
}

function buildPolishResponse(ids = ['b1', 'b2', 'b3']) {
    return JSON.stringify({
        outline: '主角一行人在本章完成一次清晰推进，先进入局面，再处理冲突，最后形成可承接的阶段结果。',
        beats: ids.map((id, index) => ({
            id,
            summary: `节拍${index + 1}摘要`,
            event_summary: `角色在地点推进事件${index + 1}并产生结果`,
            entry_event: `角色进入事件${index + 1}`,
            exit_condition: `当事件${index + 1}完成时`,
            split_reason: '该段构成独立叙事单元',
            tags: index === 0 ? ['开场'] : (index === ids.length - 1 ? ['收束'] : ['推进']),
            split_rule: {
                primary: index === ids.length - 1 ? 'conflict_closed' : 'goal_shift',
                rationale: '符合本地预切后的叙事推进',
            },
            self_review: '仅补全元信息',
        })),
    });
}

function buildLegacyAnchorResponse(content) {
    const segments = splitIntoThree(content);
    return JSON.stringify({
        outline: '旧 AI anchor 流程生成的大纲。',
        script: {
            beats: segments.map((segment, index) => ({
                id: `b${index + 1}`,
                summary: `旧节拍${index + 1}`,
                event_summary: `旧节拍${index + 1}`,
                entry_event: `旧入场${index + 1}`,
                exit_condition: `旧退出${index + 1}`,
                split_rule: { primary: 'goal_shift' },
                original_text: segment,
            })),
        },
    });
}

function createHarness({ settings = {}, content, directorResponses = [], mainResponses = [] } = {}) {
    const AppState = {
        settings: {
            ...defaultSettings,
            language: 'en',
            chapterOutlineMaxRetries: 0,
            ...settings,
        },
        memory: {
            queue: [{
                title: '记忆1',
                chapterTitle: '第1章',
                content,
                processed: false,
                failed: false,
                processing: false,
                chapterOutline: '',
                chapterOutlineStatus: 'pending',
                chapterOutlineError: '',
                chapterScript: { keyNodes: [], beats: [] },
            }],
        },
        processing: {
            isStopped: false,
            activeTasks: new Set(),
        },
        config: {
            parallel: {},
        },
    };
    const prompts = [];
    const mainPrompts = [];
    let directorCallIndex = 0;
    let mainCallIndex = 0;
    const promptRegistryService = createPromptRegistryService({ AppState });
    const service = createProcessingService({
        AppState,
        promptRegistryService,
        MemoryHistoryDB: { saveState: async () => {} },
        updateMemoryQueueUI() {},
        updateProgress() {},
        updateStreamContent() {},
        debugLog() {},
        callAPI: async (prompt) => {
            mainPrompts.push(prompt);
            if (mainResponses.length > 0) {
                const index = Math.min(mainCallIndex, mainResponses.length - 1);
                mainCallIndex += 1;
                return mainResponses[index];
            }
            return JSON.stringify({ entry_events: [] });
        },
        callDirectorAPI: async (prompt) => {
            prompts.push(prompt);
            const index = Math.min(directorCallIndex, directorResponses.length - 1);
            directorCallIndex += 1;
            return directorResponses[index];
        },
        isTokenLimitError: () => false,
        parseAIResponse: () => ({}),
        postProcessResultWithChapterIndex: (result) => result,
        mergeWorldbookDataWithHistory: () => ({}),
        getChapterForcePrompt: () => '',
        buildSystemPrompt: () => '',
        getPreviousMemoryContext: () => '',
        getEnabledCategories: () => [],
        splitMemoryIntoTwo: () => null,
        handleStartNewVolume: () => {},
        showProgressSection() {},
        updateStopButtonVisibility() {},
        updateVolumeIndicator() {},
        updateStartButtonState() {},
        showResultSection() {},
        updateWorldbookPreview() {},
        applyDefaultWorldbookEntries() {},
        ErrorHandler: { showUserError() {}, showUserSuccess() {} },
        handleRepairMemoryWithSplit: async () => {},
        setProcessingStatus(status) { AppState.processing.status = status; },
        getProcessingStatus() { return AppState.processing.status || 'idle'; },
    });
    return { AppState, service, prompts, mainPrompts };
}

test('local pre-split AI polish mode merges metadata and preserves original text', async () => {
    const content = '第一段开场，人物进入。\n\n第二段推进，冲突升级。\n\n第三段收束，局势落定。';
    const { AppState, service, prompts } = createHarness({
        content,
        settings: {
            chapterAssetsMode: 'local-presplit-ai-polish',
            chapterAssetsLocalBeatCount: 3,
            chapterAssetsLocalSearchWindow: 20,
        },
        directorResponses: [buildPolishResponse()],
    });

    const result = await service.retryChapterOutline(0);

    assert.equal(AppState.memory.queue[0].chapterOutlineStatus, 'done');
    assert.equal(AppState.memory.queue[0].chapterAssetsSource, 'local-presplit-ai-polish');
    assert.equal(AppState.memory.queue[0].chapterAssetsDraft, null);
    assert.equal(result.script.beats.map((beat) => beat.original_text).join(''), content);
    assert.equal(result.script.beats[0].entryEvent, '角色进入事件1');
    assert.equal(prompts[0].includes('本地预切节拍 JSON'), true);
});

test('chapter asset generation can route AI polish through the main API', async () => {
    const content = '第一段开场，人物进入。\n\n第二段推进，冲突升级。\n\n第三段收束，局势落定。';
    const { AppState, service, prompts, mainPrompts } = createHarness({
        content,
        settings: {
            chapterAssetsMode: 'local-presplit-ai-polish',
            chapterAssetsApiTarget: 'main',
            chapterAssetsLocalBeatCount: 3,
        },
        mainResponses: [buildPolishResponse()],
        directorResponses: [buildPolishResponse()],
    });

    await service.retryChapterOutline(0);

    assert.equal(AppState.memory.queue[0].chapterOutlineStatus, 'done');
    assert.equal(mainPrompts.length, 1);
    assert.equal(prompts.length, 0);
    assert.equal(mainPrompts[0].includes('本地预切节拍 JSON'), true);
});

test('invalid AI polish response stores draft and does not commit local fallback assets', async () => {
    const content = '第一段开场，人物进入。\n\n第二段推进，冲突升级。\n\n第三段收束，局势落定。';
    const invalid = JSON.stringify({
        outline: '无效响应',
        beats: [
            { id: 'b1', original_text: 'AI 不得返回原文' },
            { id: 'b2' },
            { id: 'b3' },
        ],
    });
    const { AppState, service } = createHarness({
        content,
        settings: {
            chapterAssetsMode: 'local-presplit-ai-polish',
            chapterAssetsLocalBeatCount: 3,
        },
        directorResponses: [invalid, invalid],
    });

    await assert.rejects(() => service.retryChapterOutline(0), /禁止字段/);

    const memory = AppState.memory.queue[0];
    assert.equal(memory.chapterOutlineStatus, 'polish_failed');
    assert.equal(!!memory.chapterAssetsDraft, true);
    assert.equal(memory.chapterScript.beats.length, 0);
    assert.equal(memory.chapterAssetsDraft.localScript.beats.map((beat) => beat.original_text).join(''), content);
});

test('retry AI polish reuses draft boundaries and commits formal assets on success', async () => {
    const content = '第一段开场，人物进入。\n\n第二段推进，冲突升级。\n\n第三段收束，局势落定。';
    const invalid = JSON.stringify({
        outline: '无效响应',
        beats: [{ id: 'x1' }, { id: 'b2' }, { id: 'b3' }],
    });
    const { AppState, service } = createHarness({
        content,
        settings: {
            chapterAssetsMode: 'local-presplit-ai-polish',
            chapterAssetsLocalBeatCount: 3,
        },
        directorResponses: [invalid, invalid, buildPolishResponse()],
    });

    await assert.rejects(() => service.retryChapterOutline(0), /ID不匹配/);
    const draftTexts = AppState.memory.queue[0].chapterAssetsDraft.localScript.beats.map((beat) => beat.original_text);

    const result = await service.retryChapterAssetsPolish(0);

    assert.equal(AppState.memory.queue[0].chapterOutlineStatus, 'done');
    assert.equal(AppState.memory.queue[0].chapterAssetsDraft, null);
    assert.deepEqual(result.script.beats.map((beat) => beat.original_text), draftTexts);
    assert.equal(result.script.beats.map((beat) => beat.original_text).join(''), content);
});

test('local fallback requires a draft and commits local assets explicitly', async () => {
    const content = '第一段开场，人物进入。\n\n第二段推进，冲突升级。\n\n第三段收束，局势落定。';
    const invalid = JSON.stringify({
        outline: '无效响应',
        beats: [{ id: 'b1', anchor: '禁止字段' }, { id: 'b2' }, { id: 'b3' }],
    });
    const { AppState, service } = createHarness({
        content,
        settings: {
            chapterAssetsMode: 'local-presplit-ai-polish',
            chapterAssetsLocalBeatCount: 3,
        },
        directorResponses: [invalid, invalid],
    });

    await assert.rejects(() => service.useLocalPresplitFallback(0), /没有可用/);
    await assert.rejects(() => service.retryChapterOutline(0), /禁止字段/);

    const result = await service.useLocalPresplitFallback(0);

    assert.equal(result.source, 'local-presplit-only');
    assert.equal(AppState.memory.queue[0].chapterOutlineStatus, 'done');
    assert.equal(AppState.memory.queue[0].chapterCurrentBeatIndex, 0);
    assert.equal(AppState.memory.queue[0].chapterAssetsSource, 'local-presplit-only');
    assert.equal(AppState.memory.queue[0].chapterAssetsDraft, null);
    assert.equal(AppState.memory.queue[0].chapterScript.beats.map((beat) => beat.original_text).join(''), content);
});

test('ai-anchor remains the default chapter asset generation mode', async () => {
    const content = '旧流程第一段。旧流程第二段。旧流程第三段。';
    const { AppState, service, prompts } = createHarness({
        content,
        settings: {
            chapterAssetsMode: undefined,
        },
        directorResponses: [buildLegacyAnchorResponse(content)],
    });

    const result = await service.retryChapterOutline(0);

    assert.equal(AppState.memory.queue[0].chapterOutlineStatus, 'done');
    assert.equal(AppState.memory.queue[0].chapterAssetsSource, 'legacy-script');
    assert.equal(result.script.beats.map((beat) => beat.original_text).join(''), content);
    assert.equal(prompts[0].includes('split_points'), true);
    assert.equal(prompts[0].includes('本地预切节拍 JSON'), false);
});
