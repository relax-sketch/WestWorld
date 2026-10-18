import { getDirectorOutputConfig } from '../services/directorWorldInfoService.js';

export function buildDirectorOutputSettingsHtml() {
    return `<div class="ttw-setting-card ttw-setting-card-blue">
        <div style="font-weight:bold;margin-bottom:10px;">导演提示词写入</div>
        <label class="ttw-checkbox-label"><input type="checkbox" id="ttw-director-preset-enabled" checked>写入预设条目</label>
        <label class="ttw-checkbox-label"><input type="checkbox" id="ttw-director-worldbook-enabled">写入世界书条目</label>
        <div id="ttw-director-worldbook-controls" hidden>
            <label for="ttw-director-world-name">已有世界书</label>
            <select id="ttw-director-world-name" class="ttw-select"></select>
            <label for="ttw-director-world-entry">已有条目</label>
            <select id="ttw-director-world-entry" class="ttw-select"></select>
            <button type="button" id="ttw-director-world-refresh" class="ttw-btn ttw-btn-small">刷新世界书列表</button>
            <div class="ttw-setting-hint">仅覆盖所选条目的正文。请在酒馆中自行启用并关联这本世界书，设置条目的触发条件、插入位置、深度和顺序。</div>
        </div>
        <button type="button" id="ttw-director-output-save" class="ttw-btn ttw-btn-small">保存写入设置</button>
        <div id="ttw-director-output-status" role="status" class="ttw-setting-hint"></div>
    </div>`;
}

function fillOptions(select, items, value, placeholder) {
    select.replaceChildren(new Option(placeholder, ''), ...items.map((item) => new Option(item.name, item.uid)));
    if (value !== '' && !items.some((item) => item.uid === value)) select.add(new Option(`不可用：${value}`, value));
    select.value = value;
}

export function hydrateDirectorOutputSettings(settings) {
    const config = getDirectorOutputConfig(settings);
    const preset = document.getElementById('ttw-director-preset-enabled');
    if (!preset) return;
    preset.checked = config.presetEnabled;
    document.getElementById('ttw-director-worldbook-enabled').checked = config.worldbookEnabled;
    document.getElementById('ttw-director-worldbook-controls').hidden = !config.worldbookEnabled;
    for (const [id, value] of [['ttw-director-world-name', config.worldName], ['ttw-director-world-entry', config.entryUid]]) {
        const select = document.getElementById(id);
        if (value && !Array.from(select.options).some((option) => option.value === value)) select.add(new Option(value, value));
        select.value = value;
    }
}

export function bindDirectorOutputSettings({ AppState, ErrorHandler }) {
    const preset = document.getElementById('ttw-director-preset-enabled');
    const worldbook = document.getElementById('ttw-director-worldbook-enabled');
    if (!preset || !worldbook) return;
    const book = document.getElementById('ttw-director-world-name');
    const entry = document.getElementById('ttw-director-world-entry');
    const status = document.getElementById('ttw-director-output-status');
    const save = document.getElementById('ttw-director-output-save');
    const refreshButton = document.getElementById('ttw-director-world-refresh');
    const api = () => window.WestWorld;
    let request = 0;
    let loading = false;
    let saving = false;
    const setLoading = (value, version) => {
        if (version !== request) return;
        loading = value;
        save.disabled = loading || saving;
    };
    const loadEntries = async (selectedUid = '', version = ++request) => {
        const worldName = book.value;
        setLoading(true, version);
        fillOptions(entry, [], '', '请选择条目');
        try {
            if (!worldName) return;
            const result = await api()?.listDirectorWorldEntries?.(worldName);
            if (version !== request || book.value !== worldName) return;
            if (!result?.ok) { status.textContent = result?.message || '无法读取世界书条目'; return; }
            fillOptions(entry, result.entries, selectedUid, '请选择条目');
            status.textContent = '';
        } catch (error) {
            if (version === request) status.textContent = `无法读取世界书条目：${error.message}`;
        } finally { setLoading(false, version); }
    };
    const refresh = async () => {
        const version = ++request;
        const worldName = book.value;
        const uid = entry.value;
        setLoading(true, version);
        try {
            const result = await api()?.listDirectorWorldBooks?.();
            if (version !== request || book.value !== worldName || entry.value !== uid) return;
            if (!result?.ok) { status.textContent = result?.message || '无法读取世界书列表'; return; }
            fillOptions(book, result.books.map((name) => ({ uid: name, name })), worldName, '请选择世界书');
            await loadEntries(uid, version);
        } catch (error) {
            if (version === request) status.textContent = `无法读取世界书列表：${error.message}`;
        } finally { setLoading(false, version); }
    };
    worldbook.addEventListener('change', () => {
        document.getElementById('ttw-director-worldbook-controls').hidden = !worldbook.checked;
        if (worldbook.checked) void refresh();
        else setLoading(false, ++request);
    });
    book.addEventListener('change', () => { void loadEntries(); });
    refreshButton.addEventListener('click', () => { void refresh(); });
    save.addEventListener('click', async () => {
        if (loading || saving) return;
        saving = true;
        save.disabled = true;
        const controls = [preset, worldbook, book, entry, refreshButton];
        controls.forEach((control) => { control.disabled = true; });
        try {
            const result = await api()?.configureDirectorOutput?.({ presetEnabled: preset.checked, worldbookEnabled: worldbook.checked, worldName: book.value, entryUid: entry.value });
            status.textContent = result?.ok ? '已保存，下次生成时写入所选位置。' : (result?.message || result?.reason || '保存失败');
            if (!result?.ok) ErrorHandler?.showUserError?.(status.textContent);
        } catch (error) {
            status.textContent = `保存失败：${error.message}`;
            ErrorHandler?.showUserError?.(status.textContent);
        } finally {
            saving = false;
            controls.forEach((control) => { control.disabled = false; });
            save.disabled = loading;
        }
    });
    hydrateDirectorOutputSettings(AppState.settings);
    if (worldbook.checked) void refresh();
}
