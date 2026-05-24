function escapeHtml(value) {
    return String(value ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

function renderWarnings(warnings = []) {
    if (warnings.length === 0) return '';
    const messages = warnings.map((warning) => (
        warning.type === 'empty-body'
            ? '正文为空，保存后该模块将不输出正文。'
            : `缺少占位符 ${escapeHtml(warning.placeholder)}，仍可保存但运行时内容可能不完整。`
    ));
    return `<div class="ttw-setting-hint" style="color:#f39c12;margin:6px 0;">${messages.join('<br>')}</div>`;
}

function renderLayerTextarea(scopeAttributes, layer, value, rows) {
    const label = layer === 'prefix' ? '模块前缀' : layer === 'body' ? '正文' : '模块后缀';
    return `
        <label style="display:block;margin-top:7px;font-size:12px;color:var(--ttw-text-secondary);">${label}</label>
        <textarea class="ttw-textarea-small ${scopeAttributes.className}" ${scopeAttributes.attributes} data-layer="${layer}" rows="${rows}">${escapeHtml(value)}</textarea>`;
}

export function buildPromptEditorHtml({ globalLayers = {}, modules = [], categories = [] } = {}) {
    const moduleHtml = modules.map((module) => `
        <details class="ttw-prompt-section" style="margin-bottom:10px;" ${module.id === 'worldbook.system' ? 'open' : ''}>
            <summary style="cursor:pointer;padding:8px 0;font-weight:500;">${escapeHtml(module.title || module.id)} <code>${escapeHtml(module.id)}</code></summary>
            ${renderWarnings(module.warnings)}
            ${renderLayerTextarea({ className: 'ttw-registry-layer-input', attributes: `data-module-id="${escapeHtml(module.id)}"` }, 'prefix', module.prefix, 2)}
            ${renderLayerTextarea({ className: 'ttw-registry-layer-input', attributes: `data-module-id="${escapeHtml(module.id)}"` }, 'body', module.body, 6)}
            ${renderLayerTextarea({ className: 'ttw-registry-layer-input', attributes: `data-module-id="${escapeHtml(module.id)}"` }, 'suffix', module.suffix, 2)}
            <div style="display:flex;gap:8px;margin-top:8px;">
                <button class="ttw-btn ttw-btn-small ttw-save-registry-module" data-module-id="${escapeHtml(module.id)}">保存</button>
                <button class="ttw-btn ttw-btn-small ttw-reset-registry-module" data-module-id="${escapeHtml(module.id)}">恢复默认</button>
            </div>
        </details>`).join('');

    const categoryHtml = categories.map((category, index) => {
        const layers = category.promptLayers || { prefix: '', body: category.contentGuide || '', suffix: '' };
        return `
        <details class="ttw-prompt-section" style="margin-bottom:10px;">
            <summary style="cursor:pointer;padding:8px 0;font-weight:500;">分类提示词: ${escapeHtml(category.name)}</summary>
            ${renderLayerTextarea({ className: 'ttw-category-layer-input', attributes: `data-category-index="${index}"` }, 'prefix', layers.prefix, 2)}
            ${renderLayerTextarea({ className: 'ttw-category-layer-input', attributes: `data-category-index="${index}"` }, 'body', layers.body, 5)}
            ${renderLayerTextarea({ className: 'ttw-category-layer-input', attributes: `data-category-index="${index}"` }, 'suffix', layers.suffix, 2)}
            <div style="display:flex;gap:8px;margin-top:8px;">
                <button class="ttw-btn ttw-btn-small ttw-save-category-layers" data-category-index="${index}">保存</button>
                <button class="ttw-btn ttw-btn-small ttw-reset-category-layers" data-category-index="${index}">恢复默认</button>
            </div>
        </details>`;
    }).join('');

    return `
        <div class="ttw-prompt-section" style="margin-bottom:14px;">
            <div style="font-weight:500;margin-bottom:6px;">全局后缀</div>
            <div class="ttw-setting-hint">完整模型请求仅追加一次；导演注入演员模块不使用全局层。</div>
            <textarea id="ttw-global-suffix-prompt" class="ttw-textarea-small" rows="3">${escapeHtml(globalLayers.suffix || '')}</textarea>
            <button class="ttw-btn ttw-btn-small" id="ttw-save-global-suffix" style="margin-top:8px;">保存全局后缀</button>
        </div>
        <div class="ttw-setting-hint" style="margin-bottom:8px;">所有提示词模块均可编辑前缀、正文与后缀；缺少占位符只提示警告，不阻止保存。</div>
        <div id="ttw-registry-module-list">${moduleHtml}</div>
        <div style="font-weight:500;margin:16px 0 8px;">分类提取提示词</div>
        <div id="ttw-registry-category-list">${categoryHtml || '<div class="ttw-setting-hint">暂无分类配置</div>'}</div>`;
}

const LEGACY_BODY_KEYS = Object.freeze({
    'worldbook.system': 'customWorldbookPrompt',
    'worldbook.plot': 'customPlotPrompt',
    'worldbook.style': 'customStylePrompt',
    'merge.imported-entry': 'customMergePrompt',
    'merge.consolidate': 'customConsolidatePrompt',
    'merge.alias': 'customAliasMergePrompt',
    'director.chapter-assets': 'customChapterAssetsPrompt',
    'director.framework': 'customDirectorFrameworkPrompt',
    'director.injection': 'customDirectorInjectionPrompt',
    'worldbook.reroll.single-entry': 'customRerollPrompt',
});

const LEGACY_SUFFIX_KEYS = Object.freeze({
    'director.framework': 'customDirectorFrameworkSuffix',
    'director.injection': 'customDirectorInjectionSuffix',
});

export function createPromptEditorView(deps = {}) {
    const {
        AppState,
        promptRegistryService,
        saveCurrentSettings,
        saveCustomCategories,
        ErrorHandler,
    } = deps;

    function renderPromptEditor() {
        const host = document.getElementById('ttw-prompt-registry-host');
        if (!host || !promptRegistryService) return;
        const modules = promptRegistryService.listModules().map((module) => ({
            ...module,
            warnings: promptRegistryService.getWarnings(module.id, module),
        }));
        host.innerHTML = buildPromptEditorHtml({
            globalLayers: AppState.settings.promptGlobal || {},
            modules,
            categories: AppState.persistent.customCategories || [],
        });
        const prefix = document.getElementById('ttw-prefix-prompt');
        if (prefix) prefix.value = AppState.settings.promptGlobal?.prefix || '';
    }

    function readModuleLayers(container, moduleId) {
        const layers = {};
        for (const layer of ['prefix', 'body', 'suffix']) {
            const input = container.querySelector(`.ttw-registry-layer-input[data-module-id="${moduleId}"][data-layer="${layer}"]`);
            layers[layer] = input?.value || '';
        }
        return layers;
    }

    function mirrorLegacyModule(moduleId, layers) {
        const bodyKey = LEGACY_BODY_KEYS[moduleId];
        if (bodyKey) AppState.settings[bodyKey] = layers.body;
        const suffixKey = LEGACY_SUFFIX_KEYS[moduleId];
        if (suffixKey) AppState.settings[suffixKey] = layers.suffix;
    }

    function bindPromptEditorEvents({ modalContainer, EventDelegate }) {
        EventDelegate.on(modalContainer, '#ttw-save-global-suffix', 'click', () => {
            const suffix = modalContainer.querySelector('#ttw-global-suffix-prompt')?.value || '';
            AppState.settings.promptGlobal = { ...(AppState.settings.promptGlobal || {}), suffix };
            AppState.settings.customSuffixPrompt = suffix;
            saveCurrentSettings({ syncPromptFieldsFromDom: false });
            ErrorHandler?.showUserSuccess?.('全局后缀已保存');
        });

        EventDelegate.on(modalContainer, '.ttw-save-registry-module', 'click', (event, button) => {
            const moduleId = button.getAttribute('data-module-id');
            const layers = readModuleLayers(modalContainer, moduleId);
            promptRegistryService.setOverride(moduleId, layers);
            mirrorLegacyModule(moduleId, layers);
            saveCurrentSettings({ syncPromptFieldsFromDom: false });
            renderPromptEditor();
            ErrorHandler?.showUserSuccess?.('提示词模块已保存');
        });

        EventDelegate.on(modalContainer, '.ttw-reset-registry-module', 'click', (event, button) => {
            const moduleId = button.getAttribute('data-module-id');
            const restored = promptRegistryService.resetOverride(moduleId);
            mirrorLegacyModule(moduleId, { body: '', suffix: '' });
            saveCurrentSettings({ syncPromptFieldsFromDom: false });
            renderPromptEditor();
            ErrorHandler?.showUserSuccess?.(`已恢复默认: ${restored.id}`);
        });

        EventDelegate.on(modalContainer, '.ttw-save-category-layers', 'click', async (event, button) => {
            const index = Number.parseInt(button.getAttribute('data-category-index'), 10);
            const category = AppState.persistent.customCategories[index];
            if (!category) return;
            const layers = {};
            for (const layer of ['prefix', 'body', 'suffix']) {
                layers[layer] = modalContainer.querySelector(`.ttw-category-layer-input[data-category-index="${index}"][data-layer="${layer}"]`)?.value || '';
            }
            category.promptLayers = layers;
            category.contentGuide = layers.body;
            await saveCustomCategories();
            ErrorHandler?.showUserSuccess?.(`已保存分类提示词: ${category.name}`);
        });

        EventDelegate.on(modalContainer, '.ttw-reset-category-layers', 'click', async (event, button) => {
            const index = Number.parseInt(button.getAttribute('data-category-index'), 10);
            const category = AppState.persistent.customCategories[index];
            if (!category) return;
            category.promptLayers = { ...(category.promptDefaultLayers || { prefix: '', body: '', suffix: '' }) };
            category.contentGuide = category.promptLayers.body || '';
            await saveCustomCategories();
            renderPromptEditor();
            ErrorHandler?.showUserSuccess?.(`已恢复分类默认提示词: ${category.name}`);
        });
    }

    return {
        renderPromptEditor,
        bindPromptEditorEvents,
    };
}
