import assert from 'assert';
import fs from 'fs';
import path from 'path';
import vm from 'vm';
import { fileURLToPath } from 'url';
import '../../../js/utils/safeObjectLiteralParser.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const parser = globalThis.SafeObjectLiteralParser;

function assertRejected(source, pattern) {
    assert.throws(
        () => parser.parse(source),
        pattern || /SafeObjectLiteralParseError/,
        `应拒绝: ${source}`
    );
}

function testLegacyDataSyntax() {
    const value = parser.parse(`
        {
            answerKey: {
                text: { q1: 'accommodation', 2: "library", },
                matching: { q2: 'B' }
            },
            sections: [true, false, null, -1.5e2,],
            // 兼容题库行注释
            title: 'Listening \\\\ Practice',
            /* 兼容块注释 */
        }
    `);

    assert.strictEqual(Object.getPrototypeOf(value), null);
    assert.strictEqual(Object.getPrototypeOf(value.answerKey), null);
    assert.strictEqual(value.answerKey.text.q1, 'accommodation');
    assert.strictEqual(value.answerKey.text['2'], 'library');
    assert.deepStrictEqual(value.sections, [true, false, null, -150]);
    assert.strictEqual(value.title, 'Listening \\ Practice');
}

function testParseAtStopsAfterLiteral() {
    const source = "  /* config */ { answerKey: { text: { q31: 'accommodation' } } }; runLater()";
    const result = parser.parseAt(source, 0);
    assert.strictEqual(result.value.answerKey.text.q31, 'accommodation');
    assert.strictEqual(source.slice(result.endIndex).trim(), '; runLater()');
}

function testExecutableSyntaxIsRejected() {
    global.__listeningParserSentinel = 0;
    const attacks = [
        "{ value: (global.__listeningParserSentinel = 1) }",
        "{ value: global.__listeningParserSentinel }",
        "{ value: (() => 1)() }",
        "{ get value() { global.__listeningParserSentinel = 1; } }",
        "{ ...global.__payload }",
        "{ [global.__key]: 1 }",
        "{ value: `template` }",
        "{ value: /regex/ }",
        "{ value: undefined }",
        "{ value: NaN }",
        "{ value: Infinity }",
        "{ shorthand }"
    ];
    attacks.forEach((source) => assertRejected(source));
    assert.strictEqual(global.__listeningParserSentinel, 0, '恶意输入不得执行');
    delete global.__listeningParserSentinel;
}

function testPrototypePollutionKeysAreRejected() {
    assertRejected("{ __proto__: { polluted: true } }", /forbidden object key/);
    assertRejected("{ constructor: { prototype: { polluted: true } } }", /forbidden object key/);
    assertRejected("{ 'prototype': {} }", /forbidden object key/);
    assert.strictEqual({}.polluted, undefined);
}

function testLimitsAndMalformedInput() {
    assert.throws(
        () => parser.parse('{ a: { b: { c: 1 } } }', { maxDepth: 2 }),
        /maximum nesting depth/
    );
    assertRejected("{ value: 'unterminated }", /unterminated string/);
    assertRejected('{ value: 1 /* unterminated }', /unterminated block comment/);
    assert.throws(
        () => parser.parse('{ a: 1, b: 2 }', { maxProperties: 1 }),
        /maximum property count/
    );
}

function testBridgeHasNoDynamicCodeExecution() {
    const bridgePath = path.join(__dirname, '../../../js/listeningRecordBridge.js');
    const source = fs.readFileSync(bridgePath, 'utf8');
    assert.ok(!/\bnew\s+Function\s*\(/.test(source), 'bridge 不得使用 new Function');
    assert.ok(!/\beval\s*\(/.test(source), 'bridge 不得使用 eval');
    assert.ok(source.includes('SafeObjectLiteralParser.parseAt'), 'bridge 应使用纯数据解析器');
}

function testWrapperBridgeUrlKeepsStaticHostingPrefix() {
    const wrapperPath = path.join(__dirname, '../../../js/listeningUnifiedWrapper.js');
    const source = fs.readFileSync(wrapperPath, 'utf8');
    assert.ok(!source.includes("var BRIDGE_SCRIPT_URL = '/js/"), 'wrapper must not resolve the bridge from the host root');
    assert.ok(source.includes('document.currentScript') || source.includes('doc.currentScript'), 'wrapper should derive assets from its own script URL');
    assert.ok(
        source.includes("new URL('listening-record-bridge.bundle.js', currentScriptUrl)"),
        'bundled wrapper and bridge should resolve as sibling assets'
    );
    assert.strictEqual(
        new URL('listening-record-bridge.bundle.js', 'https://example.test/app/js/bundles/listening-wrapper.bundle.js').href,
        'https://example.test/app/js/bundles/listening-record-bridge.bundle.js'
    );

    const observeResolvedUrl = (currentScriptSrc, pageUrl) => {
        const marker = 'var BRIDGE_SCRIPT_URL = resolveBridgeScriptUrl();';
        const instrumented = source.replace(
            marker,
            `${marker}\n    global.__resolvedBridgeScriptUrl = BRIDGE_SCRIPT_URL;`
        );
        assert.notStrictEqual(instrumented, source, 'wrapper URL resolution must remain instrumentable');
        const document = {
            currentScript: { src: currentScriptSrc },
            readyState: 'loading',
            referrer: '',
            addEventListener() {}
        };
        const window = {
            document,
            location: new URL(pageUrl),
            opener: null
        };
        window.parent = window;
        vm.runInNewContext(instrumented, { window, URL });
        return window.__resolvedBridgeScriptUrl;
    };

    assert.strictEqual(
        observeResolvedUrl(
            'https://example.test/app/js/bundles/listening-wrapper.bundle.js',
            'https://example.test/app/assets/generated/listening-exams/listening-practice-unified.html'
        ),
        'https://example.test/app/js/bundles/listening-record-bridge.bundle.js',
        'HTTP subpath deployments must load the bridge below the same application prefix'
    );
    assert.strictEqual(
        observeResolvedUrl(
            'file:///D:/IELTS/js/listeningUnifiedWrapper.js',
            'file:///D:/IELTS/assets/generated/listening-exams/listening-practice-unified.html'
        ),
        'file:///D:/IELTS/js/bundles/listening-record-bridge.bundle.js',
        'raw wrapper source must preserve local file compatibility'
    );
}

function testResultTableGrading() {
    const bridgePath = path.join(__dirname, '../../../js/listeningRecordBridge.js');
    const source = fs.readFileSync(bridgePath, 'utf8');
    const marker = 'window.__listeningBridgeComplete = onComplete;';
    const instrumented = source.replace(marker, `${marker}
        window.__parseResults = parseResultsFromDocument;
        window.__buildPayload = buildBridgePayload;`);
    assert.notStrictEqual(instrumented, source, 'bridge result parsing must remain instrumentable');
    const document = { readyState: 'loading', addEventListener() {} };
    const window = { document, location: new URL('file:///fixtures/listening.html') };
    vm.runInNewContext(instrumented, { window, document, URL });

    const parseRows = (entries, selector = '.result-table tr') => {
        const rows = entries.map(([userAnswer, resultText, resultClass], index) => {
            const cells = [String(index + 1), userAnswer, '32', resultText]
                .map(textContent => ({ textContent }));
            cells[3].className = resultClass;
            return { querySelectorAll: () => cells };
        });
        return window.__parseResults({ querySelectorAll: query => query === selector ? rows : [] });
    };

    for (const selector of ['.result-table tr', '.feedback .grade-report tr']) {
        for (const className of ['incorrect', 'INCORRECT', 'res-incorrect', 'ans-incorrect', 'not-correct']) {
            const [detail] = parseRows([['WRONG', '', className]], selector);
            assert.strictEqual(detail.isCorrect, false, `${selector}: ${className} must not count as correct`);
        }
        for (const className of ['correct', 'GRADE CORRECT', 'res-correct', 'grade\tans-correct']) {
            const [detail] = parseRows([['accepted alternative', '', className]], selector);
            assert.strictEqual(detail.isCorrect, true, `${selector}: a correct class token must be accepted`);
        }
        const byText = parseRows([['alternative', 'Correct', ''], ['WRONG', 'Incorrect', '']], selector);
        assert.deepStrictEqual(Array.from(byText, detail => detail.isCorrect), [true, false],
            `${selector}: explicit result text must retain its grading`);
    }

    for (const correctCount of [0, 3, 10]) {
        const entries = Array.from({ length: 10 }, (_, index) => index < correctCount
            ? ['32', 'Correct', 'correct']
            : [index % 2 ? 'WRONG' : '未作答', 'Incorrect', 'incorrect']);
        const details = parseRows(entries);
        const payload = window.__buildPayload(details);
        assert.strictEqual(payload.scoreInfo.correct, correctCount, 'score must use the actual correct count');
        assert.strictEqual(payload.scoreInfo.total, 10, 'unanswered and wrong questions remain in the denominator');
        assert.strictEqual(payload.scoreInfo.accuracy, correctCount / 10);
        assert.strictEqual(payload.scoreInfo.percentage, correctCount * 10);
        assert.strictEqual(payload.answerComparison.q10.isCorrect, correctCount === 10);
    }
}

function run() {
    testLegacyDataSyntax();
    testParseAtStopsAfterLiteral();
    testExecutableSyntaxIsRejected();
    testPrototypePollutionKeysAreRejected();
    testLimitsAndMalformedInput();
    testBridgeHasNoDynamicCodeExecution();
    testWrapperBridgeUrlKeepsStaticHostingPrefix();
    testResultTableGrading();
    console.log(JSON.stringify({
        status: 'pass',
        detail: 'listening bridge safe object-literal parser regression checks passed'
    }));
}

try {
    run();
} catch (error) {
    console.error(error);
    process.exitCode = 1;
}
