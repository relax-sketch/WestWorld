export const PROMPT_TARGETS = Object.freeze({
    CATEGORY_EXTRACTION: 'categoryExtraction',
    TXT_TO_WORLDBOOK: 'txtToWorldbook',
    CONSOLIDATE_ENTRY: 'consolidateEntry',
    ALIAS_MERGE: 'aliasMerge',
    DIRECTOR_CHAPTER_ASSETS: 'directorChapterAssets',
    DIRECTOR_FRAMEWORK: 'directorFramework',
    DIRECTOR_INJECTION: 'directorInjection',
});

const PROMPT_TARGET_SET = new Set(Object.values(PROMPT_TARGETS));

function cleanPromptPart(value) {
    return String(value ?? '').replace(/\r\n?/g, '\n').trim();
}

function shouldUseDirectorSuffix(settings) {
    return settings?.directorSuffixEnabled !== false;
}

export function assemblePromptParts(parts = {}) {
    return [
        parts.languagePrefix,
        parts.globalPrefix,
        parts.body,
        parts.targetSuffix,
        parts.globalSuffix,
        parts.finalInstruction,
    ]
        .map(cleanPromptPart)
        .filter(Boolean)
        .join('\n\n');
}

export function createPromptAssemblyService(deps = {}) {
    const { AppState } = deps;

    function getSettings() {
        return AppState?.settings || {};
    }

    function getLanguageOnlyPrefix() {
        return getSettings().language === 'zh' ? '请用中文回复。' : '';
    }

    function getGlobalPrefix() {
        return getSettings().promptPrefixPreset || '';
    }

    function getGlobalSuffix() {
        return getSettings().customSuffixPrompt || '';
    }

    function getDirectorFrameworkSuffix() {
        return shouldUseDirectorSuffix(getSettings()) ? getSettings().customDirectorFrameworkSuffix || '' : '';
    }

    function getDirectorInjectionSuffix() {
        return shouldUseDirectorSuffix(getSettings()) ? getSettings().customDirectorInjectionSuffix || '' : '';
    }

    function assembleTargetPrompt(target, body, options = {}) {
        if (!PROMPT_TARGET_SET.has(target)) {
            throw new Error(`未知提示词目标: ${target}`);
        }

        return assemblePromptParts({
            languagePrefix: options.includeLanguagePrefix === false ? '' : (options.languagePrefix ?? getLanguageOnlyPrefix()),
            globalPrefix: options.includeGlobalPrefix === false ? '' : (options.globalPrefix ?? getGlobalPrefix()),
            body,
            targetSuffix: options.targetSuffix || '',
            globalSuffix: options.includeGlobalSuffix === false ? '' : (options.globalSuffix ?? getGlobalSuffix()),
            finalInstruction: options.finalInstruction || '',
        });
    }

    function assembleDirectorFrameworkPrompt(body) {
        return assembleTargetPrompt(PROMPT_TARGETS.DIRECTOR_FRAMEWORK, body, {
            targetSuffix: getDirectorFrameworkSuffix(),
        });
    }

    function assembleDirectorInjectionPrompt(body) {
        return assembleTargetPrompt(PROMPT_TARGETS.DIRECTOR_INJECTION, body, {
            targetSuffix: getDirectorInjectionSuffix(),
        });
    }

    return {
        PROMPT_TARGETS,
        assembleTargetPrompt,
        assembleDirectorFrameworkPrompt,
        assembleDirectorInjectionPrompt,
        getLanguageOnlyPrefix,
        getGlobalPrefix,
        getGlobalSuffix,
    };
}
