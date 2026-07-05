import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

async function readRepoFile(relativePath) {
    return readFile(path.join(REPO_ROOT, relativePath), 'utf8');
}

test('manifest declares TauriTavern activate hook', async () => {
    const manifest = JSON.parse(await readRepoFile('manifest.json'));

    assert.equal(manifest.js, 'index.js');
    assert.deepEqual(manifest.hooks, { activate: 'init' });
});

test('index exports an idempotent init hook and preserves legacy jQuery startup', async () => {
    const source = await readRepoFile('index.js');

    assert.match(source, /export\s+async\s+function\s+init\s*\(/);
    assert.match(source, /let\s+bootstrapPromise\s*=\s*null/);
    assert.match(source, /if\s*\(\s*bootstrapPromise\s*\)\s*return\s+bootstrapPromise/);
    assert.match(source, /jQuery\s*\(\s*\(\)\s*=>\s*\{\s*void\s+init\s*\(\s*\)/s);
});

test('index exposes outer WestWorld API before non-critical startup steps can fail', async () => {
    const source = await readRepoFile('index.js');
    const bootstrapStart = source.indexOf('async function bootstrap()');
    assert.ok(bootstrapStart >= 0, 'bootstrap must exist');
    const bootstrapSection = source.slice(bootstrapStart);

    const exposeIndex = bootstrapSection.indexOf('exposeWestWorldApiShell();');
    const txtInitIndex = bootstrapSection.indexOf("runBootstrapStep('txt-to-worldbook-init'");

    assert.ok(exposeIndex >= 0, 'bootstrap must expose API shell');
    assert.ok(txtInitIndex >= 0, 'bootstrap must initialize txt module');
    assert.ok(exposeIndex < txtInitIndex, 'outer API shell must be exposed before TXT init');
    assert.match(source, /getBootstrapStatus\s*[,}]/);
});

test('TauriTavern chat controls stay in magic wand with a separate progress badge', async () => {
    const source = await readRepoFile('index.js');
    const mountStart = source.indexOf('function mountChatControlBar()');
    const mountEnd = source.indexOf('function registerChatControlRefreshHooks()', mountStart);
    assert.ok(mountStart >= 0 && mountEnd > mountStart, 'mountChatControlBar section must exist');
    const mountSection = source.slice(mountStart, mountEnd);

    assert.match(source, /CHAT_CONTROL_PROGRESS_BADGE_ID/);
    assert.match(source, /document\.getElementById\('extensionsMenu'\)/);
    assert.match(source, /document\.getElementById\('extensionsMenuButton'\)/);
    assert.match(source, /insertAdjacentElement\('afterend', badge\)/);
    assert.match(source, /dataset\.westworldAction\s*=\s*'next-beat'/);
    assert.match(source, /fa-forward-step westworld-chat-control-icon/);
    assert.match(source, /<span>下一拍<\/span>/);
    assert.doesNotMatch(source, /data-westworld-action="next-chapter"/);
    assert.doesNotMatch(source, /data-westworld-role="beat-counter"|data-westworld-role="state-status"/);
    assert.doesNotMatch(source, /westworld-chat-control-title|>WestWorld<\/div>|<button[^>]*westworld-chat-control/);
    assert.doesNotMatch(mountSection, /form_sheld|send_form|tt-chat-input-shell|insertBefore/);
});
