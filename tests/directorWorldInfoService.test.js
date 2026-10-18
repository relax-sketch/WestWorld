import test from 'node:test';
import assert from 'node:assert/strict';
import { createDirectorWorldInfoService, getDirectorOutputConfig } from '../txtToWorldbook/services/directorWorldInfoService.js';

function fixture() {
    let data = {
        entries: {
            0: { uid: 0, comment: '导演', content: '手动正文', disable: false, constant: true, position: 4, depth: 7, order: 230, key: ['关键词'], probability: 80 },
            1: { uid: 1, content: '其他条目', disable: true },
        },
        custom: { keep: true },
    };
    const saves = [];
    let editorData = structuredClone(data);
    const reloads = [];
    const api = {
        world_names: ['测试书'],
        loadWorldInfo: async () => structuredClone(data),
        saveWorldInfo: async (name, updated, immediate) => { saves.push({ name, updated, immediate }); data = updated; },
        reloadEditor: (name) => { reloads.push(name); editorData = structuredClone(data); },
    };
    return {
        service: createDirectorWorldInfoService({ loadApi: async () => api }),
        api, saves, reloads, editorData: () => editorData,
        config: getDirectorOutputConfig({ directorWorldbookEnabled: true, directorWorldName: '测试书', directorWorldEntryUid: 0 }),
        data: () => data,
    };
}

test('output defaults preserve presets and support two independent selections including UID zero', () => {
    assert.deepEqual(getDirectorOutputConfig(), { presetEnabled: true, worldbookEnabled: false, worldName: '', entryUid: '' });
    assert.equal(getDirectorOutputConfig({ directorPresetEnabled: false }).presetEnabled, false);
    assert.equal(fixture().config.entryUid, '0');
    assert.equal(fixture().config.presetEnabled, true);
    assert.equal(fixture().config.worldbookEnabled, true);
});

test('native world info writes change only content and request immediate save', async () => {
    const f = fixture();
    const original = structuredClone(f.data());
    const result = await f.service.write(f.config, '生成正文');
    original.entries[0].content = '生成正文';
    assert.equal(result.ok, true);
    assert.deepEqual(f.data(), original);
    assert.equal(f.saves[0].name, '测试书');
    assert.equal(f.saves[0].immediate, true);
    await f.service.write(f.config, '生成正文');
    assert.equal(f.saves.length, 1);
    const entries = await f.service.listEntries('测试书');
    assert.deepEqual(entries.entries[0], { uid: '0', name: '导演' });
});

test('missing bindings, books and entries cannot create or overwrite a book', async () => {
    const f = fixture();
    for (const config of [
        { ...f.config, worldName: '' },
        { ...f.config, worldName: '不存在' },
        { ...f.config, entryUid: '99' },
        { ...f.config, entryUid: '__proto__' },
    ]) {
        assert.equal((await f.service.write(config, 'bad')).ok, false);
    }
    assert.equal(f.saves.length, 0);
    assert.equal(f.data().entries[0].content, '手动正文');
    assert.equal((await f.service.write(f.config, '恢复正常')).ok, true);
});

test('clearing removes owned generated text while preserving manual replacements and configuration', async () => {
    const f = fixture();
    await f.service.write(f.config, '', { clear: true });
    assert.equal(f.data().entries[0].content, '手动正文');
    await f.service.write(f.config, '[WestWorld Director Injection]\n新正文');
    await f.service.write(f.config, '', { clear: true });
    assert.equal(f.data().entries[0].content, '');
    assert.equal(f.data().entries[0].depth, 7);
    f.data().entries[0].content = '手动替换';
    await f.service.write(f.config, '', { clear: true });
    assert.equal(f.data().entries[0].content, '手动替换');
});

test('failed saves do not mutate the loaded object and writes recover after rejection', async () => {
    const f = fixture();
    const original = f.data();
    const load = f.api.loadWorldInfo;
    f.api.loadWorldInfo = async () => original;
    const save = f.api.saveWorldInfo;
    f.api.saveWorldInfo = async () => { throw new Error('断网'); };
    assert.equal((await f.service.write(f.config, '失败正文')).ok, false);
    assert.equal(original.entries[0].content, '手动正文');
    f.api.saveWorldInfo = save;
    f.api.loadWorldInfo = load;
    assert.equal((await f.service.write(f.config, '成功正文')).ok, true);
    assert.equal(f.data().entries[0].content, '成功正文');
});

test('concurrent content writes and clears are saved in request order', async () => {
    const f = fixture();
    await Promise.all([
        f.service.write(f.config, 'first'),
        f.service.write(f.config, 'second'),
        f.service.write(f.config, '', { clear: true }),
    ]);
    assert.deepEqual(f.saves.map((save) => save.updated.entries[0].content), ['first', 'second', '']);
});

test('HTTP failures and network failures invalidate optimistic native cache and allow a real retry', async () => {
    for (const mode of ['http500', 'network', 'lost-ack']) {
        let disk = { entries: { 0: { uid: 0, content: 'old', depth: 7 } } };
        const cache = new Map();
        let fail = true;
        let saves = 0;
        let reloads = 0;
        const api = {
            world_names: ['Book'], worldInfoCache: cache,
            loadWorldInfo: async (name) => {
                if (!cache.has(name)) cache.set(name, structuredClone(disk));
                return structuredClone(cache.get(name));
            },
            saveWorldInfo: async (name, data, immediate) => {
                assert.equal(immediate, true);
                ++saves;
                cache.set(name, data);
                if (fail && mode === 'http500') return;
                if (fail && mode === 'network') throw new Error('offline');
                disk = structuredClone(data);
                if (fail && mode === 'lost-ack') throw new Error('connection closed after save');
            },
            reloadEditor: () => { ++reloads; },
        };
        const service = createDirectorWorldInfoService({ loadApi: async () => api });
        const config = { worldName: 'Book', entryUid: '0' };
        assert.equal((await service.write(config, 'new')).ok, false, mode);
        assert.equal(cache.has('Book'), false, mode);
        assert.equal(reloads, 0);
        fail = false;
        assert.equal((await service.write(config, 'new')).ok, true, mode);
        assert.equal(disk.entries[0].content, 'new');
        assert.equal(disk.entries[0].depth, 7);
        assert.equal(saves, mode === 'lost-ack' ? 1 : 2);
        assert.equal(reloads, 1);
    }
});

test('saving refreshes the native editor copy so another field edit cannot restore old director content', async () => {
    const f = fixture();
    await f.service.write(f.config, '[WestWorld Director Injection]\nnew');
    assert.equal(f.reloads.length, 1);
    const editor = f.editorData();
    editor.entries[1].comment = 'edited separately';
    await f.api.saveWorldInfo(f.config.worldName, editor, true);
    assert.equal(f.data().entries[0].content, '[WestWorld Director Injection]\nnew');
    assert.equal(f.data().entries[1].comment, 'edited separately');
    await f.service.write(f.config, '[WestWorld Director Injection]\nnew');
    assert.equal(f.reloads.length, 1);
});
