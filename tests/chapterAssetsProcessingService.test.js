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
            chapterOutlineMaxRetries: 1,
            chapterAssetsUseSpecializedPreset: true,
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
    const logs = [];
    let directorCallIndex = 0;
    let mainCallIndex = 0;
    const promptRegistryService = createPromptRegistryService({ AppState });
    const service = createProcessingService({
        AppState,
        promptRegistryService,
        MemoryHistoryDB: { saveState: async () => {} },
        updateMemoryQueueUI() {},
        updateProgress() {},
        updateStreamContent(message) { logs.push(String(message || '')); },
        debugLog() {},
        callAPI: async (prompt) => {
            mainPrompts.push(prompt);
            if (mainResponses.length > 0) {
                const index = Math.min(mainCallIndex, mainResponses.length - 1);
                mainCallIndex += 1;
                const response = mainResponses[index];
                if (response instanceof Error) throw response;
                return response;
            }
            return JSON.stringify({ entry_events: [] });
        },
        callDirectorAPI: async (prompt) => {
            prompts.push(prompt);
            const index = Math.min(directorCallIndex, directorResponses.length - 1);
            directorCallIndex += 1;
            const response = directorResponses[index];
            if (response instanceof Error) throw response;
            return response;
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
    return { AppState, service, prompts, mainPrompts, logs };
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
    assert.equal(Array.isArray(prompts[0]), true);
    assert.deepEqual(prompts[0].map((message) => message.role), ['user', 'assistant', 'user']);
    const firstMessage = prompts[0][0].content;
    const assistantMessage = prompts[0][1].content;
    const finalMessage = prompts[0][2].content;
    assert.equal(firstMessage.includes('- 章节标题：第1章'), true);
    assert.equal(firstMessage.includes('- 上一章摘要：无'), true);
    assert.equal(firstMessage.includes('- 固定节拍数量：3'), true);
    assert.equal(firstMessage.includes('"id": "b1"'), true);
    assert.equal(assistantMessage.includes('已读取章节资料和本地预切节拍'), true);
    for (const placeholder of ['{CHAPTER_TITLE}', '{PREVIOUS_OUTLINE}', '{BEAT_COUNT}', '{LOCAL_BEATS_JSON}']) {
        assert.equal(firstMessage.includes(placeholder), false, placeholder);
        assert.equal(assistantMessage.includes(placeholder), false, placeholder);
        assert.equal(finalMessage.includes(placeholder), false, placeholder);
    }
    assert.equal((finalMessage.match(/你是章节导演资产元信息补全助手/g) || []).length, 1);
    assert.equal((finalMessage.match(/<interactive_input>/g) || []).length >= 1, true);
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
    assert.deepEqual(mainPrompts[0].map((message) => message.role), ['user', 'assistant', 'user']);
    assert.equal(mainPrompts[0][0].content.includes('- 固定节拍数量：3'), true);
});

test('chapter asset requests use the selected main API semaphore without chapter semaphore nesting', async () => {
    const content = '第一段开场，人物进入。\n\n第二段推进，冲突升级。\n\n第三段收束，局势落定。';
    const { AppState, service } = createHarness({
        content,
        settings: {
            chapterAssetsMode: 'local-presplit-ai-polish',
            chapterAssetsApiTarget: 'main',
            chapterAssetsLocalBeatCount: 3,
        },
        mainResponses: [buildPolishResponse()],
    });
    const acquired = [];
    AppState.processing.mainApiSemaphore = {
        async acquire() { acquired.push('main'); },
        release() {},
    };
    AppState.processing.chapterAssetsApiSemaphore = {
        async acquire() { acquired.push('chapter-assets'); },
        release() {},
    };

    await service.generateChapterAssets(0, { force: true, maxRetries: 0 });

    assert.deepEqual(acquired, ['main']);
});

test('director-only processing can skip the previous-chapter wait when disabled', async () => {
    const content = '第一段开场，人物进入。\n\n第二段推进，冲突升级。\n\n第三段收束，局势落定。';
    const { AppState, service } = createHarness({
        content,
        settings: {
            chapterAssetsMode: 'local-presplit-ai-polish',
            chapterAssetsWaitForPrevious: false,
            chapterAssetsLocalBeatCount: 3,
        },
        directorResponses: [buildPolishResponse()],
    });
    AppState.memory.queue.push({
        title: '记忆2',
        chapterTitle: '第2章',
        content,
        processed: false,
        failed: false,
        processing: false,
        chapterOutline: '',
        chapterOutlineStatus: 'pending',
        chapterOutlineError: '',
        chapterScript: { keyNodes: [], beats: [] },
    });

    assert.equal(await service.processDirectorChunk(1), true);
    assert.equal(AppState.memory.queue[1].chapterOutlineStatus, 'done');
});

test('custom chapter polish prompt keeps precedence over the specialized message chain', async () => {
    const content = '第一段开场，人物进入。\n\n第二段推进，冲突升级。\n\n第三段收束，局势落定。';
    const { service, prompts } = createHarness({
        content,
        settings: {
            chapterAssetsMode: 'local-presplit-ai-polish',
            chapterAssetsLocalBeatCount: 3,
            customChapterAssetsPolishPrompt: 'CUSTOM {CHAPTER_TITLE}',
        },
        directorResponses: [buildPolishResponse()],
    });

    await service.retryChapterOutline(0);

    assert.equal(Array.isArray(prompts[0]), false);
    assert.equal(prompts[0].includes('CUSTOM 第1章'), true);
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

test('missing outline is a contract failure eligible for route fallback', async () => {
    const content = '第一段开场，人物进入。\n\n第二段推进，冲突升级。\n\n第三段收束，局势落定。';
    const harness = createHarness({
        content,
        settings: {
            chapterAssetsMode: 'ai-anchor',
            chapterAssetsApiTarget: 'director',
            chapterOutlineMaxRetries: 0,
        },
        directorResponses: [JSON.stringify({
            script: { beats: [
                { id: 'b1', original_text: 'a' },
                { id: 'b2', original_text: 'b' },
                { id: 'b3', original_text: 'c' },
            ] },
        })],
    });

    await assert.rejects(() => harness.service.generateChapterAssets(0, { force: true, maxRetries: 0 }), /缺少 outline/);
    assert.equal(harness.AppState.memory.queue[0].chapterOutlineStatus, 'failed');
});

test('main-then-director switches after a non-retryable main validation failure', async () => {
    const content = '第一段开场，人物进入。\n\n第二段推进，冲突升级。\n\n第三段收束，局势落定。';
    const invalid = JSON.stringify({
        outline: '无效响应',
        beats: [{ id: 'b1', original_text: 'AI 不得返回原文' }, { id: 'b2' }, { id: 'b3' }],
    });
    const { AppState, service, logs, mainPrompts, prompts } = createHarness({
        content,
        settings: {
            chapterAssetsMode: 'local-presplit-ai-polish',
            chapterAssetsApiTarget: 'main-then-director',
            chapterAssetsLocalBeatCount: 3,
            chapterOutlineMaxRetries: 0,
        },
        mainResponses: [invalid],
        directorResponses: [buildPolishResponse()],
    });

    await service.generateChapterAssets(0, { force: true, maxRetries: 0, runId: 'job-1' });

    assert.equal(AppState.memory.queue[0].chapterOutlineStatus, 'done');
    assert.equal(mainPrompts.length, 1);
    assert.equal(prompts.length, 1);
    assert.equal(logs.some((line) => line.includes('[主API]') && line.includes('最终失败')), true);
    assert.equal(logs.some((line) => line.includes('[导演API]') && line.includes('请求成功')), true);
    assert.equal(logs.some((line) => line.includes('source=local-presplit-ai-polish')), true);
    assert.equal(AppState.memory.queue[0].chapterAssetsApiSource, 'director-after-main');
});

test('main-then-director gives the director target an independent retry budget', async () => {
    const content = '第一段开场，人物进入。\n\n第二段推进，冲突升级。\n\n第三段收束，局势落定。';
    const { AppState, service, logs, mainPrompts, prompts } = createHarness({
        content,
        settings: {
            chapterAssetsMode: 'local-presplit-ai-polish',
            chapterAssetsApiTarget: 'main-then-director',
            chapterAssetsLocalBeatCount: 3,
            chapterOutlineMaxRetries: 1,
        },
        mainResponses: [new Error('main network failed')],
        directorResponses: [new Error('director network failed'), buildPolishResponse()],
    });

    await service.generateChapterAssets(0, { force: true, maxRetries: 1 });

    assert.equal(AppState.memory.queue[0].chapterOutlineStatus, 'done');
    assert.equal(mainPrompts.length, 2);
    assert.equal(prompts.length, 2);
    assert.equal(logs.some((line) => line.includes('[导演API][AI补全] 发起元信息补全请求（尝试 2/2')), true);
});

test('cancelling during chapter asset retry backoff exits immediately', async () => {
    const content = '第一段开场，人物进入。\n\n第二段推进，冲突升级。\n\n第三段收束，局势落定。';
    const retryable = Object.assign(new Error('server unavailable'), { status: 500 });
    const { AppState, service } = createHarness({
        content,
        settings: { chapterAssetsApiTarget: 'main' },
        mainResponses: [retryable],
    });
    const controller = new AbortController();
    AppState.processing.runId = 'run-cancel-backoff';
    AppState.processing.abortSignal = controller.signal;
    const startedAt = Date.now();
    const pending = service.generateChapterAssets(0, {
        force: true,
        maxRetries: 1,
        runId: 'run-cancel-backoff',
    });
    setTimeout(() => controller.abort(), 10);

    await assert.rejects(pending, /ABORTED/);
    assert.ok(Date.now() - startedAt < 500);
});

test('route exhaustion keeps local draft while ai-anchor marks the chapter failed', async () => {
    const content = '第一段开场，人物进入。\n\n第二段推进，冲突升级。\n\n第三段收束，局势落定。';
    const invalidPolish = JSON.stringify({
        outline: '无效响应',
        beats: [{ id: 'b1', original_text: 'AI 不得返回原文' }, { id: 'b2' }, { id: 'b3' }],
    });
    const localHarness = createHarness({
        content,
        settings: {
            chapterAssetsMode: 'local-presplit-ai-polish',
            chapterAssetsApiTarget: 'main-then-director',
            chapterAssetsLocalBeatCount: 3,
            chapterOutlineMaxRetries: 0,
        },
        mainResponses: [invalidPolish],
        directorResponses: [invalidPolish],
    });

    await assert.rejects(() => localHarness.service.generateChapterAssets(0, { force: true, maxRetries: 0 }), /禁止字段/);
    assert.equal(localHarness.AppState.memory.queue[0].chapterOutlineStatus, 'polish_failed');
    assert.equal(!!localHarness.AppState.memory.queue[0].chapterAssetsDraft, true);

    const anchorHarness = createHarness({
        content,
        settings: {
            chapterAssetsMode: 'ai-anchor',
            chapterAssetsApiTarget: 'director',
            chapterOutlineMaxRetries: 0,
        },
        directorResponses: [JSON.stringify({
            outline: '校验失败',
            script: { beats: [{ id: 'b1', original_text: 'x' }, { id: 'b2', original_text: 'y' }, { id: 'b3', original_text: 'z' }] },
        })],
    });

    await assert.rejects(() => anchorHarness.service.generateChapterAssets(0, { force: true, maxRetries: 0 }), /章节概览校验失败/);
    assert.equal(anchorHarness.AppState.memory.queue[0].chapterOutlineStatus, 'failed');
    assert.equal(anchorHarness.AppState.memory.queue[0].chapterAssetsDraft, null);
    assert.equal(anchorHarness.logs.some((line) => line.includes('[导演API]') && line.includes('章节资产生成失败')), true);
});
