import test from 'node:test';
import assert from 'node:assert/strict';

import { createTaskStateService } from '../txtToWorldbook/services/taskStateService.js';
import { createPackagePolicyService } from '../txtToWorldbook/services/packagePolicyService.js';

function createState() {
    return {
        settings: {
            minChunkSize: 1500,
            promptGlobal: { prefix: 'LOCAL PROMPT', suffix: '' },
            promptOverrides: {},
            mainApi: { apiKey: 'LOCAL KEY' },
        },
        config: {
            parallel: {},
            categoryLight: {},
            chapterRegex: {},
            categoryDefault: {},
            entryPosition: {},
        },
        persistent: {
            customCategories: [{
                name: 'role',
                enabled: true,
                contentGuide: 'LOCAL GUIDE',
                promptLayers: { prefix: '', body: 'LOCAL BODY', suffix: '' },
            }],
            defaultEntries: [],
        },
        memory: { queue: [{ title: 'local', content: 'content', processed: true }], startIndex: 0, userSelectedIndex: null },
        worldbook: { generated: { role: {} }, volumes: [], currentVolumeIndex: 0 },
        file: { hash: 'local-hash', novelName: 'local novel', current: null },
        experience: {},
        processing: { incrementalMode: true, volumeMode: false },
    };
}

function installDomForImport(serialized) {
    const originalDocument = globalThis.document;
    let pending = Promise.resolve();
    globalThis.document = {
        createElement(tag) {
            if (tag === 'input') {
                return {
                    type: '',
                    accept: '',
                    onchange: null,
                    click() {
                        pending = this.onchange({ target: { files: [{ text: async () => serialized }] } });
                    },
                };
            }
            return { click() {} };
        },
        getElementById() {
            return { style: {}, textContent: '', value: '', disabled: false };
        },
    };
    return {
        awaitChange: async () => pending,
        restore: () => { globalThis.document = originalDocument; },
    };
}

function createService(AppState, MemoryHistoryDB = { saveState: async () => {} }) {
    return createTaskStateService({
        AppState,
        MemoryHistoryDB,
        packagePolicyService: createPackagePolicyService(),
        Logger: { error: () => {}, info: () => {} },
        ErrorHandler: { showUserSuccess: () => {}, showUserError: (message) => { throw new Error(message); } },
        confirmAction: async () => true,
        getExportBaseName: () => 'task',
        rebuildWorldbookFromMemories: () => {},
        showQueueSection: () => {},
        updateMemoryQueueUI: () => {},
        updateVolumeIndicator: () => {},
        updateStartButtonState: () => {},
        updateSettingsUI: () => {},
        renderCategoriesList: () => {},
        renderDefaultWorldbookEntriesUI: () => {},
        updateChapterRegexUI: () => {},
        showResultSection: () => {},
        updateWorldbookPreview: () => {},
    });
}

test('saving an engineering package serializes resources without local API or prompt content', async () => {
    const AppState = createState();
    AppState.experience.directorLastInjectionPrompt = 'CACHED DIRECTOR PROMPT';
    const originalDocument = globalThis.document;
    const originalCreateObjectURL = globalThis.URL.createObjectURL;
    const originalRevokeObjectURL = globalThis.URL.revokeObjectURL;
    let exportedBlob = null;
    globalThis.document = {
        createElement: () => ({ href: '', download: '', click() {} }),
    };
    globalThis.URL.createObjectURL = (blob) => {
        exportedBlob = blob;
        return 'blob:test';
    };
    globalThis.URL.revokeObjectURL = () => {};
    try {
        const service = createService(AppState);
        await service.saveTaskState();
    } finally {
        globalThis.document = originalDocument;
        globalThis.URL.createObjectURL = originalCreateObjectURL;
        globalThis.URL.revokeObjectURL = originalRevokeObjectURL;
    }

    const exported = JSON.parse(await exportedBlob.text());
    const serialized = JSON.stringify(exported);
    assert.equal(exported.version, '3.6.0');
    assert.deepEqual(exported.generatedWorldbook, { role: {} });
    assert.equal(serialized.includes('LOCAL KEY'), false);
    assert.equal(serialized.includes('LOCAL PROMPT'), false);
    assert.equal(serialized.includes('LOCAL GUIDE'), false);
    assert.equal(serialized.includes('CACHED DIRECTOR PROMPT'), false);
});

test('loading a legacy engineering package cannot restore API or editable prompt settings', async () => {
    const AppState = createState();
    const payload = JSON.stringify({
        type: 'StoryWeaver.taskState',
        memoryQueue: [{ title: 'imported', content: 'body', processed: false }],
        generatedWorldbook: { imported: true },
        settings: {
            minChunkSize: 2100,
            mainApi: { apiKey: 'IMPORTED KEY' },
            promptGlobal: { prefix: 'IMPORTED PROMPT' },
        },
        customWorldbookCategories: [{
            name: 'role',
            enabled: false,
            contentGuide: 'IMPORTED GUIDE',
            promptLayers: { body: 'IMPORTED BODY' },
        }],
    });
    const dom = installDomForImport(payload);
    try {
        const service = createService(AppState);
        await service.loadTaskState();
        await dom.awaitChange();
    } finally {
        dom.restore();
    }

    assert.equal(AppState.settings.minChunkSize, 2100);
    assert.equal(AppState.settings.mainApi.apiKey, 'LOCAL KEY');
    assert.equal(AppState.settings.promptGlobal.prefix, 'LOCAL PROMPT');
    assert.equal(AppState.persistent.customCategories[0].contentGuide, 'LOCAL GUIDE');
    assert.equal(AppState.persistent.customCategories[0].enabled, false);
    assert.deepEqual(AppState.worldbook.generated, { imported: true });
});

test('history snapshot recovery ignores settings embedded by an older snapshot', async () => {
    const AppState = createState();
    const MemoryHistoryDB = {
        loadState: async () => ({
            memoryQueue: [{ title: 'snapshot', content: 'body', processed: true }],
            generatedWorldbook: { recovered: true },
            settings: {
                minChunkSize: 2400,
                mainApi: { apiKey: 'OLD KEY' },
                promptGlobal: { prefix: 'OLD PROMPT' },
            },
        }),
    };
    const originalDocument = globalThis.document;
    globalThis.document = {
        getElementById: () => ({ style: {}, textContent: '', value: '', disabled: false }),
    };
    try {
        const service = createService(AppState, MemoryHistoryDB);
        const restored = await service.checkAndRestoreState({ autoRestore: true });
        assert.equal(restored, true);
    } finally {
        globalThis.document = originalDocument;
    }

    assert.equal(AppState.settings.minChunkSize, 2400);
    assert.equal(AppState.settings.mainApi.apiKey, 'LOCAL KEY');
    assert.equal(AppState.settings.promptGlobal.prefix, 'LOCAL PROMPT');
    assert.deepEqual(AppState.worldbook.generated, { recovered: true });
});
