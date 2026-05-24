import test from 'node:test';
import assert from 'node:assert/strict';

import {
    RESOURCE_TASK_STATE_TYPE,
    buildResourceTaskState,
    stripSensitiveTaskStateFields,
} from '../txtToWorldbook/services/taskStatePackageService.js';

function makeAppState() {
    return {
        memory: {
            queue: [
                {
                    title: '第一章',
                    content: '原文',
                    processed: true,
                    result: { 角色: { A: { 关键词: ['A'], 内容: '合并前资源' } } },
                    chapterOutline: '故事大纲',
                    chapterScript: { beats: [{ id: 'b1', summary: '切拍资源', original_text: '原文节拍' }] },
                    directorDecision: { stage_idx: 0, direction_script: { start: '起点', action_chain: '动作链', end: '终点' } },
                },
            ],
            startIndex: 0,
            userSelectedIndex: null,
        },
        worldbook: {
            generated: { 角色: { A: { 关键词: ['A'], 内容: '合并后世界书' } } },
            volumes: [{ 角色: { A: { 内容: '分卷世界书' } } }],
            currentVolumeIndex: 0,
        },
        file: { hash: 'hash-1', current: { name: 'novel.txt' }, novelName: 'novel' },
        experience: { currentChapterIndex: 0, currentBeatIndex: 0, directorLastDecision: { stage_idx: 0 }, directorLastInjectionPrompt: '敏感注入文本' },
        processing: { incrementalMode: true, volumeMode: false },
        settings: {
            customApiKey: 'secret-key',
            customApiEndpoint: 'https://api.example.com',
            promptPrefixPreset: 'PREFIX',
            customSuffixPrompt: 'SUFFIX',
            customWorldbookPrompt: 'WORLD PROMPT',
            customDirectorInjectionPrompt: 'INJECTION PROMPT',
            mainApi: { apiKey: 'main-secret', endpoint: 'main-endpoint' },
            directorApi: { apiKey: 'director-secret', endpoint: 'director-endpoint' },
        },
        config: { parallel: { enabled: true }, categoryLight: {}, chapterRegex: {} },
        persistent: { customCategories: [{ name: '角色', contentGuide: '分类提取提示词' }], defaultEntries: [] },
    };
}

test('buildResourceTaskState includes required resources and excludes settings', () => {
    const state = buildResourceTaskState(makeAppState(), {
        normalizeMemoryQueue: (queue) => queue,
        normalizeExperience: (experience) => experience,
        clampStartIndex: (value) => value,
        now: () => 1700000000000,
    });

    assert.equal(state.type, RESOURCE_TASK_STATE_TYPE);
    assert.equal(state.memoryQueue.length, 1);
    assert.equal(state.memoryQueue[0].chapterScript.beats[0].summary, '切拍资源');
    assert.equal(state.generatedWorldbook.角色.A.内容, '合并后世界书');
    assert.equal(state.worldbookVolumes[0].角色.A.内容, '分卷世界书');
    assert.equal(state.settings, undefined);
    assert.equal(state.parallelConfig, undefined);
    assert.equal(state.customWorldbookCategories, undefined);
});

test('stripSensitiveTaskStateFields removes API and prompt material recursively', () => {
    const unsafe = {
        type: 'legacy',
        memoryQueue: [],
        settings: { customApiKey: 'secret', customSuffixPrompt: 'suffix' },
        prompts: { worldbookPrompt: 'prompt' },
        mainApi: { apiKey: 'secret' },
        directorApi: { endpoint: 'endpoint' },
        generatedWorldbook: { 角色: { A: { 内容: 'safe resource' } } },
    };

    const safe = stripSensitiveTaskStateFields(unsafe);
    const serialized = JSON.stringify(safe);

    assert.equal(serialized.includes('secret'), false);
    assert.equal(serialized.includes('suffix'), false);
    assert.equal(serialized.includes('prompt'), false);
    assert.equal(serialized.includes('endpoint'), false);
    assert.equal(safe.generatedWorldbook.角色.A.内容, 'safe resource');
});
