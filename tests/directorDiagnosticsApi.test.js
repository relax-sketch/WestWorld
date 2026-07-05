import test from 'node:test';
import assert from 'node:assert/strict';

import {
    callDirectorApiMethod,
    resolveDirectorDiagnosticsApi,
} from '../txtToWorldbook/ui/directorDiagnosticsApi.js';

test('director diagnostics prefers outer WestWorld API over TXT fallback', () => {
    const root = {
        WestWorld: { name: 'outer' },
        WestWorldTxtToWorldbook: { name: 'txt' },
        StoryWeaver: { name: 'legacy' },
    };

    const result = resolveDirectorDiagnosticsApi(root);

    assert.equal(result.api, root.WestWorld);
    assert.equal(result.apiSource, 'WestWorld');
    assert.equal(result.outerApiReady, true);
    assert.equal(result.txtApiReady, true);
    assert.equal(result.storyWeaverApiReady, true);
});

test('director diagnostics falls back to TXT API when outer API is absent', () => {
    const root = {
        WestWorldTxtToWorldbook: { name: 'txt' },
        StoryWeaver: { name: 'legacy' },
    };

    const result = resolveDirectorDiagnosticsApi(root);

    assert.equal(result.api, root.WestWorldTxtToWorldbook);
    assert.equal(result.apiSource, 'WestWorldTxtToWorldbook');
    assert.equal(result.outerApiReady, false);
    assert.equal(result.txtApiReady, true);
});

test('director diagnostics reports method-missing separately from API-missing', () => {
    assert.deepEqual(callDirectorApiMethod(null, 'repairDirectorPromptManagerEntry'), {
        ok: false,
        reason: 'westworld-api-missing',
        method: 'repairDirectorPromptManagerEntry',
    });

    assert.deepEqual(callDirectorApiMethod({}, 'repairDirectorPromptManagerEntry'), {
        ok: false,
        reason: 'method-missing',
        method: 'repairDirectorPromptManagerEntry',
    });
});

test('director diagnostics invokes available API methods', () => {
    const api = {
        repairDirectorPromptManagerEntry(value) {
            return { ok: true, value };
        },
    };

    assert.deepEqual(callDirectorApiMethod(api, 'repairDirectorPromptManagerEntry', ['x']), {
        ok: true,
        value: 'x',
    });
});
