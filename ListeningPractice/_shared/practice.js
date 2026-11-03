(function () {
    'use strict';
    const data = JSON.parse(document.getElementById('practice-data').textContent);
    window.correctAnswers = data.answers;
    const keys = Object.keys(data.answers);
    const normalized = value => String(value).trim().toLowerCase()
        .replace(/[‘’]/g, "'").replace(/[-–—]/g, ' ').replace(/\s+/g, ' ');
    function equivalent(user, expected) {
        if (!String(user).trim()) return false;
        if (expected.includes(',')) {
            const tokens = value => value.toLowerCase().split(/\s*(?:,|;|\band\b)\s*/)
                .map(normalized).filter(Boolean).sort().join('|');
            // A single question can require a set of letters, e.g. B,D.
            if (/^[a-z](?:\s*[,; ]\s*[a-z])+$/i.test(expected)) {
                const letters = value => value.toUpperCase().replace(/[\s,;]/g, '');
                return /^[A-Z]+$/.test(letters(user)) && letters(user).split('').sort().join('') === letters(expected).split('').sort().join('');
            }
            return tokens(user) === tokens(expected);
        }
        return normalized(user) === normalized(expected);
    }
    const matches = (user, key) => data.answers[key].some(expected => equivalent(user, expected));
    const audio = document.querySelector('audio');
    const review = document.createElement('div');
    review.innerHTML = '<button id="transcript-btn" type="button" disabled aria-expanded="false" aria-controls="listening-transcript">查看听力原文</button><p id="transcript-hint">播放结束或提交评分后可查看听力原文。</p>';
    document.getElementById('score-output').after(review);
    const transcriptButton = document.getElementById('transcript-btn');
    const transcriptHint = document.getElementById('transcript-hint');
    const transcript = document.createElement('section');
    transcript.id = 'listening-transcript';
    transcript.hidden = true;
    transcript.setAttribute('aria-labelledby', 'transcript-title');
    transcript.innerHTML = '<h2 id="transcript-title">听力原文</h2><p class="transcript-notice">自动转写，可能有误。请以音频为准。</p><div id="transcript-content"></div>';
    document.getElementById('result').after(transcript);
    let transcriptLoaded = false;
    function unlockTranscript() {
        transcriptButton.disabled = false;
        transcriptHint.textContent = '可展开原文，配合音频复盘。';
    }
    audio.addEventListener('ended', unlockTranscript);
    transcriptButton.addEventListener('click', function () {
        if (transcriptLoaded) {
            transcript.hidden = !transcript.hidden;
            this.setAttribute('aria-expanded', String(!transcript.hidden));
            this.textContent = transcript.hidden ? '查看听力原文' : '收起听力原文';
            return;
        }
        this.disabled = true;
        transcriptHint.textContent = '正在加载原文…';
        // A local script also works when the project is opened with file://.
        const script = document.createElement('script');
        script.src = new URL('transcript.js', document.baseURI).href;
        const failed = () => {
            script.remove();
            this.disabled = false;
            transcriptHint.textContent = '原文加载失败，请确认本题目录中的 transcript.js 存在，然后重试。';
        };
        script.onerror = failed;
        script.onload = () => {
            const segments = window.IELTSListeningTranscript?.segments;
            if (!Array.isArray(segments) || !segments.length) return failed();
            const content = document.getElementById('transcript-content');
            for (const segment of segments) {
                const paragraph = document.createElement('p');
                paragraph.textContent = segment.text.trim();
                content.appendChild(paragraph);
            }
            transcriptLoaded = true;
            transcript.hidden = false;
            this.disabled = false;
            this.setAttribute('aria-expanded', 'true');
            this.textContent = '收起听力原文';
            transcriptHint.textContent = '原文已加载，可收起后继续重听。';
        };
        document.body.appendChild(script);
    });
    document.getElementById('finish-btn').addEventListener('click', function () {
        const answers = Object.fromEntries(keys.map(key => [key, document.getElementById(key).value.trim()]));
        // Each answer in a consecutive multi-choice group earns credit once, in any order.
        for (const group of data.groups) {
            const remaining = group.map(q => answers['q' + q]);
            const assigned = {};
            for (const q of group) {
                const index = remaining.findIndex(value => matches(value, 'q' + q));
                if (index >= 0) assigned[q] = remaining.splice(index, 1)[0];
            }
            for (const q of group) answers['q' + q] = assigned[q] ?? remaining.shift() ?? '';
        }
        let score = 0;
        const table = document.createElement('table');
        table.className = 'result-table';
        table.innerHTML = '<thead><tr><th>题号</th><th>你的答案</th><th>参考答案（可接受写法）</th><th>结果</th></tr></thead>';
        const body = table.createTBody();
        for (const key of keys) {
            const correct = matches(answers[key], key);
            if (correct) score += 1;
            const row = body.insertRow();
            for (const value of [key.slice(1), answers[key] || '未作答', data.answers[key].join(' | '), correct ? 'Correct' : 'Incorrect']) {
                row.insertCell().textContent = value;
            }
            row.lastElementChild.className = correct ? 'correct' : 'incorrect';
        }
        document.getElementById('result').replaceChildren(table);
        document.getElementById('score-output').textContent = '本节得分：' + score + ' / ' + keys.length;
        audio.pause();
        unlockTranscript();
        document.querySelectorAll('#answer-sheet input').forEach(input => { input.readOnly = true; });
        this.disabled = true;
        this.textContent = '已提交';
    });
})();
