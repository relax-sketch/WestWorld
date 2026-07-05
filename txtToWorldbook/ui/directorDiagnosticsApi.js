export function resolveDirectorDiagnosticsApi(root = globalThis.window) {
    const sourceRoot = root && typeof root === 'object' ? root : {};
    const candidates = [
        ['WestWorld', sourceRoot.WestWorld],
        ['WestWorldTxtToWorldbook', sourceRoot.WestWorldTxtToWorldbook],
        ['StoryWeaver', sourceRoot.StoryWeaver],
    ];
    const found = candidates.find(([, api]) => api && typeof api === 'object');

    return {
        api: found?.[1] || null,
        apiSource: found?.[0] || '',
        outerApiReady: !!(sourceRoot.WestWorld && typeof sourceRoot.WestWorld === 'object'),
        txtApiReady: !!(sourceRoot.WestWorldTxtToWorldbook && typeof sourceRoot.WestWorldTxtToWorldbook === 'object'),
        storyWeaverApiReady: !!(sourceRoot.StoryWeaver && typeof sourceRoot.StoryWeaver === 'object'),
    };
}

export function missingDirectorApiResult(method = '') {
    return {
        ok: false,
        reason: 'westworld-api-missing',
        method: String(method || ''),
    };
}

export function missingDirectorApiMethodResult(method = '') {
    return {
        ok: false,
        reason: 'method-missing',
        method: String(method || ''),
    };
}

export function callDirectorApiMethod(api, method, args = []) {
    if (!api) return missingDirectorApiResult(method);
    if (typeof api[method] !== 'function') return missingDirectorApiMethodResult(method);
    return api[method](...(Array.isArray(args) ? args : []));
}
