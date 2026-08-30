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

test('TauriTavern top icon reuses the backgrounds drawer slot before extension settings fallback', async () => {
    const source = await readRepoFile('index.js');
    const mountStart = source.indexOf('function mountDrawerHtml(html)');
    const mountEnd = source.indexOf('async function mountDrawerWithRetry', mountStart);
    assert.ok(mountStart >= 0 && mountEnd > mountStart, 'mountDrawerHtml section must exist');
    const mountSection = source.slice(mountStart, mountEnd);

    const backgroundsIndex = mountSection.indexOf("$('#backgrounds-button')");
    const extensionsIndex = mountSection.indexOf("$('#extensions-settings-button')");

    assert.ok(backgroundsIndex >= 0, 'must look for backgrounds top icon');
    assert.ok(extensionsIndex >= 0, 'must keep extension settings fallback');
    assert.ok(backgroundsIndex < extensionsIndex, 'background slot must be preferred before extension settings fallback');
    assert.match(mountSection, /westworld-background-replaced/);
    assert.match(mountSection, /display:\s*none !important/);
    assert.match(mountSection, /\$\('#Backgrounds'\)/);
    assert.match(mountSection, /removeClass\('openDrawer open'\)\.addClass\('closedDrawer'\)/);
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
    assert.match(source, /dataset\.westworldAction\s*=\s*'previous-beat'/);
    assert.match(source, /dataset\.westworldAction\s*=\s*'toggle-pause'/);
    assert.match(source, /fa-backward-step westworld-chat-control-icon/);
    assert.match(source, /fa-forward-step westworld-chat-control-icon/);
    assert.match(source, /fa-pause westworld-chat-control-icon/);
    assert.match(source, /<span>下一拍<\/span>/);
    assert.match(source, /<span>上一拍<\/span>/);
    assert.match(source, /data-westworld-role="pause-label">停止<\/span>/);
    assert.doesNotMatch(source, /data-westworld-action="next-chapter"/);
    assert.doesNotMatch(source, /data-westworld-role="beat-counter"|data-westworld-role="state-status"/);
    assert.doesNotMatch(source, /westworld-chat-control-title|>WestWorld<\/div>|<button[^>]*westworld-chat-control/);
    assert.doesNotMatch(mountSection, /form_sheld|send_form|tt-chat-input-shell|insertBefore/);
    assert.match(source, /grid-template-columns:\s*repeat\(2, minmax\(0, 1fr\)\)/);
    assert.doesNotMatch(source, /#\$\{CHAT_CONTROL_BAR_ID\}\s*\{[^}]*justify-content:\s*center/s);
    assert.match(source, /textarea\.value\s*=\s*'开始下一拍'/);
    assert.match(source, /textarea\.dispatchEvent\(new Event\('input', \{ bubbles: true \}\)\)/);
});

test('reading progress restores once in the background without rendering a fake zero state', async () => {
    const source = await readRepoFile('index.js');
    const mainSource = await readRepoFile('txtToWorldbook/main.js');
    const bootstrapStart = source.indexOf('async function bootstrap()');
    const bootstrapSection = source.slice(bootstrapStart);

    assert.match(mainSource, /let\s+readingProgressReadyPromise\s*=\s*null/);
    assert.match(mainSource, /ensureReadingProgressReady[\s\S]*ensureDirectorRuntimeReady/);
    assert.match(source, /function\s+restoreReadingProgressInBackground\s*\(/);
    assert.match(bootstrapSection, /restoreReadingProgressInBackground\(\)/);
    assert.doesNotMatch(bootstrapSection, /await\s+restoreReadingProgressInBackground\(\)/);
    assert.match(source, /badge\.textContent\s*=\s*loading\s*\?\s*'…'/);
    assert.match(source, /badge\.hidden\s*=\s*!showProgress/);
    assert.match(source, /nextBeatItem\.hidden\s*=\s*!showProgress/);
    assert.match(source, /previousBeatItem\.hidden\s*=\s*!showProgress/);
});

test('director pause toggle disables PromptManager injection and LittleWhite prompt exposure', async () => {
    const source = await readRepoFile('index.js');

    assert.match(source, /paused:\s*false/);
    assert.match(source, /function setDirectorPaused\(paused/);
    assert.match(source, /function toggleDirectorPaused\(reason/);
    assert.match(source, /clearDirectorPromptManager\('director-paused'\)/);
    assert.match(source, /getDirectorPromptForLittleWhiteBox:[\s\S]*reason:\s*'director-paused'/);
    assert.match(source, /async function prepareDirectorPromptForInput[\s\S]*reason:\s*'director-paused'/);
    assert.match(source, /async function prepareDirectorPromptManagerForGeneration[\s\S]*reason:\s*'director-paused'/);
});

test('normal generation and regenerate rebuild Director content without delayed bootstrap clearing', async () => {
    const source = await readRepoFile('index.js');
    const prepareStart = source.indexOf('async function prepareDirectorPromptManagerForGeneration');
    const prepareEnd = source.indexOf('function registerDirectorPromptHook()', prepareStart);
    assert.ok(prepareStart >= 0 && prepareEnd > prepareStart, 'director prepare section must exist');
    const prepareSection = source.slice(prepareStart, prepareEnd);

    assert.match(prepareSection, /prepareDirectorInjectionForGeneration\(eventContext\)/);
    assert.doesNotMatch(prepareSection, /reason:\s*'regenerate-or-swipe'/);
    assert.doesNotMatch(prepareSection, /prompt-manager-reuse-empty/);

    const bootstrapStart = source.indexOf('async function bootstrap()');
    assert.ok(bootstrapStart >= 0, 'bootstrap must exist');
    const bootstrapSection = source.slice(bootstrapStart);
    const repairStart = bootstrapSection.indexOf('repairDirectorPromptManagerEntryWhenReady({');
    const repairEnd = bootstrapSection.indexOf('}).then(', repairStart);
    assert.ok(repairStart >= 0 && repairEnd > repairStart, 'bootstrap prompt repair must exist');
    assert.doesNotMatch(bootstrapSection.slice(repairStart, repairEnd), /clearContent:\s*true/);
});

test('empty input still prepares Director content for continue generation', async () => {
    const source = await readRepoFile('index.js');
    const prepareStart = source.indexOf('async function prepareDirectorPromptForInput');
    const prepareEnd = source.indexOf('async function prepareDirectorPromptManagerForGeneration', prepareStart);
    assert.ok(prepareStart >= 0 && prepareEnd > prepareStart, 'external director prepare section must exist');
    const prepareSection = source.slice(prepareStart, prepareEnd);

    assert.doesNotMatch(prepareSection, /user-input-empty/);
    assert.match(prepareSection, /prepareDirectorPromptManagerForGeneration\(\{/);
    assert.match(prepareSection, /inputLength:\s*userInput\.length/);
});
