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
    const api = () => window.WestWorld;
    let request = 0;
    const loadEntries = async (selectedUid = '') => {
        const version = ++request;
        const worldName = book.value;
        fillOptions(entry, [], '', '请选择条目');
        if (!worldName) return;
        const result = await api()?.listDirectorWorldEntries?.(worldName);
        if (version !== request || book.value !== worldName) return;
        if (!result?.ok) { status.textContent = result?.message || '无法读取世界书条目'; return; }
        fillOptions(entry, result.entries, selectedUid, '请选择条目');
    };
    const refresh = async () => {
        const worldName = book.value;
        const uid = entry.value;
        const result = await api()?.listDirectorWorldBooks?.();
        if (!result?.ok) { status.textContent = result?.message || '无法读取世界书列表'; return; }
        fillOptions(book, result.books.map((name) => ({ uid: name, name })), worldName, '请选择世界书');
        await loadEntries(uid);
    };
    worldbook.addEventListener('change', () => {
        document.getElementById('ttw-director-worldbook-controls').hidden = !worldbook.checked;
        if (worldbook.checked) void refresh();
    });
    book.addEventListener('change', () => { void loadEntries(); });
    document.getElementById('ttw-director-world-refresh').addEventListener('click', () => { void refresh(); });
    document.getElementById('ttw-director-output-save').addEventListener('click', async (event) => {
        event.target.disabled = true;
        try {
            const result = await api()?.configureDirectorOutput?.({ presetEnabled: preset.checked, worldbookEnabled: worldbook.checked, worldName: book.value, entryUid: entry.value });
            status.textContent = result?.ok ? '已保存，下次生成时写入所选位置。' : (result?.message || result?.reason || '保存失败');
            if (!result?.ok) ErrorHandler?.showUserError?.(status.textContent);
        } catch (error) {
            status.textContent = `保存失败：${error.message}`;
            ErrorHandler?.showUserError?.(status.textContent);
        } finally { event.target.disabled = false; }
    });
    hydrateDirectorOutputSettings(AppState.settings);
    if (worldbook.checked) void refresh();
}
