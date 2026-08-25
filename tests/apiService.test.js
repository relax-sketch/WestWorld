import test from 'node:test';
import assert from 'node:assert/strict';

import { createApiService } from '../txtToWorldbook/services/apiService.js';
import { APICaller } from '../txtToWorldbook/infra/apiCaller.js';

test('structured chapter asset prompts reach the custom API without global-chain wrapping', async () => {
    let requestBody = null;
    const AppState = {
        settings: {
            apiTimeout: 1000,
            useTavernApi: false,
            promptGlobal: { prefix: 'GLOBAL PREFIX', suffix: 'GLOBAL SUFFIX' },
            directorApi: {
                provider: 'openai-compatible',
                endpoint: 'http://example.test/v1',
                model: 'director-test',
                maxTokens: 128,
            },
        },
    };
    const service = createApiService({
        AppState,
        Logger: { info() {}, warn() {}, error() {} },
        updateStreamContent() {},
        debugLog() {},
        messagesToString: (messages) => messages.map((message) => message.content).join('\n'),
        convertToGeminiContents: () => ({ contents: [] }),
        applyMessageChain: () => [{ role: 'user', content: 'SHOULD NOT BE USED' }],
        APICaller: {
            async withRetry(callback) {
                return callback(0);
            },
            async requestStream(_url, options) {
                requestBody = JSON.parse(options.body);
                return '{}';
            },
            isRateLimitError: () => false,
            handleError: (error) => error,
        },
    });

    const messages = [
        { role: 'user', content: 'FIRST' },
        { role: 'assistant', content: 'ACK' },
        { role: 'user', content: 'FINAL' },
    ];
    await service.callDirectorAPI(messages, 1);

    assert.deepEqual(requestBody.messages, messages);
    await assert.rejects(
        () => service.callDirectorAPI([{ role: 'developer', content: 'UNSUPPORTED' }], 1),
        /role 不受支持/,
    );
});

test('chapter API calls forward an optional abort signal through the custom transport', async () => {
    let retryConfig = null;
    let requestSignal = null;
    const AppState = {
        settings: {
            apiTimeout: 1000,
            useTavernApi: false,
            promptGlobal: { prefix: '', suffix: '' },
            directorApi: {
                provider: 'openai-compatible',
                endpoint: 'http://example.test/v1',
                model: 'director-test',
                maxTokens: 128,
            },
        },
    };
    const service = createApiService({
        AppState,
        Logger: { info() {}, warn() {}, error() {} },
        updateStreamContent() {},
        debugLog() {},
        messagesToString: (messages) => messages.map((message) => message.content).join('\n'),
        convertToGeminiContents: () => ({ contents: [] }),
        applyMessageChain: () => [],
        APICaller: {
            async withRetry(callback, config) {
                retryConfig = config;
                return callback(0);
            },
            async requestStream(_url, options) {
                requestSignal = options.signal;
                return '{}';
            },
            isRateLimitError: () => false,
            handleError: (error) => error,
        },
    });
    const controller = new AbortController();

    await service.callDirectorAPI([{ role: 'user', content: 'chapter' }], 1, { signal: controller.signal });

    assert.equal(retryConfig.signal, controller.signal);
    assert.equal(requestSignal, controller.signal);
});

test('APICaller abort signal exits an in-flight fetch without waiting for timeout', async () => {
    const previousFetch = globalThis.fetch;
    let fetchCalls = 0;
    globalThis.fetch = (_url, options = {}) => {
        fetchCalls += 1;
        return new Promise((_, reject) => {
            const abort = () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' }));
            if (options.signal?.aborted) abort();
            else options.signal?.addEventListener('abort', abort, { once: true });
        });
    };
    const controller = new AbortController();

    try {
        const pending = APICaller.requestJSON('http://example.test', {
            timeout: 5000,
            signal: controller.signal,
        });
        setTimeout(() => controller.abort(), 5);
        await assert.rejects(pending, /ABORTED/);
        assert.equal(fetchCalls, 1);
    } finally {
        if (previousFetch === undefined) delete globalThis.fetch;
        else globalThis.fetch = previousFetch;
    }
});

test('APICaller requestStream forwards cancellation to fetch and the reader', async () => {
    const previousFetch = globalThis.fetch;
    const controller = new AbortController();
    let fetchSignal = null;
    let readerCancelled = false;
    let rejectRead = null;
    globalThis.fetch = async (_url, options = {}) => {
        fetchSignal = options.signal;
        options.signal?.addEventListener('abort', () => {
            readerCancelled = true;
            rejectRead?.(Object.assign(new Error('aborted'), { name: 'AbortError' }));
        }, { once: true });
        return {
            ok: true,
            body: {
                getReader() {
                    return {
                        read() {
                            if (options.signal?.aborted) {
                                return Promise.reject(Object.assign(new Error('aborted'), { name: 'AbortError' }));
                            }
                            return new Promise((_, reject) => { rejectRead = reject; });
                        },
                        cancel() {
                            readerCancelled = true;
                            return Promise.resolve();
                        },
                    };
                },
            },
        };
    };

    try {
        const pending = APICaller.requestStream('http://example.test', {
            timeout: 5000,
            signal: controller.signal,
        });
        setTimeout(() => controller.abort(), 5);
        await assert.rejects(pending, /ABORTED/);
        assert.equal(fetchSignal.aborted, true);
        assert.equal(readerCancelled, true);
    } finally {
        if (previousFetch === undefined) delete globalThis.fetch;
        else globalThis.fetch = previousFetch;
    }
});

test('structured Tavern requests fail clearly instead of flattening when raw arrays are unsupported', async () => {
    let calls = 0;
    const AppState = {
        settings: {
            apiTimeout: 1000,
            useTavernApi: true,
            promptGlobal: { prefix: '', suffix: '' },
        },
    };
    const service = createApiService({
        AppState,
        Logger: { info() {}, warn() {}, error() {} },
        updateStreamContent() {},
        debugLog() {},
        messagesToString: (messages) => messages.map((message) => message.content).join('\n'),
        convertToGeminiContents: () => ({ contents: [] }),
        applyMessageChain: () => [{ role: 'user', content: 'SHOULD NOT BE USED' }],
        APICaller: {},
    });
    const messages = [
        { role: 'user', content: 'FIRST' },
        { role: 'assistant', content: 'ACK' },
        { role: 'user', content: 'FINAL' },
    ];
    const previousTavern = globalThis.SillyTavern;
    globalThis.SillyTavern = {
        getContext: () => ({
            async generateRaw(options) {
                calls += 1;
                assert.deepEqual(options.prompt, messages);
                throw new Error('消息数组格式不支持');
            },
        }),
    };

    try {
        await assert.rejects(
            () => service.callAPI(messages),
            /无法保持结构化消息角色/,
        );
        assert.equal(calls, 1);
    } finally {
        if (previousTavern === undefined) delete globalThis.SillyTavern;
        else globalThis.SillyTavern = previousTavern;
    }
});

test('structured Tavern requests pass the OpenAI message array unchanged when supported', async () => {
    let received = null;
    const AppState = {
        settings: {
            apiTimeout: 1000,
            useTavernApi: true,
            promptGlobal: { prefix: '', suffix: '' },
        },
    };
    const service = createApiService({
        AppState,
        Logger: { info() {}, warn() {}, error() {} },
        updateStreamContent() {},
        debugLog() {},
        messagesToString: (messages) => messages.map((message) => message.content).join('\n'),
        convertToGeminiContents: () => ({ contents: [] }),
        applyMessageChain: () => [{ role: 'user', content: 'SHOULD NOT BE USED' }],
        APICaller: {},
    });
    const messages = [
        { role: 'user', content: 'FIRST' },
        { role: 'assistant', content: 'ACK' },
        { role: 'user', content: 'FINAL' },
    ];
    const previousTavern = globalThis.SillyTavern;
    globalThis.SillyTavern = {
        getContext: () => ({
            async generateRaw(options) {
                received = options.prompt;
                return '{}';
            },
        }),
    };

    try {
        await service.callAPI(messages);
        assert.deepEqual(received, messages);
    } finally {
        if (previousTavern === undefined) delete globalThis.SillyTavern;
        else globalThis.SillyTavern = previousTavern;
    }
});
