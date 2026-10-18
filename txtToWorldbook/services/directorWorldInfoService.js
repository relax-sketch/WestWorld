export function getDirectorOutputConfig(settings = {}) {
    return {
        presetEnabled: settings.directorPresetEnabled !== false,
        worldbookEnabled: settings.directorWorldbookEnabled === true,
        worldName: String(settings.directorWorldName || ''),
        entryUid: settings.directorWorldEntryUid == null ? '' : String(settings.directorWorldEntryUid),
    };
}

export function createDirectorWorldInfoService({ loadApi }) {
    let pending = Promise.resolve();
    let status = { ok: true, exists: false, contentLength: 0 };
    const written = new Map();

    function serialize(action) {
        const result = pending.then(action).catch((error) => {
            status = { ok: false, reason: error?.code || 'worldbook-operation-failed', message: error?.message || String(error) };
            return status;
        });
        pending = result;
        return result;
    }

    async function read(config) {
        if (!config.worldName || config.entryUid === '') throw Object.assign(new Error('请选择世界书和条目'), { code: 'worldbook-binding-missing' });
        const api = await loadApi();
        if (!api.world_names?.includes(config.worldName)) throw Object.assign(new Error('绑定的世界书不存在，请重新选择'), { code: 'worldbook-missing' });
        const data = await api.loadWorldInfo(config.worldName);
        const entry = data?.entries && Object.hasOwn(data.entries, config.entryUid) ? data.entries[config.entryUid] : null;
        if (!entry || typeof entry !== 'object' || Array.isArray(entry)) throw Object.assign(new Error('绑定的世界书条目不存在，请重新选择'), { code: 'worldbook-entry-missing' });
        return { api, data, entry };
    }

    return {
        getStatus: () => ({ ...status }),
        listBooks: () => serialize(async () => {
            const api = await loadApi();
            return { ok: true, books: [...(api.world_names || [])] };
        }),
        listEntries: (worldName) => serialize(async () => {
            const api = await loadApi();
            if (!api.world_names?.includes(worldName)) throw new Error('世界书不存在，请刷新列表');
            const data = await api.loadWorldInfo(worldName);
            if (!data?.entries) throw new Error('无法读取世界书');
            return {
                ok: true,
                entries: Object.entries(data.entries).map(([uid, entry]) => ({
                    uid,
                    name: String(entry.comment || (Array.isArray(entry.key) ? entry.key.join(', ') : '') || `UID ${uid}`),
                })),
            };
        }),
        validate: (config) => serialize(async () => {
            const { entry } = await read(config);
            status = { ok: true, exists: true, ...config, contentLength: String(entry.content || '').length };
            return { ...status };
        }),
        write: (config, content, { clear = false } = {}) => serialize(async () => {
            const { api, data, entry } = await read(config);
            const key = JSON.stringify([config.worldName, config.entryUid]);
            const current = String(entry.content || '');
            const value = String(content || '');
            // Only clear generated text; a manual replacement belongs to the user.
            const owned = current === written.get(key) || current.includes('[WestWorld Director Injection]');
            if (clear && !owned) return { ok: true, skipped: true };
            if (current !== value) {
                const updated = structuredClone(data);
                updated.entries[config.entryUid].content = value;
                await api.saveWorldInfo(config.worldName, updated, true);
            }
            written.set(key, value);
            status = { ok: true, exists: true, ...config, contentLength: value.length };
            return { ...status };
        }),
    };
}
