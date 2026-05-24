import test from 'node:test';
import assert from 'node:assert/strict';

import {
    getDirectorDecisionMode,
    resolveDirectorDecisionFlow,
    shouldUseLocalDirectorOnly,
    shouldFallbackAfterDirectorFailure,
} from '../txtToWorldbook/services/directorService.js';

test('getDirectorDecisionMode migrates old boolean fallback setting', () => {
    assert.equal(getDirectorDecisionMode({ directorDecisionMode: 'local-only' }), 'local-only');
    assert.equal(getDirectorDecisionMode({ directorDecisionMode: 'api-only' }), 'api-only');
    assert.equal(getDirectorDecisionMode({ directorAutoFallbackToMain: false }), 'api-only');
    assert.equal(getDirectorDecisionMode({ directorAutoFallbackToMain: true }), 'api-auto-fallback');
    assert.equal(getDirectorDecisionMode({}), 'api-auto-fallback');
});

test('local-only mode skips director API and auto-fallback mode handles failures', () => {
    assert.equal(shouldUseLocalDirectorOnly({ directorDecisionMode: 'local-only' }), true);
    assert.equal(shouldUseLocalDirectorOnly({ directorDecisionMode: 'api-only' }), false);
    assert.equal(shouldFallbackAfterDirectorFailure({ directorDecisionMode: 'api-auto-fallback' }), true);
    assert.equal(shouldFallbackAfterDirectorFailure({ directorDecisionMode: 'api-only' }), false);
    assert.equal(shouldFallbackAfterDirectorFailure({ directorDecisionMode: 'local-only' }), true);
});

test('resolveDirectorDecisionFlow skips API in local-only mode', async () => {
    let apiCalls = 0;
    const result = await resolveDirectorDecisionFlow({
        settings: { directorDecisionMode: 'local-only' },
        requestDecision: async () => {
            apiCalls++;
            return '{"stage_idx":0}';
        },
        makeFallbackDecision: (reason) => ({ stage_idx: 0, reason }),
    });

    assert.equal(apiCalls, 0);
    assert.equal(result.decisionSource, 'fallback-manual');
    assert.equal(result.decision.reason, 'manual-local-fallback');
});

test('resolveDirectorDecisionFlow falls back after API failure in auto-fallback mode', async () => {
    const result = await resolveDirectorDecisionFlow({
        settings: { directorDecisionMode: 'api-auto-fallback' },
        requestDecision: async () => {
            throw new Error('boom');
        },
        makeFallbackDecision: (reason) => ({ stage_idx: 1, reason }),
    });

    assert.equal(result.decisionSource, 'fallback-error');
    assert.equal(result.decision.reason, 'error-fallback');
});

test('resolveDirectorDecisionFlow throws in api-only mode when response is invalid', async () => {
    await assert.rejects(
        resolveDirectorDecisionFlow({
            settings: { directorDecisionMode: 'api-only' },
            requestDecision: async () => 'not-json',
            parseDecision: () => null,
            makeFallbackDecision: (reason) => ({ stage_idx: 2, reason }),
        }),
        /导演API返回内容不是有效JSON/
    );
});
