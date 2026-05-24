import test from 'node:test';
import assert from 'node:assert/strict';

import { createCategoryPersistenceService } from '../txtToWorldbook/services/categoryPersistenceService.js';

function makeService(savedCategories) {
    const AppState = {
        persistent: { customCategories: [] },
    };
    const stored = new Map();
    globalThis.localStorage = {
        getItem: (key) => stored.get(key) || '',
        setItem: (key, value) => stored.set(key, value),
    };
    const MemoryHistoryDB = {
        getCustomCategories: async () => savedCategories,
        saveCustomCategories: async () => {},
    };
    const service = createCategoryPersistenceService({
        AppState,
        MemoryHistoryDB,
        Logger: { info() {}, error() {} },
        defaultWorldbookCategories: [{
            name: 'Role',
            enabled: true,
            isBuiltin: true,
            entryExample: 'Name',
            keywordsExample: ['Name'],
            contentGuide: 'DEFAULT BODY',
        }],
        extendedCategoryNames: [],
    });
    return { AppState, service };
}

test('loading a legacy category stores its content guide as editable prompt layers', async () => {
    const { AppState, service } = makeService([{
        name: 'Role',
        enabled: true,
        isBuiltin: true,
        entryExample: 'Name',
        keywordsExample: ['Name'],
        contentGuide: 'LEGACY BODY',
    }]);

    await service.loadCustomCategories();

    const category = AppState.persistent.customCategories[0];
    assert.deepEqual(category.promptLayers, {
        prefix: '',
        body: 'LEGACY BODY',
        suffix: '',
    });
    assert.equal(category.promptDefaultLayers.body, 'DEFAULT BODY');
});

test('dynamic template renders category prompt prefix body and suffix', () => {
    const { AppState, service } = makeService([]);
    AppState.persistent.customCategories = [{
        name: 'Role',
        enabled: true,
        entryExample: 'Name',
        keywordsExample: ['Name'],
        contentGuide: 'OLD BODY',
        promptLayers: {
            prefix: 'BEFORE',
            body: 'BODY',
            suffix: 'AFTER',
        },
    }];

    const rendered = service.generateDynamicJsonTemplate();

    assert.equal(rendered.includes('BEFORE\n\nBODY\n\nAFTER'), true);
    assert.equal(rendered.includes('OLD BODY'), false);
});
