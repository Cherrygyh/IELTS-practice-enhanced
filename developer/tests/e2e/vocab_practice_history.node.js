#!/usr/bin/env node
/** Vocabulary progress stays in Practice Records and survives a browser reload. */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';

const { chromium } = createRequire(import.meta.url)(process.env.PLAYWRIGHT_MODULE || 'playwright');
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const reports = path.resolve(process.env.VOCAB_HISTORY_REPORT_DIR || path.join(root, 'developer/tests/e2e/reports/vocab-history'));
fs.mkdirSync(reports, { recursive: true });
const mime = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css',
    '.svg': 'image/svg+xml', '.json': 'application/json', '.woff2': 'font/woff2' };
const server = http.createServer((request, response) => {
    const file = path.resolve(root, '.' + decodeURIComponent(new URL(request.url, 'http://localhost').pathname));
    if (!file.startsWith(root + path.sep)) return response.writeHead(403).end();
    try {
        const body = fs.readFileSync(file);
        response.writeHead(200, { 'Content-Type': mime[path.extname(file)] || 'application/octet-stream',
            'Content-Length': body.length });
        response.end(body);
    } catch (_) { response.writeHead(404).end(); }
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const browser = await chromium.launch({ headless: true,
    ...(process.env.PLAYWRIGHT_CHANNEL ? { channel: process.env.PLAYWRIGHT_CHANNEL } : {}) });
const results = [];

async function ready(page) {
    await page.waitForFunction(() => window.app?.isInitialized && window.AppData, null, { timeout: 60000 });
    await page.evaluate(async () => {
        await AppData.ready;
        if (window.LicenseModal) await window.LicenseModal.accept();
    });
}

async function navigate(page, view) {
    await page.locator(`nav button[data-view="${view}"]`).evaluate(button => button.click());
    await page.waitForSelector(`#${view}-view.active`);
}

async function stat(page, name, expected) {
    await page.waitForFunction(({ name, expected }) =>
        document.querySelector(`#vocab-practice-history [data-vocab-stat="${name}"]`)?.textContent.trim() === String(expected),
    { name, expected });
}

async function seed(page) {
    await page.evaluate(async () => {
        const old = new Date(Date.now() - 2 * 86400000).toISOString();
        const future = new Date(Date.now() + 3 * 86400000).toISOString();
        await AppData.vocab.saveWords([
            { id: 'fresh', word: 'orchard', meaning: '果园', correctCount: 0, repetitions: 0,
                lastReviewed: null, nextReview: null },
            { id: 'mastered', word: 'beacon', meaning: '灯塔', correctCount: 4, repetitions: 4,
                easeFactor: 2.5, lastReviewed: old, nextReview: future },
            { id: 'forgotten', word: 'lagoon', meaning: '潟湖', correctCount: 0, repetitions: 0,
                easeFactor: 2.5, lastReviewed: old, nextReview: future }
        ]);
        await AppData.vocab.saveCollection('custom', { id: 'custom', name: '专项词表', words: [
            { id: 'custom-old', word: 'delta', meaning: '三角洲', correctCount: 1, repetitions: 1,
                easeFactor: 2.5, lastReviewed: old, nextReview: old },
            { id: 'custom-new', word: 'orchard', meaning: '果园', correctCount: 0, repetitions: 0 }
        ] });
        await AppData.vocab.patchConfig({ activeListId: 'default', masteryCount: 4, dailyNew: 1, reviewLimit: 1 });
        for (const type of ['reading', 'listening']) {
            await AppData.practice.completeAttempt({ record: {
                id: `history-${type}`, sessionId: `history-session-${type}`, examId: `history-exam-${type}`,
                type, title: type === 'reading' ? '阅读保留记录' : '听力保留记录',
                date: new Date().toISOString(), status: 'completed', dataSource: 'real',
                totalQuestions: 2, correctAnswers: 1, duration: 60
            } });
        }
    });
}

try {
    for (const [mode, base] of [
        ['file', pathToFileURL(root + path.sep).href],
        ['http', `http://127.0.0.1:${server.address().port}/`]
    ]) {
        const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, timezoneId: 'Asia/Shanghai' });
        const page = await context.newPage();
        page.setDefaultTimeout(20000);
        const errors = [];
        page.on('pageerror', error => errors.push(error.stack));
        page.on('dialog', dialog => dialog.accept());
        try {
            await page.goto(base + 'index.html?view=practice', { waitUntil: 'load' });
            await ready(page);
            await navigate(page, 'practice');
            await stat(page, 'total', 0);
            assert.equal(await page.locator('#vocab-review-history-body [data-review-id]').count(), 0);
            assert.equal(await page.locator('#practice-view #vocab-practice-history').count(), 1);
            assert.equal(await page.locator('nav [data-view="vocab-history"]').count(), 0);

            await seed(page);
            // The fixture writes the data API directly; a normal page entry publishes exam records.
            await navigate(page, 'more');
            await navigate(page, 'practice');
            await stat(page, 'total', 3);
            await stat(page, 'learned', 2);
            await stat(page, 'mastered', 1);
            await stat(page, 'due', 0);
            await stat(page, 'today', 0);
            assert.equal(await page.locator('#vocab-review-history-body [data-review-id]').count(), 0,
                'Old word state must not invent detailed reviews');
            assert.ok(await page.locator('#vocab-history-progress').evaluate(progress =>
                Math.abs(progress.value / progress.max - 2 / 3) < 0.01), 'Progress reflects 2 of 3 learned words');
            await page.waitForFunction(() => document.getElementById('total-practiced').textContent.trim() === '2');

            await page.selectOption('#vocab-history-list-filter', 'custom');
            await stat(page, 'total', 2);
            await stat(page, 'learned', 1);
            await stat(page, 'due', 1);
            assert.equal(await page.evaluate(async () => (await AppData.vocab.getConfig()).activeListId), 'default',
                'History filtering must not activate a different learning list');

            // Actual vocabulary controls, rather than a synthetic review-history insert.
            await navigate(page, 'more');
            await page.locator('#more-view [data-action="open-vocab"]').evaluate(button => button.click());
            await page.waitForSelector('#vocab-view.active');
            await page.waitForFunction(() => window.VocabStore?.getWords().length === 3);
            await page.locator('#vocab-view [data-action="primary-cta"]').click();
            await page.waitForSelector('#vocab-view [data-action="recognize-easy"]');
            assert.equal(await page.evaluate(() => VocabSessionView.state.currentWord.word), 'orchard');
            await page.locator('#vocab-view [data-action="recognize-easy"]').click();
            await page.locator('#vocab-view input[name="answer"]').fill('orchard');
            await page.locator('#vocab-view [data-action="submit-spelling"]').click();
            await page.waitForFunction(() => VocabSessionView.state.stage === 'feedback'
                && VocabSessionView.state.lastAnswer?.saved === true);
            const savedHistory = await page.evaluate(() => AppData.vocab.listReviewHistory());
            assert.equal(savedHistory.length, 1);
            const [review] = savedHistory;
            assert.equal(review.word, 'orchard');
            assert.equal(review.listId, 'default');
            assert.equal(review.quality, 'easy');
            assert.equal(review.spellingCorrect, true);
            assert.equal(review.skipped, false);

            await navigate(page, 'practice');
            await page.selectOption('#vocab-history-list-filter', 'default');
            await stat(page, 'learned', 3);
            await stat(page, 'today', 1);
            await page.waitForSelector('#vocab-review-history-body [data-review-id]');
            assert.match(await page.locator('#vocab-review-history-body').textContent(), /orchard/);
            assert.equal(await page.evaluate(() => VocabStore.getActiveListId()), 'default');
            assert.equal(await page.locator('#total-practiced').textContent().then(text => text.trim()), '2');
            assert.match(await page.locator('#history-list').textContent(), /阅读保留记录/);
            assert.match(await page.locator('#history-list').textContent(), /听力保留记录/);

            await page.reload({ waitUntil: 'load' });
            await ready(page);
            await navigate(page, 'practice');
            await stat(page, 'learned', 3);
            await stat(page, 'today', 1);
            assert.equal((await page.evaluate(() => AppData.vocab.listReviewHistory())).length, 1);
            assert.match(await page.locator('#vocab-review-history-body').textContent(), /orchard/);

            // An independent history fixture checks filtering and pagination without altering scores.
            await page.evaluate(async () => {
                for (let index = 0; index < 24; index++) {
                    await AppData.vocab.patchWord({ listId: 'custom', wordId: 'custom-old', patch: {}, review: {
                        id: `history-pagination-${index}`, reviewedAt: new Date(Date.now() - index * 60000).toISOString(),
                        quality: index % 2 ? 'hard' : 'good', spellingAttempts: index % 2,
                        spellingCorrect: index % 2 === 0, skipped: false
                    } });
                }
            });
            await page.selectOption('#vocab-history-list-filter', 'all');
            await stat(page, 'total', 5);
            await page.waitForFunction(() => document.querySelectorAll('#vocab-review-history-body [data-review-id]').length === 20);
            assert.equal(await page.locator('#vocab-history-next').isEnabled(), true);
            await page.locator('#vocab-history-next').click();
            assert.equal(await page.locator('#vocab-review-history-body [data-review-id]').count(), 5);
            assert.equal(await page.locator('#vocab-history-next').isDisabled(), true);
            await page.selectOption('#vocab-history-list-filter', 'default');
            await page.waitForFunction(() => document.querySelectorAll('#vocab-review-history-body [data-review-id]').length === 1);
            assert.equal(await page.locator('#vocab-history-prev').isDisabled(), true);
            assert.equal((await page.evaluate(() => AppData.practice.list())).length, 2);

            await page.selectOption('#vocab-history-list-filter', 'all');
            await page.waitForFunction(() => {
                const overlay = document.getElementById('boot-overlay');
                return !overlay || getComputedStyle(overlay).display === 'none'
                    || Number(getComputedStyle(overlay).opacity) === 0;
            });
            await page.waitForFunction(() => !document.querySelector('#message-container .message'));
            await page.locator('#vocab-practice-history').screenshot({ path: path.join(reports, `vocab-history-${mode}-desktop.png`) });
            await page.setViewportSize({ width: 390, height: 844 });
            await page.locator('#vocab-practice-history').screenshot({ path: path.join(reports, `vocab-history-${mode}-mobile.png`) });
            const bounds = await page.locator('#vocab-practice-history').boundingBox();
            assert.ok(bounds.width <= 390, 'Vocabulary progress panel must fit a mobile viewport');
            assert.deepEqual(errors, []);
            results.push({ mode, passed: true, persistedReviews: 25, examRecords: 2, pageErrors: errors });
            console.log(`PASS ${mode}: real review, persistence, filters, pagination and responsive panel`);
        } catch (error) {
            console.error(mode, await page.evaluate(async () => ({
                view: document.querySelector('.view.active')?.id,
                reviewHistory: await AppData.vocab.listReviewHistory(),
                wordState: await AppData.vocab.listWords(),
                vocabSession: window.VocabSessionView?.state,
                panelText: document.getElementById('vocab-practice-history')?.textContent
            })));
            await page.screenshot({ path: path.join(reports, `vocab-history-${mode}-failure.png`), fullPage: true });
            results.push({ mode, passed: false, error: error.stack, pageErrors: errors });
            throw error;
        } finally { await context.close(); }
    }
} finally {
    fs.writeFileSync(path.join(reports, 'vocab-history-browser-report.json'), JSON.stringify({ results }, null, 2) + '\n');
    await browser.close();
    await new Promise(resolve => server.close(resolve));
}
