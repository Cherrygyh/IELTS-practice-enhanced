/** Vocabulary progress and saved reviews inside the existing practice view. */
(function (global) {
    'use strict';

    const PAGE_SIZE = 20;
    const LIST_NAMES = {
        default: 'IELTS 核心词表',
        'spelling-errors-p1': 'P1 拼写错误',
        'spelling-errors-p4': 'P4 拼写错误',
        'spelling-errors-master': '综合错误词表',
        custom: '自定义词表',
        'reading-highlights': '阅读高亮生词'
    };
    const QUALITY_NAMES = { easy: '熟悉', good: '认识', hard: '困难', wrong: '遗忘' };
    let snapshot = null;
    let selectedList = null;
    let page = 0;
    let generation = 0;
    let subscribedData = null;

    function timestamp(value) {
        if ((typeof value !== 'string' && typeof value !== 'number') || value === '') return NaN;
        return new Date(value).getTime();
    }

    function positive(value) {
        return Number.isFinite(Number(value)) && Number(value) > 0;
    }

    function summarize({ words = [], collections = {}, config = {}, history = [], now = new Date() } = {}) {
        const nowTime = new Date(now).getTime();
        const today = new Date(nowTime).toDateString();
        const masteryCount = positive(config.masteryCount) ? Number(config.masteryCount) : 4;
        const lists = [{ id: 'default', name: LIST_NAMES.default, words }];
        Object.entries(collections || {}).forEach(([id, collection]) => {
            if (id === 'default') return;
            lists.push({ id, name: collection?.name || LIST_NAMES[id] || id,
                words: Array.isArray(collection) ? collection : collection?.words });
        });
        const reviews = (Array.isArray(history) ? history : [])
            .filter(row => row && Number.isFinite(timestamp(row.reviewedAt)))
            .map(row => ({ ...row, listId: String(row.listId || 'default') }))
            .sort((left, right) => timestamp(right.reviewedAt) - timestamp(left.reviewedAt));
        reviews.forEach(row => {
            if (!lists.some(list => list.id === row.listId)) {
                lists.push({ id: row.listId, name: LIST_NAMES[row.listId] || row.listId, words: [] });
            }
        });
        const progress = lists.map(list => {
            const entries = (Array.isArray(list.words) ? list.words : []).filter(word => word && typeof word === 'object');
            const learned = word => Number.isFinite(timestamp(word.lastReviewed))
                || positive(word.correctCount) || positive(word.repetitions);
            const total = entries.length;
            const studied = entries.filter(learned).length;
            return { id: list.id, name: String(list.name), total, learned: studied,
                mastered: entries.filter(word => positive(word.correctCount) && Number(word.correctCount) >= masteryCount).length,
                due: entries.filter(word => learned(word) && Number.isFinite(timestamp(word.nextReview))
                    && timestamp(word.nextReview) <= nowTime).length,
                today: reviews.filter(row => row.listId === list.id && new Date(row.reviewedAt).toDateString() === today).length,
                percent: total ? Math.round(studied / total * 100) : 0 };
        });
        const all = { id: 'all', name: '全部词表', total: 0, learned: 0, mastered: 0, due: 0, today: 0 };
        progress.forEach(list => {
            for (const field of ['total', 'learned', 'mastered', 'due', 'today']) all[field] += list[field];
        });
        all.percent = all.total ? Math.round(all.learned / all.total * 100) : 0;
        const names = new Map(progress.map(list => [list.id, list.name]));
        return { lists: progress, all, history: reviews.map(row => ({ ...row, listName: names.get(row.listId) })) };
    }

    function historyPage(model, listId, requestedPage = 0) {
        const rows = model.history.filter(row => listId === 'all' || row.listId === listId);
        const pages = Math.max(1, Math.ceil(rows.length / PAGE_SIZE));
        const current = Math.max(0, Math.min(pages - 1, Number(requestedPage) || 0));
        return { rows: rows.slice(current * PAGE_SIZE, (current + 1) * PAGE_SIZE), page: current, pages, total: rows.length };
    }

    function create(tag, className, text) {
        const element = global.document.createElement(tag);
        if (className) element.className = className;
        if (text !== undefined) element.textContent = String(text);
        return element;
    }

    function button(id, text, action) {
        const element = create('button', 'btn btn-secondary', text);
        element.id = id;
        element.type = 'button';
        element.addEventListener('click', action);
        return element;
    }

    function heading(container) {
        const title = create('h3', 'hero-panel__title', '背单词进度与记录');
        title.id = 'vocab-practice-history-title';
        container.appendChild(title);
    }

    function render(container) {
        container.replaceChildren();
        container.setAttribute('aria-busy', 'false');
        const header = create('div', 'hero-panel__header vocab-history__header');
        heading(header);
        const label = create('label', 'vocab-history__filter', '词表');
        const select = create('select');
        select.id = 'vocab-history-list-filter';
        label.htmlFor = select.id;
        [snapshot.all, ...snapshot.lists].forEach(list => {
            const option = create('option', '', list.name);
            option.value = list.id;
            select.appendChild(option);
        });
        select.value = selectedList;
        select.addEventListener('change', () => { selectedList = select.value; page = 0; render(container); });
        label.appendChild(select);
        header.appendChild(label);
        container.appendChild(header);
        const stats = selectedList === 'all' ? snapshot.all : snapshot.lists.find(list => list.id === selectedList);
        const cards = create('div', 'hero-grid hero-grid--stats vocab-history__stats');
        for (const [key, title, description] of [
            ['learned', '已学词条', `共 ${stats.total} 条，未学 ${stats.total - stats.learned} 条`],
            ['mastered', '已掌握', '按当前掌握标准统计'],
            ['due', '待复习', '已到复习时间的词条'],
            ['today', '今日完成', '今天已完成的复习次数']
        ]) {
            const card = create('div', 'hero-card hero-card--stat');
            card.appendChild(create('div', 'hero-card__label', title));
            const value = create('div', 'hero-card__value', stats[key]);
            value.dataset.vocabStat = key;
            card.appendChild(value);
            const meta = create('div', 'hero-card__meta', description);
            if (key === 'learned') {
                const total = create('span', 'vocab-history__total', stats.total);
                total.dataset.vocabStat = 'total';
                total.setAttribute('aria-label', '词条总量');
                meta.replaceChildren(create('span', '', '词条总量 '), total,
                    create('span', '', ` · 未学 ${stats.total - stats.learned}`));
            }
            card.appendChild(meta);
            cards.appendChild(card);
        }
        container.appendChild(cards);
        const progressLabel = create('p', 'vocab-history__progress-label', `学习进度 ${stats.learned} / ${stats.total}（${stats.percent}%）`);
        const progress = create('progress', 'vocab-history__progress');
        progress.id = 'vocab-history-progress';
        progress.max = stats.total || 1;
        progress.value = stats.learned;
        progress.setAttribute('aria-label', '已学词条进度');
        container.appendChild(progressLabel);
        container.appendChild(progress);
        container.appendChild(create('p', 'hero-panel__muted vocab-history__note',
            selectedList === 'all' ? '全部词表按词条分别统计，同一单词在不同词表中的进度独立。' : '进度使用本词表已保存的学习状态。'));
        container.appendChild(create('p', 'hero-panel__muted vocab-history__note',
            '已有进度保留，完整复习记录从此功能启用后保存；仅统计已完成的复习。'));

        const current = historyPage(snapshot, selectedList, page);
        page = current.page;
        container.appendChild(create('h4', 'vocab-history__subtitle', `复习记录（${current.total} 次）`));
        if (!current.total) {
            const message = create('p', 'hero-panel__muted vocab-history__empty', stats.total
                ? '本词表暂无完整复习记录，完成背词后会自动显示在这里。'
                : '暂无背词数据，可从“更多工具 → 词汇练习”开始学习。');
            message.setAttribute('role', 'status');
            container.appendChild(message);
            return;
        }
        const wrap = create('div', 'vocab-history__table-wrap');
        const table = create('table', 'vocab-history__table');
        const head = create('thead');
        const labels = create('tr');
        ['复习时间', '单词', '词表', '结果', '拼写'].forEach(text => {
            const cell = create('th', '', text); cell.scope = 'col'; labels.appendChild(cell);
        });
        head.appendChild(labels); table.appendChild(head);
        const body = create('tbody');
        body.id = 'vocab-review-history-body';
        current.rows.forEach(row => {
            const tr = create('tr');
            tr.dataset.reviewId = String(row.id || '');
            const timeCell = create('td');
            const time = create('time', '', new Date(row.reviewedAt).toLocaleString('zh-CN'));
            time.dateTime = new Date(row.reviewedAt).toISOString();
            timeCell.appendChild(time); tr.appendChild(timeCell);
            const word = create('td'); word.appendChild(create('strong', '', row.word || '未命名单词'));
            if (row.meaning) word.appendChild(create('small', '', row.meaning));
            tr.appendChild(word);
            tr.appendChild(create('td', '', row.listName));
            tr.appendChild(create('td', '', QUALITY_NAMES[row.quality] || '未记录'));
            const spelling = row.skipped ? '已跳过' : row.spellingCorrect === true ? '拼写正确'
                : row.spellingCorrect === false ? `拼写有误（${Number(row.spellingAttempts) || 0} 次）` : '未记录';
            tr.appendChild(create('td', '', spelling)); body.appendChild(tr);
        });
        table.appendChild(body); wrap.appendChild(table); container.appendChild(wrap);
        const pagination = create('div', 'vocab-history__pagination');
        const previous = button('vocab-history-prev', '上一页', () => { page -= 1; render(container); });
        previous.disabled = page === 0;
        const next = button('vocab-history-next', '下一页', () => { page += 1; render(container); });
        next.disabled = page + 1 >= current.pages;
        const pageLabel = create('span', '', `第 ${page + 1} / ${current.pages} 页`); pageLabel.id = 'vocab-history-page';
        pagination.appendChild(previous); pagination.appendChild(pageLabel); pagination.appendChild(next);
        container.appendChild(pagination);
    }

    async function refresh() {
        const container = global.document.getElementById('vocab-practice-history');
        if (!container) return;
        const request = ++generation;
        container.setAttribute('aria-busy', 'true');
        if (!snapshot) { container.replaceChildren(); heading(container); container.appendChild(create('p', 'hero-panel__muted', '正在读取背单词进度与记录…')); }
        try {
            const data = global.AppData;
            await data.ready;
            if (subscribedData !== data && data.backups?.onDataCommitted) {
                data.backups.onDataCommitted(event => {
                    const affected = (event.targets || []).some(target => String(typeof target === 'string' ? target : target.logicalKey).startsWith('vocab.'));
                    if (affected && global.document.getElementById('practice-view')?.classList.contains('active')) void refresh();
                });
                subscribedData = data;
            }
            const [words, collections, config, history] = await Promise.all([
                data.vocab.listWords(), data.vocab.listCollections(), data.vocab.getConfig(), data.vocab.listReviewHistory()
            ]);
            if (request !== generation) return;
            snapshot = summarize({ words, collections, config, history });
            if (selectedList === null) selectedList = config?.activeListId || 'default';
            if (selectedList !== 'all' && !snapshot.lists.some(list => list.id === selectedList)) selectedList = 'default';
            render(container);
        } catch (error) {
            if (request !== generation) return;
            container.replaceChildren(); heading(container);
            container.setAttribute('aria-busy', 'false');
            const message = create('p', 'hero-panel__muted', '背单词进度与记录读取失败，请重试。');
            message.setAttribute('role', 'alert'); container.appendChild(message);
            container.appendChild(button('vocab-history-retry', '重试', () => { void refresh(); }));
            global.console?.warn('[VocabPracticeHistory] 读取失败:', error);
        }
    }

    global.VocabPracticeHistory = Object.freeze({ refresh, summarize, historyPage });
})(typeof window !== 'undefined' ? window : globalThis);
