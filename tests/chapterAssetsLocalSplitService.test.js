import test from 'node:test';
import assert from 'node:assert/strict';

import {
    buildLocalPresplitAssets,
    splitContentIntoBalancedSegments,
} from '../txtToWorldbook/services/chapterAssetsLocalSplitService.js';

function joinSegments(result) {
    return result.segments.join('');
}

test('local pre-split prefers paragraph boundaries when configured', () => {
    const content = '第一段开场，人物进入。第一段结束。\n\n第二段推进，冲突升级。第二段结束。\n\n第三段收束，局势落定。第三段结束。';

    const result = splitContentIntoBalancedSegments(content, {
        beatCount: 3,
        searchWindow: 12,
        boundaryPreference: 'paragraph-first',
    });

    assert.equal(result.segments.length, 3);
    assert.equal(joinSegments(result), content);
    assert.equal(result.segments[0].endsWith('\n\n'), true);
    assert.equal(result.segments[1].endsWith('\n\n'), true);
});

test('local pre-split uses sentence boundaries without paragraph breaks', () => {
    const content = '甲先抵达城门。乙随后追来。两人交换消息。守卫放行。众人进入城中。';

    const result = splitContentIntoBalancedSegments(content, {
        beatCount: 3,
        searchWindow: 8,
        boundaryPreference: 'sentence-first',
    });

    assert.equal(result.segments.length, 3);
    assert.equal(joinSegments(result), content);
    assert.equal(result.segments[0].endsWith('。'), true);
    assert.equal(result.segments[1].endsWith('。'), true);
});

test('local pre-split falls back to hard cuts when no natural boundary is available', () => {
    const content = 'abcdefghijklmno';

    const result = splitContentIntoBalancedSegments(content, {
        beatCount: 3,
        searchWindow: 0,
        boundaryPreference: 'paragraph-first',
    });

    assert.deepEqual(result.segments, ['abcde', 'fghij', 'klmno']);
    assert.equal(joinSegments(result), content);
    assert.deepEqual(result.meta.cutMeta.map((item) => item.boundary), ['hard', 'hard']);
});

test('local pre-split honors configured beat counts', () => {
    const content = '一。二。三。四。五。六。七。八。九。十。十一。十二。十三。十四。十五。';

    const result = splitContentIntoBalancedSegments(content, {
        beatCount: 5,
        searchWindow: 6,
        boundaryPreference: 'balanced',
    });

    assert.equal(result.segments.length, 5);
    assert.equal(joinSegments(result), content);
});

test('local pre-split rejects empty beat output', () => {
    assert.throws(
        () => splitContentIntoBalancedSegments('短', { beatCount: 3 }),
        /正文长度不足/,
    );
});

test('local draft assets preserve every original character in beat original_text', () => {
    const content = ' 开场保留前导空格。\n\n推进段落保留换行。\n\n收束段落保留结尾。 ';
    const assets = buildLocalPresplitAssets(content, 2, {
        beatCount: 3,
        searchWindow: 20,
        boundaryPreference: 'paragraph-first',
    });

    assert.equal(assets.script.beats.length, 3);
    assert.equal(assets.script.beats.map((beat) => beat.original_text).join(''), content);
    assert.deepEqual(assets.script.beats.map((beat) => beat.id), ['b1', 'b2', 'b3']);
    assert.deepEqual(assets.script.beats.map((beat) => beat.tags[0]), ['开场', '推进', '收束']);
    assert.equal(assets.script.beats.every((beat) => beat.self_review === 'local-presplit'), true);
});
