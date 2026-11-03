import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';

const source = fs.readFileSync(new URL('../../../js/components/vocabPracticeHistory.js', import.meta.url), 'utf8');
const plain = value => JSON.parse(JSON.stringify(value));

class Element {
    constructor(tag) { this.tag = tag; this.children = []; this.dataset = {}; this.attributes = {}; this.listeners = {}; this._text = ''; }
    set textContent(value) { this._text = String(value); this.children = []; }
    get textContent() { return this._text + this.children.map(child => child.textContent).join(''); }
    set innerHTML(_value) { throw new Error('Vocabulary content must remain text'); }
    appendChild(child) { this.children.push(child); return child; }
    replaceChildren(...children) { this.children = children; this._text = ''; }
    setAttribute(key, value) { this.attributes[key] = String(value); }
    addEventListener(name, callback) { this.listeners[name] = callback; }
    click() { this.listeners.click?.(); }
}

function descendants(element) { return element.children.flatMap(child => [child, ...descendants(child)]); }
function flush() { return new Promise(resolve => setImmediate(resolve)); }
function deferred() { let resolve; const promise = new Promise(accept => { resolve = accept; }); return { promise, resolve }; }

function harness() {
    const container = new Element('section'); container.id = 'vocab-practice-history';
    let active = true;
    const document = {
        createElement: tag => new Element(tag),
        getElementById: id => id === container.id ? container : id === 'practice-view'
            ? { classList: { contains: () => active } } : descendants(container).find(element => element.id === id)
    };
    const commit = [];
    const reads = [];
    const input = { words: [], collections: {}, config: {}, history: [] };
    const window = { document, console: { warn() {} }, AppData: {
        ready: Promise.resolve(), backups: { onDataCommitted: listener => commit.push(listener) },
        vocab: Object.fromEntries([['listWords', 'words'], ['listCollections', 'collections'], ['getConfig', 'config'], ['listReviewHistory', 'history']]
            .map(([method, key]) => [method, async () => { reads.push(key); return input[key]; }]))
    } };
    vm.runInNewContext(source, { window }, { filename: 'vocabPracticeHistory.js' });
    return { api: window.VocabPracticeHistory, window, document, container, input, reads, commit,
        setActive: value => { active = value; } };
}

const current = new Date(2026, 10, 2, 12);
const old = new Date(2026, 10, 1, 12).toISOString();
const future = new Date(2026, 10, 3, 12).toISOString();
const review = (id, overrides = {}) => ({ id, listId: 'default', wordId: `word-${id}`, word: `word ${id}`,
    reviewedAt: current.toISOString(), quality: 'good', spellingCorrect: true, ...overrides });

test('existing failed reviews remain learned without synthesizing complete history or today counts', () => {
    const { api } = harness();
    const input = { words: [
        { id: 'failed', lastReviewed: old, correctCount: 0, repetitions: 0, nextReview: old },
        { id: 'mastered', correctCount: 4, nextReview: future },
        { id: 'new', nextReview: old },
        { id: 'bad-date', lastReviewed: 'invalid', nextReview: 'invalid', correctCount: -2 }
    ], now: current };
    const result = plain(api.summarize(input));
    assert.deepEqual(result.all, { id: 'all', name: '全部词表', total: 4, learned: 2, mastered: 1, due: 1, today: 0, percent: 50 });
    assert.equal(result.history.length, 0);
    assert.equal(input.words[0].correctCount, 0, 'a read must not repair or mutate progress');
});

test('list identities remain independent even for the same spelling, and history outlives a removed list', () => {
    const { api } = harness();
    const result = api.summarize({ words: [{ id: 'one', word: 'shared', correctCount: 5 }],
        collections: { custom: [{ id: 'one', word: 'shared', lastReviewed: old, nextReview: old }],
            default: [{ id: 'duplicate-default' }] },
        config: { masteryCount: 6 }, history: [review('removed', { listId: 'removed-list' })], now: current });
    assert.equal(result.all.total, 2);
    assert.equal(result.all.learned, 2);
    assert.equal(result.all.mastered, 0);
    assert.equal(result.all.due, 1);
    assert.equal(result.lists.find(list => list.id === 'removed-list').today, 1);
    assert.equal(result.history[0].listName, 'removed-list');
});

test('today uses the local calendar and invalid review dates do not invent history', () => {
    const { api } = harness();
    const now = new Date(2026, 10, 2, 0, 15);
    const result = api.summarize({ now, history: [
        review('today', { reviewedAt: new Date(2026, 10, 2, 0, 1).toISOString() }),
        review('yesterday', { reviewedAt: new Date(2026, 10, 1, 23, 59).toISOString() }),
        review('bad', { reviewedAt: 'not a timestamp' })
    ] });
    assert.equal(result.all.today, 1);
    assert.deepEqual(plain(result.history.map(row => row.id)), ['today', 'yesterday']);
});

test('empty progress avoids division by zero and filtered pagination preserves all saved entries', () => {
    const { api } = harness();
    assert.equal(api.summarize().all.percent, 0);
    const result = api.summarize({ history: Array.from({ length: 45 }, (_, i) => review(String(i), {
        reviewedAt: new Date(current.getTime() + i * 1000).toISOString(), listId: i < 25 ? 'custom' : 'default'
    })) });
    const last = api.historyPage(result, 'custom', 20);
    assert.equal(last.page, 1);
    assert.equal(last.pages, 2);
    assert.equal(last.rows.length, 5);
    assert.equal(last.total, 25);
    assert.equal(api.historyPage(result, 'all', 2).rows.length, 5);
});

test('rendering is read-only, defaults to the active list, and treats stored vocabulary as text', async () => {
    const h = harness();
    h.input.config = { activeListId: 'custom' };
    h.input.collections = { custom: { words: [{ id: 'unsafe', word: '<script>test</script>', lastReviewed: old }] } };
    h.input.history = [review('unsafe', { listId: 'custom', word: '<img onerror=bad()>', meaning: '<b>meaning</b>', skipped: true })];
    await h.api.refresh();
    assert.deepEqual(h.reads.sort(), ['collections', 'config', 'history', 'words']);
    assert.equal(h.document.getElementById('vocab-history-list-filter').value, 'custom');
    assert.match(h.container.textContent, /<img onerror=bad\(\)>/);
    assert.match(h.container.textContent, /已有进度保留/);
    assert.match(h.container.textContent, /已跳过/);
    assert.equal(h.document.getElementById('vocab-review-history-body').children.length, 1);
    const select = h.document.getElementById('vocab-history-list-filter');
    select.value = 'all'; select.listeners.change();
    await h.api.refresh();
    assert.equal(h.document.getElementById('vocab-history-list-filter').value, 'all', 'refresh preserves the user filter');
    assert.equal(h.commit.length, 1, 'rendering does not duplicate subscriptions');
});

test('an older async refresh cannot replace newer progress and history', async () => {
    const h = harness();
    const pending = deferred();
    let calls = 0;
    h.window.AppData.vocab.listWords = async () => ++calls === 1 ? pending.promise : [{ id: 'latest', correctCount: 4 }];
    const older = h.api.refresh();
    await flush();
    await h.api.refresh();
    pending.resolve([]); await older;
    const mastered = descendants(h.container).find(element => element.dataset.vocabStat === 'mastered');
    assert.equal(mastered.textContent, '1');
});

test('read failure has a working retry and only active-view vocabulary commits reread data', async () => {
    const h = harness();
    h.window.AppData.vocab.listReviewHistory = async () => { throw new Error('unavailable'); };
    await h.api.refresh();
    assert.match(h.container.textContent, /读取失败/);
    h.window.AppData.vocab.listReviewHistory = async () => [];
    h.document.getElementById('vocab-history-retry').click(); await flush();
    assert.doesNotMatch(h.container.textContent, /读取失败/);
    const count = h.reads.length;
    h.setActive(false); h.commit[0]({ targets: ['vocab.words'] }); await flush();
    h.setActive(true); h.commit[0]({ targets: ['practiceSummaries'] }); await flush();
    assert.equal(h.reads.length, count);
    h.commit[0]({ targets: [{ logicalKey: 'vocab.words' }] }); await flush();
    assert.ok(h.reads.length > count);
});
