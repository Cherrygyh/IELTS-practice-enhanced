#!/usr/bin/env node
/** Local IELTS-up extension: real popup, bridge, persisted scores and review UI. */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';

const { chromium } = createRequire(import.meta.url)('playwright');
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const reports = path.join(root, 'developer/tests/e2e/reports');
const extension = path.join(root, 'ListeningPractice/P1/05-IELTS-up/05-IELTS-up-Part-1.html');
if (!fs.existsSync(extension)) {
    console.log('SKIP: optional local IELTS-up listening extension is not installed.');
    process.exit(0);
}
fs.mkdirSync(reports, { recursive: true });

const mime = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css',
    '.svg': 'image/svg+xml', '.json': 'application/json', '.mp3': 'audio/mpeg' };
const server = http.createServer((request, response) => {
    const filename = path.resolve(root, '.' + decodeURIComponent(new URL(request.url, 'http://localhost').pathname));
    if (!filename.startsWith(root + path.sep)) return response.writeHead(403).end();
    try {
        const data = fs.readFileSync(filename);
        const range = request.headers.range?.match(/^bytes=(\d+)-(\d*)$/);
        const start = range ? Number(range[1]) : 0;
        const end = range?.[2] ? Math.min(Number(range[2]), data.length - 1) : data.length - 1;
        response.writeHead(range ? 206 : 200, {
            'Content-Type': mime[path.extname(filename)] || 'application/octet-stream',
            'Accept-Ranges': 'bytes', 'Content-Length': end - start + 1,
            ...(range ? { 'Content-Range': `bytes ${start}-${end}/${data.length}` } : {})
        });
        response.end(data.subarray(start, end + 1));
    } catch (_) { response.writeHead(404).end(); }
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const browser = await chromium.launch({ headless: true,
    ...(process.env.PLAYWRIGHT_CHANNEL ? { channel: process.env.PLAYWRIGHT_CHANNEL } : {}) });
const results = [];

async function openPractice(context, host) {
    await host.bringToFront();
    const [child] = await Promise.all([
        context.waitForEvent('page'),
        host.evaluate(async () => {
            await window.ensureBrowseGroup();
            const exam = window.listeningExamIndex.find(item => item.title === 'IELTS-up Test 05 · Part 1');
            if (!exam) throw new Error('Local listening index did not load');
            await window.app.openExam(exam.id, { practiceMode: 'single', examDefinition: exam });
        })
    ]);
    await child.waitForLoadState('load');
    let practice = child;
    if (!host.url().startsWith('file:')) {
        await child.waitForSelector('#listening-practice-frame');
        practice = await (await child.$('#listening-practice-frame')).contentFrame();
    }
    await practice.waitForFunction(() => window.__listeningBridgeGetState?.().initialized, null, { timeout: 20000 });
    return { child, practice };
}

async function checkTranscript(practice) {
    await practice.locator('#transcript-btn').click();
    await practice.waitForSelector('#listening-transcript:not([hidden])');
    assert.match(await practice.locator('.transcript-notice').textContent(), /自动转写，可能有误/);
    assert.ok((await practice.locator('#transcript-content').textContent()).trim().length > 100);
    assert.equal(await practice.locator('#transcript-btn').getAttribute('aria-expanded'), 'true');
    await practice.locator('#transcript-btn').click();
    assert.equal(await practice.locator('#listening-transcript').isVisible(), false);
    assert.equal(await practice.locator('#transcript-btn').getAttribute('aria-expanded'), 'false');
    await practice.locator('#transcript-btn').click();
    assert.equal(await practice.locator('#listening-transcript').isVisible(), true);
}

try {
    for (const [mode, base] of [
        ['file', pathToFileURL(root + path.sep).href],
        ['http', `http://127.0.0.1:${server.address().port}/`]
    ]) {
        const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
        const errors = [];
        context.on('page', page => {
            page.on('pageerror', error => errors.push(error.stack));
            page.on('dialog', dialog => dialog.accept());
        });
        const host = await context.newPage();
        try {
            await host.goto(base + 'index.html?view=practice', { waitUntil: 'load' });
            await host.waitForFunction(() => window.app?.isInitialized && window.AppData, null, { timeout: 60000 });
            await host.evaluate(async () => {
                await AppData.ready;
                await window.app._practiceRecorderRebindPromise;
                if (window.LicenseModal) await window.LicenseModal.accept();
            });
            for (const expected of [0, 4, 10]) {
                const { child, practice } = await openPractice(context, host);
                try {
                    assert.equal(await practice.locator('#transcript-btn').isDisabled(), true);
                    assert.equal(await practice.locator('#listening-transcript').isVisible(), false);
                    if (expected === 0) {
                        // Finish real media playback near its end, without waiting five minutes.
                        await practice.waitForFunction(() => Number.isFinite(document.querySelector('audio').duration));
                        await practice.evaluate(async () => {
                            const audio = document.querySelector('audio');
                            audio.currentTime = Math.max(0, audio.duration - 0.2);
                            await audio.play();
                        });
                        await practice.waitForFunction(() => document.querySelector('audio').ended);
                        assert.equal(await practice.locator('#transcript-btn').isEnabled(), true);
                        if (mode === 'http') {
                            await context.route('**/transcript.js', route => route.abort(), { times: 1 });
                            await practice.locator('#transcript-btn').click();
                            await practice.waitForFunction(() => document.getElementById('transcript-hint').textContent.includes('加载失败'));
                            assert.equal(await practice.locator('#transcript-btn').isEnabled(), true);
                        }
                        await checkTranscript(practice);
                        await host.bringToFront();
                        assert.equal((await host.evaluate(() => AppData.practice.list())).length, 0,
                            'Finishing audio and reading its transcript must not submit a score');
                    }
                    // Inputs are genuine local questions. Unanswered questions remain wrong.
                    await practice.evaluate(count => {
                        const data = JSON.parse(document.getElementById('practice-data').textContent);
                        Object.keys(data.answers).slice(0, count).forEach(key => {
                            document.getElementById(key).value = data.answers[key][0];
                        });
                    }, expected);
                    await practice.locator('#finish-btn').click();
                    assert.equal(await practice.locator('#score-output').textContent(), `本节得分：${expected} / 10`);
                    assert.equal(await practice.locator('#transcript-btn').isEnabled(), true);
                    await practice.waitForFunction(() => __listeningBridgeGetState().completed, null, { timeout: 20000 });
                    if (expected === 4) {
                        await checkTranscript(practice);
                        await practice.locator('#listening-transcript').evaluate(section => section.scrollIntoView({ block: 'start' }));
                        await child.screenshot({ path: path.join(reports, `local-listening-${mode}-transcript.png`) });
                    }
                    await host.bringToFront();
                    const records = await host.evaluate(() => AppData.practice.list());
                    assert.equal(records.length, results.filter(result => result.mode === mode).length + 1);
                    const saved = records.find(record => record.correctAnswers === expected);
                    assert.ok(saved, `No persisted ${expected}/10 record`);
                    assert.equal(saved.totalQuestions, 10);
                    assert.equal(saved.accuracy, expected / 10);
                    const full = await host.evaluate(id => AppData.practice.get(id), saved.id);
                    assert.equal(full.correctAnswers, expected);
                    assert.equal(Object.values(full.scoreInfo.details).filter(answer => answer.isCorrect).length, expected);
                    assert.equal(Object.values(full.answerComparison).filter(answer => answer.isCorrect).length, expected);
                    results.push({ mode, score: expected, total: saved.totalQuestions, accuracy: saved.accuracy });
                    console.log(`PASS ${mode}: ${expected}/10 and transcript review`);
                } catch (error) {
                    console.error(mode, expected, await practice.evaluate(() => {
                        const audio = document.querySelector('audio');
                        return { url: location.href, audio: { src: audio.currentSrc, duration: audio.duration,
                            currentTime: audio.currentTime, readyState: audio.readyState, ended: audio.ended,
                            networkState: audio.networkState, error: audio.error?.message } };
                    }));
                    await child.screenshot({ path: path.join(reports, `local-listening-${mode}-failure.png`) });
                    throw error;
                } finally { await child.close(); }
            }
            await host.bringToFront();
            await host.locator('nav button[data-view="practice"]').evaluate(button => button.click());
            await host.waitForSelector('#practice-view.active');
            await host.waitForFunction(() => Math.abs(parseFloat(document.getElementById('avg-score').textContent) - 46.6667) < 0.1);
            assert.equal((await host.locator('#total-practiced').textContent()).trim(), '3');
            await host.screenshot({ path: path.join(reports, `local-listening-${mode}-statistics.png`) });
            assert.deepEqual(errors, []);
        } finally { await context.close(); }
    }
    fs.writeFileSync(path.join(reports, 'local-listening-review-report.json'), JSON.stringify({ results }, null, 2) + '\n');
    console.log(JSON.stringify({ results }, null, 2));
} finally {
    await browser.close();
    await new Promise(resolve => server.close(resolve));
}
