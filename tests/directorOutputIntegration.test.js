import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import * as promptHelpers from '../txtToWorldbook/services/directorPromptManagerService.js';
import { createDirectorWorldInfoService, getDirectorOutputConfig } from '../txtToWorldbook/services/directorWorldInfoService.js';
import { getDirectorSkipReason } from '../txtToWorldbook/services/directorGateService.js';

const source = (await readFile(new URL('../index.js', import.meta.url), 'utf8'))
    .replace(/^import[\s\S]*?;\r?\n/gm, '')
    .replace('export async function init', 'async function init')
    .replaceAll('import.meta.url', "'http://localhost/scripts/extensions/third-party/WestWorld/index.js'")
    .replace("import('../../../../scripts/world-info.js')", 'loadWorldApi()');
const marker = '[WestWorld Director Injection]';

function fixture({ preset = false, worldbook = true, mainApi = 'openai', presetDisabled = false } = {}) {
    let config = { directorPresetEnabled: preset, directorWorldbookEnabled: worldbook, directorWorldName: 'Book', directorWorldEntryUid: '0' };
    let data = { entries: { 0: { uid: 0, content: '', position: 4, depth: 9, order: 555, constant: true } } };
    let runs = 0;
    const saves = [];
    const promptManager = {
        activeCharacter: { id: 1 },
        serviceSettings: { prompts: [], prompt_order: [{ character_id: 1, order: [] }] },
        getPromptOrderForCharacter() { return this.serviceSettings.prompt_order[0].order; },
        getPromptOrderEntry(_, identifier) { return this.getPromptOrderForCharacter().find((item) => item.identifier === identifier); },
        saveServiceSettings() {},
    };
    if (presetDisabled) {
        promptHelpers.ensureDirectorPromptManagerEntry(promptManager);
        promptManager.getPromptOrderForCharacter()[0].enabled = false;
    }
    const txtApi = {
        getDirectorOutputSettings: () => config,
        setDirectorOutputSettings: (next) => {
            config = { directorPresetEnabled: next.presetEnabled, directorWorldbookEnabled: next.worldbookEnabled, directorWorldName: next.worldName, directorWorldEntryUid: next.entryUid };
        },
        prepareDirectorInjectionForGeneration: async () => ({ ok: true, content: `${marker}\nround ${++runs}`, meta: {} }),
    };
    const ctx = vm.createContext({
        ...promptHelpers, createDirectorWorldInfoService, getDirectorOutputConfig,
        getDirectorGateSkipReason: getDirectorSkipReason,
        scriptApi: { main_api: mainApi, saveSettingsDebounced() {} },
        promptManager, INJECTION_POSITION: { RELATIVE: 0 },
        console, structuredClone, jQuery() {},
        document: { getElementById: () => null },
        loadWorldApi: async () => ({
            world_names: ['Book'], loadWorldInfo: async () => structuredClone(data),
            saveWorldInfo: async (name, updated, immediate) => { data = updated; saves.push({ name, immediate }); },
        }),
        txtApi,
    });
    vm.runInContext(source, ctx);
    vm.runInContext('txtToWorldbookModule = { getTxtToWorldbookApi: () => txtApi };', ctx);
    return {
        ctx, txtApi, promptManager, saves, data: () => data, runs: () => runs,
        generate: (type = 'normal', extra = {}) => ctx.prepareDirectorPromptManagerForGeneration({ type, params: {}, ...extra }),
        presetContent: () => promptManager.serviceSettings.prompts.find((p) => p.identifier === 'westworldDirector')?.content,
    };
}

test('worldbook-only generation writes before returning and never creates a preset entry', async () => {
    const f = fixture();
    assert.equal((await f.generate()).ok, true);
    assert.equal(f.data().entries[0].content, `${marker}\nround 1`);
    assert.equal(f.data().entries[0].depth, 9);
    assert.equal(f.data().entries[0].order, 555);
    assert.equal(f.presetContent(), undefined);
    assert.equal(f.saves[0].immediate, true);
    for (const type of ['regenerate', 'swipe', 'continue']) assert.equal((await f.generate(type)).ok, true);
    assert.equal(f.data().entries[0].content, `${marker}\nround 4`);
});

test('preset-only preserves the original generation route; both checked write identical content', async () => {
    const legacy = fixture({ preset: true, worldbook: false });
    assert.equal((await legacy.generate()).ok, true);
    assert.equal(legacy.presetContent(), `${marker}\nround 1`);
    assert.equal(legacy.saves.length, 0);
    const both = fixture({ preset: true });
    assert.equal((await both.generate()).ok, true);
    assert.equal(both.presetContent(), both.data().entries[0].content);
});

test('worldbook route also works outside OpenAI and when the native preset is disabled', async () => {
    for (const options of [{ mainApi: 'textgenerationwebui' }, { preset: true, presetDisabled: true }]) {
        const f = fixture(options);
        assert.equal((await f.generate()).ok, true);
        assert.equal(f.data().entries[0].content, `${marker}\nround 1`);
        assert.ok(!f.presetContent());
    }
});

test('quiet, automatic, dry runs and disabled director clear generated worldbook content', async () => {
    for (const event of [{ type: 'quiet' }, { params: { automatic_trigger: true } }, { dryRun: true }]) {
        const f = fixture();
        await f.generate();
        assert.equal((await f.generate('normal', event)).ok, false);
        assert.equal(f.data().entries[0].content, '');
        assert.equal(f.runs(), 1);
    }
    const f = fixture();
    await f.generate();
    f.txtApi.prepareDirectorInjectionForGeneration = async () => ({ ok: false, reason: 'directorMode=off' });
    assert.equal((await f.generate()).ok, false);
    assert.equal(f.data().entries[0].content, '');
});

test('pausing clears worldbook output and does not write an in-flight result back', async () => {
    const f = fixture();
    await f.generate();
    f.ctx.setDirectorPaused(true);
    assert.equal((await f.generate()).reason, 'director-paused');
    assert.equal(f.data().entries[0].content, '');
    f.ctx.setDirectorPaused(false);
    let resolve;
    let started;
    const ready = new Promise((r) => { started = r; });
    f.txtApi.prepareDirectorInjectionForGeneration = () => { started(); return new Promise((r) => { resolve = r; }); };
    const generation = f.generate();
    await ready;
    assert.equal((await f.generate()).reason, 'inProgress-lock');
    f.ctx.setDirectorPaused(true);
    resolve({ ok: true, content: `${marker}\nlate` });
    assert.equal((await generation).ok, false);
    await f.generate();
    assert.equal(f.data().entries[0].content, '');
});

test('external pre-generation is reused once and a missing worldbook content forces refresh', async () => {
    const f = fixture({ preset: true });
    const prepared = await f.ctx.prepareDirectorPromptForInput({ userInput: 'hello' });
    assert.equal(prepared.ok, true);
    assert.equal(prepared.status.exists, true);
    assert.equal(prepared.status.activeEnabled, true);
    assert.equal((await f.generate()).reused, true);
    assert.equal(f.runs(), 1);
    f.data().entries[0].content = '';
    assert.equal((await f.generate()).ok, true);
    assert.equal(f.runs(), 2);
    assert.equal(f.presetContent(), f.data().entries[0].content);
});

test('saving independent choices keeps presets selected when enabling worldbook output', async () => {
    const f = fixture({ preset: true, worldbook: false });
    await f.generate();
    assert.equal((await f.ctx.configureDirectorOutput({ presetEnabled: true, worldbookEnabled: true, worldName: 'Book', entryUid: '0' })).ok, true);
    assert.equal(f.presetContent(), `${marker}\nround 1`);
    await f.generate();
    assert.equal(f.presetContent(), f.data().entries[0].content);
    assert.equal((await f.ctx.configureDirectorOutput({ presetEnabled: false, worldbookEnabled: true, worldName: 'Book', entryUid: '0' })).ok, true);
    assert.equal(f.presetContent(), '');
    await f.generate();
    assert.equal(f.presetContent(), '');
    assert.equal(f.data().entries[0].content, `${marker}\nround 3`);
});
