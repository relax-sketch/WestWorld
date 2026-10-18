import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import { defaultSettings } from '../txtToWorldbook/core/constants.js';
import { createInitialAppState } from '../txtToWorldbook/core/state.js';
import { createSettingsPersistenceService } from '../txtToWorldbook/services/settingsPersistenceService.js';
import { getDirectorOutputConfig } from '../txtToWorldbook/services/directorWorldInfoService.js';
import { createModalLifecycle } from '../txtToWorldbook/ui/modalLifecycle.js';
import { bindDirectorOutputSettings, hydrateDirectorOutputSettings } from '../txtToWorldbook/ui/directorOutputSettings.js';

const savedBinding = { directorPresetEnabled: false, directorWorldbookEnabled: true, directorWorldName: 'A', directorWorldEntryUid: '0' };
const flush = () => new Promise((resolve) => setImmediate(resolve));
function deferred() {
    let resolve;
    const promise = new Promise((done) => { resolve = done; });
    return { promise, resolve };
}
function mockGlobals(t, values) {
    for (const [key, value] of Object.entries(values)) {
        const descriptor = Object.getOwnPropertyDescriptor(globalThis, key);
        globalThis[key] = value;
        t.after(() => { if (descriptor) Object.defineProperty(globalThis, key, descriptor); else delete globalThis[key]; });
    }
}
class Control {
    constructor() { this.options = []; this.listeners = {}; this.checked = false; this.disabled = false; this._value = ''; }
    get value() { return this._value; }
    set value(value) { this._value = this.options.some((option) => option.value === value) ? value : ''; }
    add(option) { this.options.push(option); }
    replaceChildren(...options) { this.options = options; this._value = options[0]?.value || ''; }
    addEventListener(type, handler) { (this.listeners[type] ||= []).push(handler); }
    async fire(type) { await Promise.all((this.listeners[type] || []).map((handler) => handler({ target: this }))); }
}
function uiFixture(t, AppState = createInitialAppState({ defaultSettings })) {
    const controls = Object.fromEntries(['preset-enabled', 'worldbook-enabled', 'world-name', 'world-entry', 'worldbook-controls', 'output-status', 'world-refresh', 'output-save'].map((id) => [id, new Control()]));
    const calls = { books: 0, entries: [], saved: [] };
    const api = {
        listDirectorWorldBooks: async () => { ++calls.books; return { ok: true, books: ['A', 'B'] }; },
        listDirectorWorldEntries: async (name) => {
            calls.entries.push(name);
            return { ok: true, entries: [{ uid: name === 'A' ? '0' : '1', name: `${name} Director` }] };
        },
        configureDirectorOutput: async (config) => { calls.saved.push(config); return { ok: true }; },
    };
    mockGlobals(t, {
        document: { getElementById: (id) => controls[id.replace('ttw-director-', '')] || null },
        window: { WestWorld: api },
        Option: class { constructor(text, value) { this.text = text; this.value = value; } },
    });
    return { controls, api, calls, AppState, bind: () => bindDirectorOutputSettings({ AppState }) };
}

test('startup restores only output binding before the public getter is exposed, without opening the panel', async (t) => {
    const storage = { getItem: () => null };
    mockGlobals(t, { localStorage: storage });
    for (const storageKey of ['westworldTxtToWorldbookSettings', 'storyweaverTxtToWorldbookSettings']) {
        storage.getItem = (key) => key === storageKey ? JSON.stringify(savedBinding) : null;
        const AppState = createInitialAppState({ defaultSettings });
        AppState.settings.customApiKey = 'keep';
        const settingsPersistenceService = createSettingsPersistenceService({ AppState, defaultSettings });
        const main = await readFile(new URL('../txtToWorldbook/main.js', import.meta.url), 'utf8');
        const start = main.indexOf('settingsPersistenceService.loadDirectorOutputSettings();');
        assert.ok(start >= 0);
        const publicApi = {};
        vm.runInNewContext(main.slice(start, main.indexOf('    publicApi.setDirectorOutputSettings', start)), { AppState, settingsPersistenceService, publicApi });
        assert.deepEqual(getDirectorOutputConfig(publicApi.getDirectorOutputSettings()), { presetEnabled: false, worldbookEnabled: true, worldName: 'A', entryUid: '0' });
        assert.equal(AppState.settings.customApiKey, 'keep');
    }
});

test('first panel open restores settings before binding and loads the saved book and all its entries', async (t) => {
    const f = uiFixture(t);
    mockGlobals(t, { localStorage: { getItem: () => JSON.stringify(savedBinding) } });
    const persistence = createSettingsPersistenceService({
        AppState: f.AppState, defaultSettings,
        updateSettingsUI: () => hydrateDirectorOutputSettings(f.AppState.settings),
        updateChapterRegexUI() {}, handleProviderChange() {},
    });
    createModalLifecycle({
        addModalStyles() {}, bindModalEvents: f.bind,
        loadSavedSettings: persistence.loadSavedSettings, loadCategoryLightSettings() {},
    }).initializeModalState();
    await flush();
    assert.equal(f.calls.books, 1);
    assert.deepEqual(f.calls.entries, ['A']);
    assert.equal(f.controls['preset-enabled'].checked, false);
    assert.equal(f.controls['worldbook-enabled'].checked, true);
    assert.equal(f.controls['world-name'].value, 'A');
    assert.equal(f.controls['world-entry'].value, '0');
    assert.equal(f.controls['world-entry'].options[1].text, 'A Director');
    assert.equal(f.controls['output-save'].disabled, false);
});

test('late refresh cannot restore an old book after the user chooses and saves a new target', async (t) => {
    const f = uiFixture(t, { settings: { ...savedBinding } });
    f.bind();
    await flush();
    const response = deferred();
    f.api.listDirectorWorldBooks = () => response.promise;
    await f.controls['world-refresh'].fire('click');
    assert.equal(f.controls['output-save'].disabled, true);
    await f.controls['output-save'].fire('click');
    assert.equal(f.calls.saved.length, 0);
    f.controls['world-name'].value = 'B';
    await f.controls['world-name'].fire('change');
    await flush();
    f.controls['world-entry'].value = '1';
    response.resolve({ ok: true, books: ['A', 'B'] });
    await flush();
    assert.equal(f.controls['world-name'].value, 'B');
    assert.equal(f.controls['world-entry'].value, '1');
    await f.controls['output-save'].fire('click');
    assert.deepEqual(f.calls.saved[0], { presetEnabled: false, worldbookEnabled: true, worldName: 'B', entryUid: '1' });
});

test('changing the entry during a pending book refresh preserves the latest entry selection', async (t) => {
    const f = uiFixture(t, { settings: { ...savedBinding } });
    f.bind();
    await flush();
    f.controls['world-entry'].add(new Option('Another', '2'));
    const response = deferred();
    f.api.listDirectorWorldBooks = () => response.promise;
    await f.controls['world-refresh'].fire('click');
    f.controls['world-entry'].value = '2';
    response.resolve({ ok: true, books: ['A', 'B'] });
    await flush();
    assert.equal(f.controls['world-entry'].value, '2');
    assert.equal(f.controls['output-save'].disabled, false);
});

test('failed loading restores save availability and an unchecked worldbook ignores pending responses', async (t) => {
    const f = uiFixture(t, { settings: { ...savedBinding } });
    f.bind();
    await flush();
    f.api.listDirectorWorldBooks = async () => { throw new Error('offline'); };
    await f.controls['world-refresh'].fire('click');
    await flush();
    assert.match(f.controls['output-status'].textContent, /offline/);
    assert.equal(f.controls['output-save'].disabled, false);
    const response = deferred();
    f.api.listDirectorWorldBooks = () => response.promise;
    await f.controls['world-refresh'].fire('click');
    f.controls['worldbook-enabled'].checked = false;
    await f.controls['worldbook-enabled'].fire('change');
    assert.equal(f.controls['output-save'].disabled, false);
    response.resolve({ ok: true, books: ['B'] });
    await flush();
    assert.equal(f.controls['world-name'].value, 'A');
    assert.equal(f.controls['world-entry'].value, '0');
});
