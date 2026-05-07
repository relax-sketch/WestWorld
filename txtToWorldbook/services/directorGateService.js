export function extractGenerationContext(eventData, lastGeneration = null) {
    if (eventData && typeof eventData === 'object') {
        return {
            type: eventData.type ?? eventData.generationType ?? lastGeneration?.type,
            params: eventData.params ?? eventData.generationParams ?? lastGeneration?.params,
            dryRun: eventData.dryRun ?? lastGeneration?.dryRun,
        };
    }
    return lastGeneration || {};
}

export function getDirectorSkipReason(eventData, gateState = {}, options = {}) {
    const now = Number.isFinite(options.now) ? options.now : Date.now();
    const userInputWindowMs = Number.isFinite(options.userInputWindowMs) ? options.userInputWindowMs : 45000;

    if (!eventData || typeof eventData !== 'object' || eventData.dryRun) {
        return 'invalid-or-dryrun';
    }

    const ctx = extractGenerationContext(eventData, gateState.lastGeneration || null);
    const params = ctx.params || {};
    const type = String(ctx.type || '').toLowerCase();

    const isQuiet = type === 'quiet'
        || !!params.quiet_prompt
        || params.quiet === true
        || params.is_quiet === true;
    const isAuto = !!params.automatic_trigger
        || !!params.background
        || !!params.is_background;
    if (isQuiet || isAuto) {
        return `quiet-or-background(type=${type || 'unknown'})`;
    }

    const isRegenerate = type === 'regenerate' || type === 'swipe' || !!params.regenerate || !!params.swipe;
    const recentUserSend = Number(gateState.lastUserSendAt || 0) > 0
        && (now - Number(gateState.lastUserSendAt || 0)) < userInputWindowMs;

    if (!gateState.pendingUserSend && !recentUserSend && !isRegenerate) {
        return 'no-recent-user-input';
    }

    return null;
}
