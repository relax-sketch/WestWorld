import test from 'node:test';
import assert from 'node:assert/strict';

import { getDirectorSkipReason } from '../txtToWorldbook/services/directorGateService.js';

test('dryRun and invalid prompt events are skipped', () => {
    assert.equal(getDirectorSkipReason(null), 'invalid-or-dryrun');
    assert.equal(getDirectorSkipReason({ dryRun: true }), 'invalid-or-dryrun');
});

test('quiet and background generations are skipped', () => {
    assert.equal(
        getDirectorSkipReason({ type: 'quiet', params: {} }, { pendingUserSend: true }),
        'quiet-or-background(type=quiet)',
    );
    assert.equal(
        getDirectorSkipReason({ type: 'normal', params: { background: true } }, { pendingUserSend: true }),
        'quiet-or-background(type=normal)',
    );
});

test('normal generation without recent user input is skipped', () => {
    assert.equal(
        getDirectorSkipReason(
            { type: 'normal', params: {} },
            { pendingUserSend: false, lastUserSendAt: 1000 },
            { now: 1000 + 60000 },
        ),
        'no-recent-user-input',
    );
});

test('recent user input and regenerate/swipe pass the gate', () => {
    assert.equal(
        getDirectorSkipReason(
            { type: 'normal', params: {} },
            { pendingUserSend: false, lastUserSendAt: 1000 },
            { now: 1000 + 1000 },
        ),
        null,
    );
    assert.equal(getDirectorSkipReason({ type: 'regenerate', params: {} }, {}), null);
    assert.equal(getDirectorSkipReason({ type: 'swipe', params: {} }, {}), null);
});
