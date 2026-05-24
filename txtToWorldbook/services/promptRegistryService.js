import {
    defaultAliasMergePrompt,
    defaultChapterAssetsPrompt,
    defaultConsolidatePrompt,
    defaultDirectorFrameworkPrompt,
    defaultDirectorInjectionPrompt,
    defaultMergePrompt,
    defaultPlotPrompt,
    defaultStylePrompt,
    defaultWorldbookPrompt,
} from '../core/constants.js';

export const PROMPT_MODULE_IDS = Object.freeze({
    LANGUAGE_ZH: 'common.language.zh',
    WORLDBOOK_SYSTEM: 'worldbook.system',
    WORLDBOOK_PLOT: 'worldbook.plot',
    WORLDBOOK_STYLE: 'worldbook.style',
    WORLDBOOK_PREVIOUS_CONTEXT: 'worldbook.previous-context',
    WORLDBOOK_RELEVANT_CONTEXT: 'worldbook.relevant-context',
    WORLDBOOK_FORCE_CHAPTER: 'worldbook.force-chapter',
    WORLDBOOK_PARALLEL_REQUEST: 'worldbook.extract.parallel',
    WORLDBOOK_SERIAL_REQUEST: 'worldbook.extract.serial',
    WORLDBOOK_REROLL_EXTRA: 'worldbook.reroll.extra',
    WORLDBOOK_REPAIR: 'worldbook.repair',
    WORLDBOOK_SINGLE_REROLL: 'worldbook.reroll.single-entry',
    MERGE_IMPORTED: 'merge.imported-entry',
    MERGE_CONSOLIDATE: 'merge.consolidate',
    MERGE_CONSOLIDATE_RULES: 'merge.consolidate.rules',
    MERGE_ALIAS: 'merge.alias',
    DIRECTOR_CHAPTER_ASSETS: 'director.chapter-assets',
    DIRECTOR_ENTRY_EVENTS: 'director.entry-events',
    DIRECTOR_FRAMEWORK: 'director.framework',
    DIRECTOR_INJECTION: 'director.injection',
    DIRECTOR_FALLBACK_NEW_BEAT: 'director.fallback.new-beat',
    DIRECTOR_FALLBACK_IN_BEAT: 'director.fallback.in-beat',
    DIRECTOR_FALLBACK_END: 'director.fallback.end',
    CHAPTER_OPENING: 'chapter.opening',
});

function moduleDefinition(id, body = '', options = {}) {
    return Object.freeze({
        id,
        title: options.title || id,
        requiredPlaceholders: Object.freeze([...(options.requiredPlaceholders || [])]),
        defaultLayers: Object.freeze({
            prefix: '',
            body,
            suffix: '',
        }),
    });
}

export const DEFAULT_PROMPT_MODULE_DEFINITIONS = Object.freeze({
    [PROMPT_MODULE_IDS.LANGUAGE_ZH]: moduleDefinition(
        PROMPT_MODULE_IDS.LANGUAGE_ZH,
        '\u8bf7\u7528\u4e2d\u6587\u56de\u590d\u3002',
    ),
    [PROMPT_MODULE_IDS.WORLDBOOK_SYSTEM]: moduleDefinition(
        PROMPT_MODULE_IDS.WORLDBOOK_SYSTEM,
        defaultWorldbookPrompt,
        { requiredPlaceholders: ['{DYNAMIC_JSON_TEMPLATE}', '{ENABLED_CATEGORY_NAMES}'] },
    ),
    [PROMPT_MODULE_IDS.WORLDBOOK_PLOT]: moduleDefinition(PROMPT_MODULE_IDS.WORLDBOOK_PLOT, defaultPlotPrompt),
    [PROMPT_MODULE_IDS.WORLDBOOK_STYLE]: moduleDefinition(PROMPT_MODULE_IDS.WORLDBOOK_STYLE, defaultStylePrompt),
    [PROMPT_MODULE_IDS.WORLDBOOK_PREVIOUS_CONTEXT]: moduleDefinition(PROMPT_MODULE_IDS.WORLDBOOK_PREVIOUS_CONTEXT),
    [PROMPT_MODULE_IDS.WORLDBOOK_RELEVANT_CONTEXT]: moduleDefinition(PROMPT_MODULE_IDS.WORLDBOOK_RELEVANT_CONTEXT),
    [PROMPT_MODULE_IDS.WORLDBOOK_FORCE_CHAPTER]: moduleDefinition(PROMPT_MODULE_IDS.WORLDBOOK_FORCE_CHAPTER),
    [PROMPT_MODULE_IDS.WORLDBOOK_PARALLEL_REQUEST]: moduleDefinition(PROMPT_MODULE_IDS.WORLDBOOK_PARALLEL_REQUEST),
    [PROMPT_MODULE_IDS.WORLDBOOK_SERIAL_REQUEST]: moduleDefinition(PROMPT_MODULE_IDS.WORLDBOOK_SERIAL_REQUEST),
    [PROMPT_MODULE_IDS.WORLDBOOK_REROLL_EXTRA]: moduleDefinition(PROMPT_MODULE_IDS.WORLDBOOK_REROLL_EXTRA),
    [PROMPT_MODULE_IDS.WORLDBOOK_REPAIR]: moduleDefinition(PROMPT_MODULE_IDS.WORLDBOOK_REPAIR),
    [PROMPT_MODULE_IDS.WORLDBOOK_SINGLE_REROLL]: moduleDefinition(PROMPT_MODULE_IDS.WORLDBOOK_SINGLE_REROLL),
    [PROMPT_MODULE_IDS.MERGE_IMPORTED]: moduleDefinition(PROMPT_MODULE_IDS.MERGE_IMPORTED, defaultMergePrompt),
    [PROMPT_MODULE_IDS.MERGE_CONSOLIDATE]: moduleDefinition(PROMPT_MODULE_IDS.MERGE_CONSOLIDATE, defaultConsolidatePrompt),
    [PROMPT_MODULE_IDS.MERGE_CONSOLIDATE_RULES]: moduleDefinition(PROMPT_MODULE_IDS.MERGE_CONSOLIDATE_RULES),
    [PROMPT_MODULE_IDS.MERGE_ALIAS]: moduleDefinition(PROMPT_MODULE_IDS.MERGE_ALIAS, defaultAliasMergePrompt),
    [PROMPT_MODULE_IDS.DIRECTOR_CHAPTER_ASSETS]: moduleDefinition(PROMPT_MODULE_IDS.DIRECTOR_CHAPTER_ASSETS, defaultChapterAssetsPrompt),
    [PROMPT_MODULE_IDS.DIRECTOR_ENTRY_EVENTS]: moduleDefinition(PROMPT_MODULE_IDS.DIRECTOR_ENTRY_EVENTS),
    [PROMPT_MODULE_IDS.DIRECTOR_FRAMEWORK]: moduleDefinition(PROMPT_MODULE_IDS.DIRECTOR_FRAMEWORK, defaultDirectorFrameworkPrompt),
    [PROMPT_MODULE_IDS.DIRECTOR_INJECTION]: moduleDefinition(PROMPT_MODULE_IDS.DIRECTOR_INJECTION, defaultDirectorInjectionPrompt),
    [PROMPT_MODULE_IDS.DIRECTOR_FALLBACK_NEW_BEAT]: moduleDefinition(PROMPT_MODULE_IDS.DIRECTOR_FALLBACK_NEW_BEAT),
    [PROMPT_MODULE_IDS.DIRECTOR_FALLBACK_IN_BEAT]: moduleDefinition(PROMPT_MODULE_IDS.DIRECTOR_FALLBACK_IN_BEAT),
    [PROMPT_MODULE_IDS.DIRECTOR_FALLBACK_END]: moduleDefinition(PROMPT_MODULE_IDS.DIRECTOR_FALLBACK_END),
    [PROMPT_MODULE_IDS.CHAPTER_OPENING]: moduleDefinition(PROMPT_MODULE_IDS.CHAPTER_OPENING),
});

function copyLayers(layers = {}) {
    return {
        prefix: typeof layers.prefix === 'string' ? layers.prefix : '',
        body: typeof layers.body === 'string' ? layers.body : '',
        suffix: typeof layers.suffix === 'string' ? layers.suffix : '',
    };
}

function interpolate(text, variables) {
    return String(text || '').replace(/\{([A-Za-z0-9_]+)\}/g, (match, key) => (
        Object.prototype.hasOwnProperty.call(variables, key) ? String(variables[key] ?? '') : match
    ));
}

function renderLayers(layers, variables) {
    return ['prefix', 'body', 'suffix']
        .map((key) => interpolate(layers[key], variables))
        .filter((text) => text !== '')
        .join('\n\n');
}

export function createPromptRegistryService(deps = {}) {
    const AppState = deps.AppState || { settings: {} };
    const definitions = deps.moduleDefinitions || DEFAULT_PROMPT_MODULE_DEFINITIONS;

    function getSettings() {
        if (!AppState.settings || typeof AppState.settings !== 'object') AppState.settings = {};
        if (!AppState.settings.promptGlobal || typeof AppState.settings.promptGlobal !== 'object') {
            AppState.settings.promptGlobal = { prefix: '', suffix: '' };
        }
        if (!AppState.settings.promptOverrides || typeof AppState.settings.promptOverrides !== 'object') {
            AppState.settings.promptOverrides = {};
        }
        return AppState.settings;
    }

    function getDefinition(id) {
        const definition = definitions[id];
        if (!definition) throw new Error(`Unknown prompt module: ${id}`);
        return definition;
    }

    function getResolvedModule(id) {
        const definition = getDefinition(id);
        const override = getSettings().promptOverrides[id] || {};
        const layers = {};
        for (const key of ['prefix', 'body', 'suffix']) {
            layers[key] = Object.prototype.hasOwnProperty.call(override, key)
                ? String(override[key] ?? '')
                : definition.defaultLayers[key];
        }
        return {
            id,
            title: definition.title,
            requiredPlaceholders: [...definition.requiredPlaceholders],
            ...layers,
        };
    }

    function listModules() {
        return Object.keys(definitions).map((id) => getResolvedModule(id));
    }

    function setOverride(id, layers = {}) {
        getDefinition(id);
        const settings = getSettings();
        const next = { ...(settings.promptOverrides[id] || {}) };
        for (const key of ['prefix', 'body', 'suffix']) {
            if (Object.prototype.hasOwnProperty.call(layers, key)) {
                next[key] = String(layers[key] ?? '');
            }
        }
        settings.promptOverrides[id] = next;
        return getResolvedModule(id);
    }

    function resetOverride(id) {
        getDefinition(id);
        delete getSettings().promptOverrides[id];
        return getResolvedModule(id);
    }

    function renderModule(id, variables = {}) {
        return renderLayers(getResolvedModule(id), variables);
    }

    function composeRequest(moduleIds, variablesById = {}, options = {}) {
        const includeGlobal = options.includeGlobal !== false;
        const settings = getSettings();
        const rendered = [];
        if (includeGlobal && settings.language === 'zh') {
            rendered.push(renderModule(PROMPT_MODULE_IDS.LANGUAGE_ZH));
        }
        if (includeGlobal && typeof settings.promptGlobal.prefix === 'string' && settings.promptGlobal.prefix !== '') {
            rendered.push(settings.promptGlobal.prefix);
        }
        for (const id of moduleIds) {
            const content = renderModule(id, variablesById[id] || {});
            if (content !== '') rendered.push(content);
        }
        if (includeGlobal && typeof settings.promptGlobal.suffix === 'string' && settings.promptGlobal.suffix !== '') {
            rendered.push(settings.promptGlobal.suffix);
        }
        return rendered.join('\n\n');
    }

    function getWarnings(id, layers = getResolvedModule(id)) {
        const definition = getDefinition(id);
        const warnings = [];
        if (!String(layers.body || '').trim()) {
            warnings.push({ type: 'empty-body', moduleId: id });
        }
        const combined = `${layers.prefix || ''}\n${layers.body || ''}\n${layers.suffix || ''}`;
        for (const placeholder of definition.requiredPlaceholders) {
            if (!combined.includes(placeholder)) {
                warnings.push({ type: 'missing-placeholder', moduleId: id, placeholder });
            }
        }
        return warnings;
    }

    function migrateLegacySettings(settings = {}) {
        const source = settings && typeof settings === 'object' ? settings : {};
        const alreadyLayered = Number(source.promptConfigVersion) >= 1;
        const migrated = {
            ...source,
            promptConfigVersion: 1,
            promptGlobal: {
                prefix: typeof source.promptGlobal?.prefix === 'string' ? source.promptGlobal.prefix : '',
                suffix: typeof source.promptGlobal?.suffix === 'string' ? source.promptGlobal.suffix : '',
            },
            promptOverrides: {
                ...(source.promptOverrides || {}),
            },
        };
        if (alreadyLayered) return migrated;

        if (!migrated.promptGlobal.prefix && typeof source.promptPrefixPreset === 'string') {
            migrated.promptGlobal.prefix = source.promptPrefixPreset;
        }
        if (!migrated.promptGlobal.suffix && typeof source.customSuffixPrompt === 'string') {
            migrated.promptGlobal.suffix = source.customSuffixPrompt;
        }

        const bodyMappings = [
            ['customWorldbookPrompt', PROMPT_MODULE_IDS.WORLDBOOK_SYSTEM],
            ['customPlotPrompt', PROMPT_MODULE_IDS.WORLDBOOK_PLOT],
            ['customStylePrompt', PROMPT_MODULE_IDS.WORLDBOOK_STYLE],
            ['customMergePrompt', PROMPT_MODULE_IDS.MERGE_IMPORTED],
            ['customConsolidatePrompt', PROMPT_MODULE_IDS.MERGE_CONSOLIDATE],
            ['customAliasMergePrompt', PROMPT_MODULE_IDS.MERGE_ALIAS],
            ['customChapterAssetsPrompt', PROMPT_MODULE_IDS.DIRECTOR_CHAPTER_ASSETS],
            ['customDirectorFrameworkPrompt', PROMPT_MODULE_IDS.DIRECTOR_FRAMEWORK],
            ['customDirectorInjectionPrompt', PROMPT_MODULE_IDS.DIRECTOR_INJECTION],
            ['customRerollPrompt', PROMPT_MODULE_IDS.WORLDBOOK_SINGLE_REROLL],
        ];
        for (const [legacyKey, moduleId] of bodyMappings) {
            if (typeof source[legacyKey] !== 'string' || source[legacyKey] === '') continue;
            migrated.promptOverrides[moduleId] = {
                ...(migrated.promptOverrides[moduleId] || {}),
                body: source[legacyKey],
            };
        }

        const suffixMappings = [
            ['customDirectorFrameworkSuffix', PROMPT_MODULE_IDS.DIRECTOR_FRAMEWORK],
            ['customDirectorInjectionSuffix', PROMPT_MODULE_IDS.DIRECTOR_INJECTION],
        ];
        for (const [legacyKey, moduleId] of suffixMappings) {
            if (typeof source[legacyKey] !== 'string' || source[legacyKey] === '') continue;
            migrated.promptOverrides[moduleId] = {
                ...(migrated.promptOverrides[moduleId] || {}),
                suffix: source[legacyKey],
            };
        }

        migrated.directorMode = source.directorEnabled === false ? 'off' : 'api';
        migrated.directorFallbackOnError = source.directorAutoFallbackToMain !== false;
        return migrated;
    }

    return {
        listModules,
        getResolvedModule,
        setOverride,
        resetOverride,
        renderModule,
        composeRequest,
        getWarnings,
        migrateLegacySettings,
    };
}
