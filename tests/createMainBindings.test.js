import test from 'node:test';
import assert from 'node:assert/strict';

import { createShellPlaceholders } from '../txtToWorldbook/app/createMainBindings.js';

test('shell placeholders declare the batch queue factory before runtime rebinding', async () => {
    const placeholders = createShellPlaceholders();

    assert.equal(typeof placeholders.createMemoryQueueFromContent, 'function');
    assert.equal(await placeholders.createMemoryQueueFromContent('content'), undefined);
});
