import test from 'node:test';
import assert from 'node:assert/strict';

import {
    DIRECTOR_PROMPT_MANAGER_IDENTIFIER,
    clearDirectorPromptManagerContent,
    ensureDirectorPromptManagerEntry,
    getDirectorPromptManagerStatus,
    setDirectorPromptManagerContent,
} from '../txtToWorldbook/services/directorPromptManagerService.js';

function makePromptManager() {
    const promptManager = {
        activeCharacter: { id: 1 },
        serviceSettings: {
            prompts: [
                { identifier: 'main', name: 'Main', content: 'main', system_prompt: true },
                { identifier: 'chatHistory', name: 'Chat History', content: '', marker: true },
            ],
            prompt_order: [
                {
                    character_id: 1,
                    order: [
                        { identifier: 'main', enabled: true },
                        { identifier: 'chatHistory', enabled: true },
                    ],
                },
            ],
        },
    };
    promptManager.getPromptOrderForCharacter = (character) => {
        return promptManager.serviceSettings.prompt_order
            .find((list) => String(list.character_id) === String(character?.id))?.order || [];
    };
    promptManager.getPromptOrderEntry = (character, identifier) => {
        return promptManager.getPromptOrderForCharacter(character)
            .find((entry) => entry.identifier === identifier) || null;
    };
    return promptManager;
}

test('ensureDirectorPromptManagerEntry creates an absolute injection prompt after chatHistory', () => {
    const promptManager = makePromptManager();
    const result = ensureDirectorPromptManagerEntry(promptManager);

    assert.equal(result.ok, true);
    const prompt = promptManager.serviceSettings.prompts.find((item) => item.identifier === DIRECTOR_PROMPT_MANAGER_IDENTIFIER);
    assert.equal(prompt.name, 'WestWorld Director');
    assert.equal(prompt.role, 'system');
    assert.equal(prompt.injection_position, 1);
    assert.equal(prompt.injection_depth, 4);
    assert.equal(prompt.injection_order, 100);
    assert.equal(prompt.extension, true);

    const order = promptManager.getPromptOrderForCharacter(promptManager.activeCharacter);
    assert.deepEqual(order.map((item) => item.identifier), ['main', 'chatHistory', DIRECTOR_PROMPT_MANAGER_IDENTIFIER]);
});

test('setDirectorPromptManagerContent preserves user depth and order', () => {
    const promptManager = makePromptManager();
    ensureDirectorPromptManagerEntry(promptManager);
    const prompt = promptManager.serviceSettings.prompts.find((item) => item.identifier === DIRECTOR_PROMPT_MANAGER_IDENTIFIER);
    prompt.injection_position = 2;
    prompt.injection_depth = 7;
    prompt.injection_order = 250;

    const result = setDirectorPromptManagerContent(promptManager, 'director sheet');

    assert.equal(result.ok, true);
    assert.equal(prompt.content, 'director sheet');
    assert.equal(prompt.injection_position, 2);
    assert.equal(prompt.injection_depth, 7);
    assert.equal(prompt.injection_order, 250);
});

test('ensureDirectorPromptManagerEntry preserves disabled order entry', () => {
    const promptManager = makePromptManager();
    ensureDirectorPromptManagerEntry(promptManager);
    const orderEntry = promptManager.getPromptOrderEntry(promptManager.activeCharacter, DIRECTOR_PROMPT_MANAGER_IDENTIFIER);
    orderEntry.enabled = false;

    const result = ensureDirectorPromptManagerEntry(promptManager);

    assert.equal(result.ok, true);
    assert.equal(orderEntry.enabled, false);
    assert.equal(result.activeEnabled, false);
});

test('ensureDirectorPromptManagerEntry does not add depth or order for relative prompts', () => {
    const promptManager = makePromptManager();
    promptManager.serviceSettings.prompts.push({
        identifier: DIRECTOR_PROMPT_MANAGER_IDENTIFIER,
        name: 'WestWorld Director',
        role: 'system',
        content: '',
        system_prompt: false,
        injection_position: 0,
        extension: true,
    });
    promptManager.serviceSettings.prompt_order[0].order.push({
        identifier: DIRECTOR_PROMPT_MANAGER_IDENTIFIER,
        enabled: true,
    });

    const result = ensureDirectorPromptManagerEntry(promptManager);

    assert.equal(result.ok, true);
    assert.equal(result.prompt.injection_position, 0);
    assert.equal(Object.hasOwn(result.prompt, 'injection_depth'), false);
    assert.equal(Object.hasOwn(result.prompt, 'injection_order'), false);
});

test('clearDirectorPromptManagerContent keeps the entry but clears stale content', () => {
    const promptManager = makePromptManager();
    setDirectorPromptManagerContent(promptManager, 'old content');

    const result = clearDirectorPromptManagerContent(promptManager, 'skip');
    const status = getDirectorPromptManagerStatus(promptManager);

    assert.equal(result.ok, true);
    assert.equal(result.cleared, true);
    assert.equal(status.exists, true);
    assert.equal(status.contentLength, 0);
});
