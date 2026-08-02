(() => {
  'use strict';

  const STORAGE_KEY = 'high-voltage-electrician-study-v3';
  const SUPPORT_PROMPT_KEY = 'high-voltage-electrician-support-prompt-v1';
  const EXAM_TOTAL = 100;
  const EXAM_JUDGEMENT = 70;
  const EXAM_SINGLE = 30;
  const EXAM_DURATION = 120 * 60;
  const MODES = ['study', 'memorize', 'exam', 'wrong', 'favorites'];
  const MODE_META = {
    study: { label: '刷题模式', icon: '◎', eyebrow: 'PRACTICE', description: '即时判断，错题自动展开解析。' },
    memorize: { label: '背题模式', icon: '▤', eyebrow: 'MEMORIZE', description: '先看答案与解析，熟悉考点和表达。' },
    exam: { label: '考试模式', icon: '▣', eyebrow: 'MOCK EXAM', description: '按真实机考节奏完成一套模拟试卷。' },
    wrong: { label: '考试错题', icon: '△', eyebrow: 'WRONG ANSWERS', description: '集中复习历次考试和刷题中做错的题目。' },
    favorites: { label: '收藏的题目', icon: '★', eyebrow: 'FAVORITES', description: '把需要反复巩固的题目放在一起。' }
  };

  const sourceHeadings = Array.from(document.querySelectorAll('body > h3'));
  const questions = parseQuestions(sourceHeadings);
  const questionMap = new Map(questions.map(question => [question.id, question]));
  const state = loadState();
  const ui = {
    indexQuery: '',
    settingsOpen: false,
    exportOpen: false,
    indexOpen: false,
    historyOpen: false,
    menuOpen: false,
    supportPromptOpen: false,
    reviewRecordId: null,
    reviewWrongOnly: false,
    reviewPosition: 0,
    selectedIds: { wrong: new Set(), favorites: new Set() }
  };

  let toastTimer = null;
  let timerHandle = null;
  let app;

  function parseQuestions(headings) {
    return headings.map((heading, index) => {
      const siblings = [];
      let node = heading.nextElementSibling;
      while (node && node.tagName !== 'H3') {
        siblings.push(node);
        node = node.nextElementSibling;
      }

      const metadata = siblings.find(element => element.tagName === 'UL' && Array.from(element.children).some(child => readFieldLabel(child) === '题型'));
      const metadataItems = metadata ? Array.from(metadata.children).filter(child => child.tagName === 'LI') : [];
      const typeItem = metadataItems.find(item => readFieldLabel(item) === '题型');
      const optionsItem = metadataItems.find(item => readFieldLabel(item) === '选项');
      const answerItem = metadataItems.find(item => readFieldLabel(item) === '正确答案');
      const analysisItem = metadataItems.find(item => readFieldLabel(item) === '解析');
      const options = optionsItem ? Array.from(optionsItem.querySelectorAll(':scope > ul > li')).map((item, optionIndex) => parseOption(item, optionIndex)) : [];
      const type = getFieldText(typeItem) || '选择题';
      const answerRaw = getFieldText(answerItem);
      const answerLabels = normalizeAnswer(answerRaw, options);
      const metadataIndex = metadata ? siblings.indexOf(metadata) : -1;
      const trailingParagraphs = metadataIndex >= 0 ? siblings.slice(metadataIndex + 1).filter(element => element.tagName === 'P' && cleanText(element.textContent)) : [];
      let analysisHtml = getFieldHtml(analysisItem);
      if (trailingParagraphs.length) {
        analysisHtml += trailingParagraphs.map(element => `<p>${element.innerHTML}</p>`).join('');
      }

      return {
        id: `q${index + 1}`,
        number: index + 1,
        titleHtml: stripQuestionNumber(heading.innerHTML),
        titleText: cleanText(heading.textContent).replace(/^\s*\d+\s*[.、．]\s*/, ''),
        type,
        kind: type.includes('判断') ? '判断' : '选择',
        options,
        answerRaw: answerRaw || answerLabels.join(' / '),
        answerLabels,
        analysisHtml: analysisHtml || '<p>暂无解析。</p>'
      };
    }).filter(question => question.options.length && question.answerLabels.length);
  }

  function readFieldLabel(item) {
    if (!item) return '';
    const strong = item.querySelector('strong');
    return strong ? cleanText(strong.textContent).replace(/[：:]$/, '') : '';
  }

  function getFieldText(item) {
    if (!item) return '';
    const clone = item.cloneNode(true);
    const strong = clone.querySelector('strong');
    if (strong) strong.remove();
    return cleanText(clone.textContent).replace(/^\s*[：:]\s*/, '');
  }

  function getFieldHtml(item) {
    if (!item) return '';
    const clone = item.cloneNode(true);
    const paragraph = clone.querySelector('p');
    const strong = paragraph ? paragraph.querySelector('strong') : clone.querySelector('strong');
    if (strong) strong.remove();
    const html = (paragraph ? paragraph.innerHTML : clone.innerHTML).replace(/^\s*[：:]\s*/, '').trim();
    return html ? `<p>${html}</p>` : '';
  }

  function parseOption(item, index) {
    const raw = cleanText(item.textContent);
    const match = raw.match(/^([A-H])\s*[：:]\s*(.*)$/s);
    const label = match ? match[1].toUpperCase() : String.fromCharCode(65 + index);
    let html = item.innerHTML.replace(/^\s*[A-H]\s*[：:]\s*/, '').trim();
    if (!html) html = escapeHtml(match ? match[2] : raw);
    const text = cleanText(match ? match[2] : raw);
    return { label, html, text };
  }

  function normalizeAnswer(raw, options) {
    const value = cleanText(raw).replace(/[（(].*?[）)]/g, '').trim();
    if (!value) return [];
    const letterMatches = value.match(/[A-H]/gi);
    if (letterMatches && /^[A-Ha-h\s、,，及和与或\/+]+$/.test(value)) return Array.from(new Set(letterMatches.map(letter => letter.toUpperCase())));
    const exact = options.find(option => option.text === value || option.text.replace(/[。；;]$/, '') === value.replace(/[。；;]$/, ''));
    if (exact) return [exact.label];
    const mapped = options.find(option => value.includes(option.text) || option.text.includes(value));
    return mapped ? [mapped.label] : [value];
  }

  function stripQuestionNumber(html) {
    return html.replace(/^\s*\d+\s*[.、．]\s*/, '').trim();
  }

  function cleanText(value) {
    return String(value || '').replace(/\u00a0/g, ' ').replace(/\s+/g, ' ').trim();
  }

  function escapeHtml(value) {
    return String(value).replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[character]));
  }

  function defaultState() {
    return {
      mode: 'study',
      progress: { study: null, memorize: null, exam: null, wrong: null, favorites: null },
      favorites: [],
      responses: {},
      reveals: { study: {}, memorize: {}, wrong: {}, favorites: {} },
      incorrectIds: [],
      dismissedWrong: [],
      settings: {
        memorizeAnalysis: false,
        wrongAnswer: false,
        wrongAnalysis: false,
        favoritesAnswer: true,
        favoritesAnalysis: true,
        examSize: EXAM_TOTAL,
        memorizeView: '1'
      },
      exams: [],
      examDraft: null,
      lastExamId: null
    };
  }

  function loadState() {
    const fallback = defaultState();
    try {
      const stored = JSON.parse(localStorage.getItem(STORAGE_KEY) || 'null');
      if (!stored || typeof stored !== 'object') return fallback;
      const merged = {
        ...fallback,
        ...stored,
        progress: { ...fallback.progress, ...(stored.progress || {}) },
        reveals: { ...fallback.reveals, ...(stored.reveals || {}) },
        settings: { ...fallback.settings, ...(stored.settings || {}) },
        favorites: Array.isArray(stored.favorites) ? stored.favorites : [],
        incorrectIds: Array.isArray(stored.incorrectIds) ? stored.incorrectIds : [],
        dismissedWrong: Array.isArray(stored.dismissedWrong) ? stored.dismissedWrong : [],
        exams: Array.isArray(stored.exams) ? stored.exams : [],
        responses: stored.responses && typeof stored.responses === 'object' ? stored.responses : {}
      };
      return merged;
    } catch (error) {
      return fallback;
    }
  }

  function saveState() {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); } catch (error) { /* Storage can be disabled in private browsing. */ }
  }

  function getFavorites() {
    return state.favorites.filter(id => questionMap.has(id));
  }

  function getWrongIds() {
    const wrong = new Set(state.incorrectIds.filter(id => questionMap.has(id)));
    state.exams.forEach(record => {
      (record.questionIds || []).forEach(id => {
        const question = questionMap.get(id);
        if (!question) return;
        const selected = record.answers && record.answers[id];
        if (selected && !isCorrect(question, selected)) wrong.add(id);
      });
    });
    state.dismissedWrong.forEach(id => wrong.delete(id));
    return Array.from(wrong);
  }

  function getModeIds(mode) {
    if (mode === 'favorites') return getFavorites();
    if (mode === 'wrong') return getWrongIds();
    if (mode === 'exam') return state.examDraft ? state.examDraft.questionIds : [];
    if (mode === 'examReview') {
      const record = getReviewRecord();
      if (!record) return [];
      return (record.questionIds || []).filter(id => !ui.reviewWrongOnly || !isRecordCorrect(record, id));
    }
    return questions.map(question => question.id);
  }

  function getReviewRecord() {
    return state.exams.find(record => record.id === ui.reviewRecordId) || null;
  }

  function isCorrect(question, selected) {
    if (!selected) return false;
    const expected = question.answerLabels.slice().sort().join('|');
    const actual = (Array.isArray(selected) ? selected : [selected]).slice().sort().join('|');
    return expected === actual;
  }

  function isRecordCorrect(record, id) {
    const question = questionMap.get(id);
    return question ? isCorrect(question, record.answers && record.answers[id]) : false;
  }

  function getModeIndex(mode, ids) {
    if (!ids.length) return 0;
    if (mode === 'examReview') return Math.max(0, Math.min(ids.length - 1, Number(ui.reviewPosition) || 0));
    const savedId = state.progress[mode];
    const savedIndex = savedId ? ids.indexOf(savedId) : -1;
    return savedIndex >= 0 ? savedIndex : 0;
  }

  function setProgress(mode, id) {
    if (mode === 'examReview') {
      const ids = getModeIds(mode);
      const nextIndex = ids.indexOf(id);
      if (nextIndex >= 0) ui.reviewPosition = nextIndex;
      return;
    }
    if (mode in state.progress) state.progress[mode] = id;
    saveState();
  }

  function getReveal(mode, id, part, defaultValue) {
    const modeReveals = state.reveals[mode] || {};
    if (modeReveals[id] && typeof modeReveals[id][part] === 'boolean') return modeReveals[id][part];
    return defaultValue;
  }

  function setReveal(mode, id, part, value) {
    if (!state.reveals[mode]) state.reveals[mode] = {};
    if (!state.reveals[mode][id]) state.reveals[mode][id] = {};
    state.reveals[mode][id][part] = value;
    saveState();
  }

  function getResponse(mode, questionId) {
    if (mode === 'exam') return state.examDraft && state.examDraft.answers ? state.examDraft.answers[questionId] : null;
    if (mode === 'examReview') {
      const record = getReviewRecord();
      return record && record.answers ? record.answers[questionId] : null;
    }
    return state.responses[questionId] || null;
  }

  function getDefaultVisibility(mode, questionId, part, response) {
    if (mode === 'study') return Boolean(response);
    if (mode === 'memorize') return part === 'answer' ? true : Boolean(state.settings.memorizeAnalysis);
    if (mode === 'wrong') return Boolean(response) || (part === 'answer' ? Boolean(state.settings.wrongAnswer) : Boolean(state.settings.wrongAnalysis));
    if (mode === 'favorites') return Boolean(response) || (part === 'answer' ? Boolean(state.settings.favoritesAnswer) : Boolean(state.settings.favoritesAnalysis));
    if (mode === 'examReview') return true;
    return false;
  }

  function questionVisibility(mode, question, response) {
    const defaultAnswer = getDefaultVisibility(mode, question.id, 'answer', response);
    const defaultAnalysis = getDefaultVisibility(mode, question.id, 'analysis', response);
    return {
      answer: getReveal(mode, question.id, 'answer', defaultAnswer),
      analysis: getReveal(mode, question.id, 'analysis', defaultAnalysis)
    };
  }

  function appShell(ids, currentIndex, question) {
    const meta = MODE_META[state.mode] || (state.mode === 'examReview' ? { label: '考试复盘', icon: '▣', eyebrow: 'EXAM REVIEW', description: '查看整套试卷、答案与解析。' } : MODE_META.study);
    const currentId = question ? question.id : null;
    const progress = ids.length ? Math.round(((currentIndex + 1) / ids.length) * 100) : 0;
    const navItems = MODES.map(mode => {
      const count = mode === 'study' || mode === 'memorize' ? questions.length : mode === 'wrong' ? getWrongIds().length : mode === 'favorites' ? getFavorites().length : state.examDraft ? state.examDraft.questionIds.length : 0;
      return `<button class="nav-item ${state.mode === mode ? 'active' : ''}" data-action="switch-mode" data-mode="${mode}"><span class="nav-main"><span class="nav-icon">${MODE_META[mode].icon}</span><span>${MODE_META[mode].label}</span></span><span class="nav-count">${count}</span></button>`;
    }).join('');
    return `<div class="app-shell">
      <header class="topbar">
        <button class="icon-action mobile-menu" data-action="toggle-menu" title="打开题目导航" aria-label="打开题目导航"><span class="action-icon">☰</span></button>
        <div class="brand"><span class="brand-mark">⚡</span><div class="brand-copy"><div class="brand-title">高压电工题库</div><div class="brand-subtitle">离线练习 · 进度自动保存</div></div></div>
        <div class="top-search"><span class="top-search-icon">⌕</span><input data-global-search value="${escapeHtml(ui.indexQuery)}" placeholder="检索题号或题干" aria-label="检索题号或题干"><button class="top-search-open" data-action="toggle-index" title="打开题目索引" aria-label="打开题目索引">↵</button></div>
        <div class="topbar-spacer"></div>
        <div class="top-actions">
          <button class="top-action" data-action="toggle-export" title="导出错题和收藏"><span class="action-icon">⇩</span><span class="action-label">导出</span></button>
          <button class="top-action" data-action="toggle-settings" title="练习设置"><span class="action-icon">⚙</span><span class="action-label">设置</span></button>
        </div>
      </header>
      ${ui.menuOpen ? '<div class="menu-scrim" data-action="close-menu" aria-label="关闭题目导航"></div>' : ''}
      <div class="workspace">
        <aside class="sidebar">
          <nav class="nav-section"><div class="nav-label">学习模式</div>${navItems}</nav>
        </aside>
        <main class="main"><div class="main-inner">
          <div class="mode-heading">
            <div><div class="eyebrow">${meta.eyebrow}</div><h1 class="mode-title">${meta.label}</h1><p class="mode-description">${meta.description}</p></div>
            <div class="heading-actions">${renderHeadingActions()}<div class="progress-card"><div class="progress-copy"><div class="progress-numbers"><strong>${ids.length ? currentIndex + 1 : 0}</strong><span>/ ${ids.length}</span></div><div class="progress-bar"><span style="width:${progress}%"></span></div></div><span class="index-total">${progress}%</span></div></div>
          </div>
          ${renderModeBody(ids, currentIndex, question)}
        </div></main>
      </div>
      ${renderOverlays(ids, currentId)}
      <div class="toast" aria-live="polite"></div>
    </div>`;
  }

  function renderHeadingActions() {
    const indexAction = `<button class="ghost-action" data-action="toggle-index"><span>☷</span> 题目索引</button>`;
    if (state.mode === 'memorize') return `${indexAction}${renderMemorizeViewControls()}`;
    if (state.mode === 'exam') {
      return `${indexAction}<button class="ghost-action" data-action="show-history"><span>▤</span> 历史试卷</button>`;
    }
    if (state.mode === 'examReview') {
      return `${indexAction}<button class="toggle-button ${ui.reviewWrongOnly ? 'active' : ''}" data-action="toggle-review-wrong">${ui.reviewWrongOnly ? '查看全部题目' : '只看错题'}</button><button class="ghost-action" data-action="show-history"><span>▤</span> 历史试卷</button>`;
    }
    if (state.mode === 'wrong' || state.mode === 'favorites') return `${indexAction}<button class="ghost-action" data-action="toggle-export"><span>⇩</span> 导出</button>`;
    return indexAction;
  }

  function renderMemorizeViewControls() {
    const current = getMemorizeView();
    return `<div class="view-switcher" aria-label="背题显示数量"><button class="toggle-button ${current === '1' ? 'active' : ''}" data-action="memorize-view" data-size="1">单题</button><button class="toggle-button ${current === '100' ? 'active' : ''}" data-action="memorize-view" data-size="100">100 题</button><button class="toggle-button ${current === 'all' ? 'active' : ''}" data-action="memorize-view" data-size="all">全部</button></div>`;
  }

  function getMemorizeView() {
    const value = String(state.settings.memorizeView || '1');
    if (value === '10') return '100';
    return value === '100' || value === 'all' ? value : '1';
  }

  function renderModeBody(ids, currentIndex, question) {
    if (state.mode === 'exam' && !state.examDraft) return renderExamLanding();
    if (!question) return renderEmptyState();
    if (state.mode === 'exam') return `<div class="exam-panel">${renderExamBanner(ids)}${renderQuestionCard(question, currentIndex, { displayNumber: currentIndex + 1 })}</div>`;
    if (state.mode === 'examReview') return `<div class="review-tools"><span class="status-pill">${getReviewRecord() ? formatDate(getReviewRecord().createdAt) : '考试记录'}</span><span class="index-total">${ui.reviewWrongOnly ? '当前仅显示错题' : '显示整套试卷'}</span></div>${renderQuestionCard(question, currentIndex, { displayNumber: getExamQuestionNumber(question.id) })}`;
    if (state.mode === 'memorize' && getMemorizeView() !== '1') return renderMemorizeList(ids, currentIndex);
    if (state.mode === 'wrong' || state.mode === 'favorites') return `${renderCollectionTools(state.mode, ids)}${renderQuestionCard(question, currentIndex)}`;
    return renderQuestionCard(question, currentIndex);
  }

  function renderMemorizeList(ids, currentIndex) {
    const view = getMemorizeView();
    const pageSize = 100;
    const pageCount = Math.max(1, Math.ceil(ids.length / pageSize));
    const pageIndex = view === 'all' ? 0 : Math.min(pageCount - 1, Math.floor(currentIndex / pageSize));
    const pageStart = pageIndex * pageSize;
    const visibleIds = view === 'all' ? ids : ids.slice(pageStart, pageStart + pageSize);
    const startNumber = ids.length ? (view === 'all' ? 1 : pageStart + 1) : 0;
    const endRange = view === 'all' ? visibleIds.length : Math.min(ids.length, pageStart + visibleIds.length);
    const pageTools = view === 'all' ? `<span class="index-total">已显示全部 ${ids.length} 题</span>` : renderMemorizePager(pageIndex, pageCount, pageStart + 1, endRange);
    const cards = visibleIds.map((id, offset) => renderQuestionCard(questionMap.get(id), (view === 'all' ? 0 : pageStart) + offset, { compact: true })).join('');
    const bottomPager = view === '100' ? `<div class="memorize-page-tools memorize-bottom-tools">${pageTools}</div>` : '';
    return `<div class="memorize-batch"><div class="memorize-batch-toolbar"><div><strong>背题浏览</strong><span>答案默认显示，题号随题目保留</span></div><div class="memorize-page-tools">${pageTools}</div></div><div class="memorize-list">${cards}</div>${bottomPager}</div>`;
  }

  function renderMemorizePager(pageIndex, pageCount, startNumber, endNumber) {
    const options = Array.from({ length: pageCount }, (_, index) => {
      const start = index * 100 + 1;
      const end = Math.min(questions.length, start + 99);
      return `<option value="${index}" ${index === pageIndex ? 'selected' : ''}>${start}-${end}</option>`;
    }).join('');
    return `<button class="ghost-action nav-button" data-action="memorize-page" data-page="${Math.max(0, pageIndex - 1)}" ${pageIndex <= 0 ? 'disabled' : ''}>← 上一组</button><select class="select-field memorize-group-select" data-memorize-page aria-label="选择题目组">${options}</select><span class="index-total memorize-range-label">第 ${startNumber}-${endNumber} 题</span><button class="primary-action nav-button" data-action="memorize-page" data-page="${Math.min(pageCount - 1, pageIndex + 1)}" ${pageIndex >= pageCount - 1 ? 'disabled' : ''}>下一组 →</button>`;
  }

  function setMemorizePage(page) {
    const ids = getModeIds('memorize');
    const pageCount = Math.ceil(ids.length / 100);
    if (!pageCount) return;
    const pageIndex = Math.max(0, Math.min(pageCount - 1, Number(page) || 0));
    const id = ids[pageIndex * 100];
    if (!id) return;
    setProgress('memorize', id);
    render();
    window.requestAnimationFrame(() => document.querySelector('.question-card')?.scrollIntoView({ behavior: 'smooth', block: 'start' }));
  }

  function getExamQuestionNumber(id) {
    const sourceIds = state.mode === 'exam' ? (state.examDraft?.questionIds || []) : (getReviewRecord()?.questionIds || []);
    const position = sourceIds.indexOf(id);
    return position >= 0 ? position + 1 : 1;
  }

  function getSelectedIds(mode, ids) {
    const selected = ui.selectedIds[mode] || new Set();
    return new Set(ids.filter(id => selected.has(id)));
  }

  function renderCollectionTools(mode, ids) {
    const selected = getSelectedIds(mode, ids);
    const allSelected = ids.length > 0 && selected.size === ids.length;
    const label = mode === 'wrong' ? '错题' : '收藏';
    return `<div class="collection-tools"><label class="select-all-control"><input type="checkbox" data-select-all="${mode}" ${allSelected ? 'checked' : ''}><span>全选</span></label><button class="toggle-button" data-action="invert-selection" data-selection-mode="${mode}">反选</button><span class="collection-selected">已选 ${selected.size} / ${ids.length}</span><button class="danger-action" data-action="remove-selected" data-selection-mode="${mode}" ${selected.size ? '' : 'disabled'}>${mode === 'wrong' ? '移除选中错题' : '取消选中收藏'}</button><span class="collection-hint">${label}题可批量管理</span></div>`;
  }

  function renderEmptyState() {
    const mode = state.mode === 'wrong' ? '错题' : state.mode === 'favorites' ? '收藏题目' : '题目';
    const description = state.mode === 'wrong' ? '交卷或完成刷题后，做错的题目会自动出现在这里。' : state.mode === 'favorites' ? '点击题目右上角的星标，把重点题目集中到这里。' : '当前没有可显示的题目。';
    return `<div class="empty-state"><div><div class="empty-icon">${state.mode === 'favorites' ? '☆' : '✓'}</div><h3>还没有${mode}</h3><p>${description}</p>${state.mode === 'wrong' || state.mode === 'favorites' ? '<button class="primary-action" data-action="switch-mode" data-mode="study" style="margin-top:18px">开始刷题</button>' : ''}</div></div>`;
  }

  function renderExamLanding() {
    const record = state.exams.find(item => item.id === state.lastExamId);
    if (record) return `<div class="exam-result"><div class="result-line"><span class="result-score">${record.correct}/${record.total}</span><span class="result-caption">答对 ${Math.round((record.correct / record.total) * 100)}% · ${formatDate(record.createdAt)}</span></div><div class="result-actions"><button class="primary-action" data-action="view-exam" data-record-id="${record.id}">查看本套试卷</button><button class="ghost-action" data-action="start-exam">开始新试卷</button><button class="text-action" data-action="show-history">查看历史记录</button></div></div>`;
    return `<div class="exam-start-card"><div class="exam-start-icon">▣</div><div><div class="eyebrow">READY TO START</div><h3>准备开始模拟考试</h3><p>每套试卷固定 100 题：判断题 70 题、单选题 30 题，判断题在前，考试时间 120 分钟。</p><div class="exam-rules"><span>判断题 70 分</span><span>单选题 30 分</span><span>总分 100 分</span><span>限时 120 分钟</span></div><button class="primary-action" data-action="start-exam" style="margin-top:18px">确认并开始考试</button></div></div>`;
  }

  function renderExamBanner(ids) {
    const draft = state.examDraft;
    const remaining = draft ? Math.max(0, draft.durationSec - Math.floor((Date.now() - draft.startedAt) / 1000)) : EXAM_DURATION;
    const answered = draft ? Object.keys(draft.answers || {}).length : 0;
    return `<div class="exam-banner"><div><strong>模拟机考 · 判断题 1-70 · 单选题 71-100</strong><span>已作答 ${answered}/${ids.length} 题 · 每题 1 分 · 交卷后显示成绩</span></div><div class="exam-clock" data-exam-clock>${formatTime(remaining)}</div><button class="primary-action exam-submit" data-action="submit-exam">交卷</button></div>`;
  }

  function renderQuestionCard(question, currentIndex, options = {}) {
    const mode = state.mode;
    const compact = Boolean(options.compact);
    const displayNumber = options.displayNumber || question.number;
    const isExam = mode === 'exam';
    const isReview = mode === 'examReview';
    const readOnly = mode === 'memorize' || isReview;
    const response = getResponse(mode, question.id);
    const selected = Array.isArray(response) ? response[0] : response;
    const evaluated = !isExam && Boolean(selected);
    const correct = evaluated && isCorrect(question, selected);
    const visibility = questionVisibility(mode, question, selected);
    const favorite = state.favorites.includes(question.id);
    const selectedForBatch = (ui.selectedIds[mode] || new Set()).has(question.id);
    const selectionControl = mode === 'wrong' || mode === 'favorites' ? `<label class="question-select" title="选择题目"><input type="checkbox" data-selection-id="${question.id}" ${selectedForBatch ? 'checked' : ''}><span></span></label>` : '';
    const status = evaluated ? (correct ? '<span class="status-pill success">回答正确</span>' : '<span class="status-pill danger">回答错误</span>') : (isExam && selected ? '<span class="status-pill">已作答</span>' : '');
    const optionsHtml = question.options.map(option => {
      const isSelected = selected === option.label;
      const isAnswer = question.answerLabels.includes(option.label);
      let optionClass = 'option';
      if (isSelected) optionClass += ' selected';
      if ((evaluated || isReview) && isAnswer) optionClass += ' correct';
      if ((evaluated || isReview) && isSelected && !isAnswer) optionClass += ' wrong';
      const disabled = readOnly ? 'disabled' : '';
      return `<button class="${optionClass}" data-action="select-option" data-option="${option.label}" data-question-id="${question.id}" ${disabled}><span class="option-letter">${option.label}</span><span class="option-copy">${option.html}</span></button>`;
    }).join('');
    const answerText = question.answerRaw || question.answerLabels.join(' / ');
    const answerBlock = isExam ? '' : `<section class="answer-block"><div class="answer-row"><div><div class="answer-label">正确答案</div><div class="answer-value ${visibility.answer ? '' : 'hidden-value'}">${visibility.answer ? escapeHtml(answerText) : '点击右侧按钮查看'}</div></div><button class="text-action" data-action="toggle-reveal" data-part="answer" data-question-id="${question.id}">${visibility.answer ? '隐藏答案' : '显示答案'}</button></div><div class="analysis-wrap"><div class="analysis-head"><span class="analysis-head-left"><span class="answer-label">解析</span><a class="analysis-support-link" href="https://lemonaihub.com/" target="_blank" rel="noreferrer">LemonAI中转提供算力</a></span><button class="text-action" data-action="toggle-reveal" data-part="analysis" data-question-id="${question.id}">${visibility.analysis ? '隐藏解析' : '显示解析'}</button></div><div class="analysis-content ${visibility.analysis ? '' : 'hidden'}">${question.analysisHtml}</div></section>`;
    const footerLeft = mode === 'wrong' ? `<button class="text-action" data-action="dismiss-wrong" data-question-id="${question.id}">移除错题</button>` : mode === 'favorites' ? `<button class="text-action" data-action="toggle-favorite" data-question-id="${question.id}">取消收藏</button>` : '';
    const footerRight = `<button class="ghost-action nav-button" data-action="previous" ${currentIndex <= 0 ? 'disabled' : ''}>← 上一题</button><button class="primary-action nav-button" data-action="next" ${currentIndex >= getModeIds(mode).length - 1 ? 'disabled' : ''}>下一题 →</button>`;
    const footer = compact ? '' : `<div class="card-footer"><div class="footer-left">${footerLeft || '<span class="index-total">选择一个选项后会自动保存进度</span>'}</div><div class="footer-right">${footerRight}</div></div>`;
    return `<article class="question-card ${compact ? 'compact-question-card' : ''}"><div class="card-toolbar"><div class="question-meta">${selectionControl}<span>第 ${displayNumber} 题</span><span class="type-pill">${escapeHtml(question.type)}</span>${status}</div><button class="icon-action ${favorite ? 'favorite' : ''}" data-action="toggle-favorite" data-question-id="${question.id}" title="${favorite ? '取消收藏' : '收藏题目'}" aria-label="${favorite ? '取消收藏' : '收藏题目'}">${favorite ? '★' : '☆'}</button></div><div class="card-body"><h2 class="question-title">${question.titleHtml}</h2><div class="options">${optionsHtml}</div>${answerBlock}</div>${footer}</article>`;
  }

  function renderIndexButtons(ids, currentId) {
    const query = cleanText(ui.indexQuery).toLowerCase();
    const filtered = query ? ids.filter(id => {
      const question = questionMap.get(id);
      return question && (`${question.number} ${question.titleText}`).toLowerCase().includes(query);
    }) : ids;
    if (!filtered.length) return '<div class="index-total" style="padding:10px">没有匹配题目</div>';
    return filtered.map(id => {
      const question = questionMap.get(id);
      const response = state.mode === 'exam' ? state.examDraft?.answers?.[id] : state.mode === 'examReview' ? getReviewRecord()?.answers?.[id] : state.responses[id];
      const statusClass = response && question ? (isCorrect(question, response) ? 'correct' : 'wrong') : '';
      const displayNumber = state.mode === 'exam' || state.mode === 'examReview' ? getExamQuestionNumber(id) : question.number;
      return `<button class="index-button ${id === currentId ? 'active' : ''} ${statusClass}" data-action="jump-to" data-question-id="${id}"><span>${displayNumber}. ${escapeHtml(question.titleText.slice(0, 30))}${question.titleText.length > 30 ? '…' : ''}</span></button>`;
    }).join('');
  }

  function renderOverlays(ids, currentId) {
    let html = '';
    if (ui.supportPromptOpen) html += renderSupportOverlay();
    if (ui.settingsOpen) html += renderSettingsOverlay();
    if (ui.exportOpen) html += renderExportOverlay();
    if (ui.indexOpen) html += renderIndexOverlay(ids, currentId);
    if (ui.historyOpen) html += renderHistoryOverlay();
    return html;
  }

  function renderSupportOverlay() {
    return `<div class="overlay support-overlay" data-overlay="support"><section class="dialog support-dialog"><div class="support-hero"><div class="support-badge">广告</div><h2 class="dialog-title">全部解析由 LemonAI 中转提供算力</h2><p class="dialog-subtitle">如果这份题库对你有帮助，请顺手支持一下。点击可前往 <strong>lemonaihub.com</strong>，关闭后将不再弹出。</p></div><div class="support-actions"><a class="primary-action support-cta" href="https://lemonaihub.com/" target="_blank" rel="noreferrer">前往支持</a><button class="ghost-action" data-action="dismiss-support">关闭并不再提示</button></div></section></div>`;
  }

  function renderIndexOverlay(ids, currentId) {
    return `<div class="overlay" data-overlay="index"><section class="dialog index-dialog"><div class="dialog-head"><div><h2 class="dialog-title">题目索引</h2><p class="dialog-subtitle">当前模式共 ${ids.length} 题，可按题号或题干搜索。</p></div><button class="icon-action" data-action="close-overlay" title="关闭">×</button></div><input class="index-search index-dialog-search" data-index-search value="${escapeHtml(ui.indexQuery)}" placeholder="搜索题号或题干" aria-label="搜索题号或题干"><div class="index-list index-dialog-list">${renderIndexButtons(ids, currentId)}</div></section></div>`;
  }

  function renderSettingsOverlay() {
    return `<div class="overlay" data-overlay="settings"><section class="dialog"><div class="dialog-head"><div><h2 class="dialog-title">练习设置</h2><p class="dialog-subtitle">设置会自动保存到当前浏览器。</p></div><button class="icon-action" data-action="close-overlay" title="关闭">×</button></div><div class="settings-grid"><div class="setting-row"><div class="setting-copy"><strong>背题模式默认显示解析</strong><span>答案始终显示，解析可按需预览</span></div>${renderSwitch('memorizeAnalysis', state.settings.memorizeAnalysis)}</div><div class="setting-row"><div class="setting-copy"><strong>错题模式默认显示答案</strong><span>关闭后仍可在题目中手动显示</span></div>${renderSwitch('wrongAnswer', state.settings.wrongAnswer)}</div><div class="setting-row"><div class="setting-copy"><strong>错题模式默认显示解析</strong><span>适合集中复盘错误原因</span></div>${renderSwitch('wrongAnalysis', state.settings.wrongAnalysis)}</div><div class="setting-row"><div class="setting-copy"><strong>收藏模式默认显示答案</strong><span>打开收藏题目时直接看到答案</span></div>${renderSwitch('favoritesAnswer', state.settings.favoritesAnswer)}</div><div class="setting-row"><div class="setting-copy"><strong>收藏模式默认显示解析</strong><span>打开收藏题目时直接看到解析</span></div>${renderSwitch('favoritesAnalysis', state.settings.favoritesAnalysis)}</div><div class="setting-row setting-info"><div class="setting-copy"><strong>模拟考试规则</strong><span>100 题 · 判断题 70 题 + 单选题 30 题 · 120 分钟 · 判断题在前</span></div><span class="status-pill">固定规则</span></div></div></section></div>`;
  }

  function renderSwitch(key, checked) {
    return `<label class="switch"><input type="checkbox" data-setting="${key}" ${checked ? 'checked' : ''}><span class="switch-track"></span></label>`;
  }

  function renderExportOverlay() {
    const wrongCount = getWrongIds().length;
    const favoriteCount = getFavorites().length;
    const combinedCount = getExportIds('combined').length;
    const exportButtons = setName => `<button class="ghost-action" data-action="export-set" data-set="${setName}" data-format="json">JSON</button><button class="ghost-action" data-action="export-set" data-set="${setName}" data-format="csv">CSV</button><button class="ghost-action" data-action="export-set" data-set="${setName}" data-format="markdown">Markdown</button>`;
    return `<div class="overlay" data-overlay="export"><section class="dialog"><div class="dialog-head"><div><h2 class="dialog-title">导出题目</h2><p class="dialog-subtitle">支持 JSON、CSV 和 Markdown，内容包含题干、选项、答案和解析。</p></div><button class="icon-action" data-action="close-overlay" title="关闭">×</button></div><div class="export-grid"><div class="export-row"><div><strong>错题 + 收藏（去重）</strong><div class="index-total">${combinedCount} 题</div></div><div class="export-actions">${exportButtons('combined')}</div></div><div class="export-row"><div><strong>考试错题</strong><div class="index-total">${wrongCount} 题</div></div><div class="export-actions">${exportButtons('wrong')}</div></div><div class="export-row"><div><strong>收藏题目</strong><div class="index-total">${favoriteCount} 题</div></div><div class="export-actions">${exportButtons('favorites')}</div></div></div></section></div>`;
  }

  function renderHistoryOverlay() {
    const history = state.exams.length ? state.exams.map(record => `<div class="history-item"><div class="history-main"><div class="history-date">${formatDate(record.createdAt)}</div><div class="history-detail">${record.correct}/${record.total} 题答对 · ${record.questionIds.length} 题 · 用时 ${formatTime(record.elapsed || 0)}</div></div><div class="history-score ${record.correct / record.total < .8 ? 'fail' : ''}">${Math.round(record.correct / record.total * 100)}%</div><div class="history-actions"><button class="ghost-action" data-action="view-exam" data-record-id="${record.id}">查看试卷</button><button class="icon-action history-delete" data-action="delete-exam" data-record-id="${record.id}" title="删除这套试卷" aria-label="删除这套试卷">×</button></div></div>`).join('') : '<div class="empty-state" style="min-height:180px"><div><h3>暂无考试记录</h3><p>完成一套模拟考试后，成绩和答题详情会保存在这里。</p></div></div>';
    return `<div class="overlay" data-overlay="history"><section class="dialog"><div class="dialog-head"><div><h2 class="dialog-title">历史试卷</h2><p class="dialog-subtitle">共保存 ${state.exams.length} 套模拟考试。</p></div><button class="icon-action" data-action="close-overlay" title="关闭">×</button></div><div class="history-list">${history}</div></section></div>`;
  }

  function render() {
    const mode = state.mode;
    const ids = getModeIds(mode);
    let currentIndex = getModeIndex(mode, ids);
    if (mode === 'memorize' && getMemorizeView() === '100' && ids.length) currentIndex = Math.floor(currentIndex / 100) * 100;
    const question = ids[currentIndex] ? questionMap.get(ids[currentIndex]) : null;
    if (question && mode in state.progress && state.progress[mode] !== question.id) state.progress[mode] = question.id;
    app.innerHTML = appShell(ids, currentIndex, question);
    document.body.classList.toggle('menu-open', ui.menuOpen);
    if (state.mode === 'exam' && state.examDraft) startTimer(); else stopTimer();
  }

  function startTimer() {
    stopTimer();
    timerHandle = window.setInterval(() => {
      const clock = app.querySelector('[data-exam-clock]');
      if (!state.examDraft || state.mode !== 'exam') return stopTimer();
      const remaining = Math.max(0, state.examDraft.durationSec - Math.floor((Date.now() - state.examDraft.startedAt) / 1000));
      if (clock) clock.textContent = formatTime(remaining);
      if (remaining <= 0) submitExam(true);
    }, 1000);
  }

  function stopTimer() {
    if (timerHandle) window.clearInterval(timerHandle);
    timerHandle = null;
  }

  function switchMode(mode) {
    if (!MODES.includes(mode)) return;
    if (mode === 'exam' && state.examDraft && !isExamDraftCompatible(state.examDraft)) state.examDraft = null;
    state.mode = mode;
    ui.menuOpen = false;
    ui.indexQuery = '';
    saveState();
    render();
  }

  function isExamDraftCompatible(draft) {
    if (!draft || !Array.isArray(draft.questionIds) || draft.questionIds.length !== EXAM_TOTAL) return false;
    const questionsInDraft = draft.questionIds.map(id => questionMap.get(id)).filter(Boolean);
    if (questionsInDraft.length !== EXAM_TOTAL) return false;
    return questionsInDraft.slice(0, EXAM_JUDGEMENT).every(question => question.kind === '判断') && questionsInDraft.slice(EXAM_JUDGEMENT).every(question => question.kind !== '判断');
  }

  function shuffleIds(ids) {
    const shuffled = ids.slice();
    for (let index = shuffled.length - 1; index > 0; index -= 1) {
      const swap = Math.floor(Math.random() * (index + 1));
      [shuffled[index], shuffled[swap]] = [shuffled[swap], shuffled[index]];
    }
    return shuffled;
  }

  function startExam() {
    const judgementIds = shuffleIds(questions.filter(question => question.kind === '判断').map(question => question.id)).slice(0, EXAM_JUDGEMENT);
    const singleIds = shuffleIds(questions.filter(question => question.kind !== '判断').map(question => question.id)).slice(0, EXAM_SINGLE);
    state.examDraft = { id: `draft-${Date.now()}`, questionIds: [...judgementIds, ...singleIds], answers: {}, startedAt: Date.now(), durationSec: EXAM_DURATION };
    state.lastExamId = null;
    state.mode = 'exam';
    saveState();
  }

  function submitExam(auto = false) {
    const draft = state.examDraft;
    if (!draft) return;
    const answers = draft.answers || {};
    const correct = draft.questionIds.reduce((count, id) => count + (isCorrect(questionMap.get(id), answers[id]) ? 1 : 0), 0);
    const record = { id: `exam-${Date.now()}`, createdAt: Date.now(), questionIds: draft.questionIds.slice(), answers: { ...answers }, correct, total: draft.questionIds.length, elapsed: Math.min(EXAM_DURATION, Math.floor((Date.now() - draft.startedAt) / 1000)) };
    state.exams.unshift(record);
    state.exams = state.exams.slice(0, 40);
    record.questionIds.forEach(id => {
      if (!isRecordCorrect(record, id)) {
        if (!state.incorrectIds.includes(id)) state.incorrectIds.push(id);
        state.dismissedWrong = state.dismissedWrong.filter(item => item !== id);
      }
    });
    state.lastExamId = record.id;
    state.examDraft = null;
    state.mode = 'exam';
    saveState();
    render();
    if (auto) showToast('时间到，试卷已自动交卷'); else showToast(`交卷完成，得分 ${record.correct}/${record.total}`);
  }

  function viewExam(recordId) {
    if (!state.exams.some(record => record.id === recordId)) return;
    ui.reviewRecordId = recordId;
    ui.reviewWrongOnly = false;
    ui.reviewPosition = 0;
    ui.historyOpen = false;
    ui.menuOpen = false;
    state.mode = 'examReview';
    render();
  }

  function deleteExam(recordId) {
    const exists = state.exams.some(record => record.id === recordId);
    if (!exists) return;
    state.exams = state.exams.filter(record => record.id !== recordId);
    if (state.lastExamId === recordId) state.lastExamId = state.exams[0]?.id || null;
    if (ui.reviewRecordId === recordId) {
      ui.reviewRecordId = null;
      ui.reviewPosition = 0;
      state.mode = 'exam';
    }
    saveState();
    render();
    showToast('历史试卷已删除');
  }

  function selectOption(questionId, option) {
    const question = questionMap.get(questionId);
    if (!question) return;
    if (state.mode === 'exam') {
      if (!state.examDraft) return;
      state.examDraft.answers[questionId] = option;
    } else if (state.mode !== 'memorize' && state.mode !== 'examReview') {
      state.responses[questionId] = option;
      if (isCorrect(question, option)) {
        state.dismissedWrong = state.dismissedWrong.filter(id => id !== questionId);
      } else if (!state.incorrectIds.includes(questionId)) {
        state.incorrectIds.push(questionId);
        state.dismissedWrong = state.dismissedWrong.filter(id => id !== questionId);
      } else {
        state.dismissedWrong = state.dismissedWrong.filter(id => id !== questionId);
      }
    }
    saveState();
    render();
  }

  function toggleFavorite(id) {
    if (!questionMap.has(id)) return;
    if (state.favorites.includes(id)) state.favorites = state.favorites.filter(item => item !== id); else state.favorites.push(id);
    saveState();
    render();
    showToast(state.favorites.includes(id) ? '已加入收藏' : '已取消收藏');
  }

  function dismissWrong(id) {
    if (!state.dismissedWrong.includes(id)) state.dismissedWrong.push(id);
    saveState();
    const ids = getWrongIds();
    if (!ids.length) state.progress.wrong = null;
    render();
    showToast('已从错题中移除');
  }

  function setSelection(mode, ids, selected) {
    ui.selectedIds[mode] = selected ? new Set(ids) : new Set();
    render();
  }

  function invertSelection(mode, ids) {
    const current = getSelectedIds(mode, ids);
    ui.selectedIds[mode] = new Set(ids.filter(id => !current.has(id)));
    render();
  }

  function toggleSelection(id, checked) {
    const mode = state.mode === 'wrong' || state.mode === 'favorites' ? state.mode : null;
    if (!mode) return;
    const selected = ui.selectedIds[mode] || new Set();
    if (checked) selected.add(id); else selected.delete(id);
    ui.selectedIds[mode] = selected;
    render();
  }

  function removeSelected(mode) {
    const ids = getModeIds(mode);
    const selected = getSelectedIds(mode, ids);
    if (!selected.size) return showToast('请先选择题目');
    if (mode === 'wrong') {
      selected.forEach(id => { if (!state.dismissedWrong.includes(id)) state.dismissedWrong.push(id); });
    } else if (mode === 'favorites') {
      state.favorites = state.favorites.filter(id => !selected.has(id));
    }
    ui.selectedIds[mode] = new Set();
    saveState();
    render();
    showToast(`已处理 ${selected.size} 题`);
  }

  function toggleReveal(id, part) {
    const mode = state.mode;
    if (!state.reveals[mode]) state.reveals[mode] = {};
    const current = getReveal(mode, id, part, false);
    setReveal(mode, id, part, !current);
    render();
  }

  function move(delta) {
    const ids = getModeIds(state.mode);
    if (!ids.length) return;
    if (state.mode === 'memorize' && getMemorizeView() === '100') {
      const current = getModeIndex(state.mode, ids);
      setMemorizePage(Math.floor(current / 100) + delta);
      return;
    }
    const current = getModeIndex(state.mode, ids);
    const next = Math.max(0, Math.min(ids.length - 1, current + delta));
    setProgress(state.mode, ids[next]);
    render();
    window.requestAnimationFrame(() => document.querySelector('.question-card')?.scrollIntoView({ behavior: 'smooth', block: 'start' }));
  }

  function jumpTo(id) {
    const ids = getModeIds(state.mode);
    if (!ids.includes(id)) return;
    setProgress(state.mode, id);
    ui.menuOpen = false;
    ui.indexOpen = false;
    render();
    window.requestAnimationFrame(() => document.querySelector('.question-card')?.scrollIntoView({ behavior: 'smooth', block: 'start' }));
  }

  function handleSettingChange(input) {
    const key = input.dataset.setting;
    if (!key) return;
    state.settings[key] = input.checked;
    saveState();
    render();
  }

  function exportSet(setName, format) {
    const ids = getExportIds(setName);
    const rows = ids.map(id => questionMap.get(id)).filter(Boolean);
    if (!rows.length) return showToast('当前没有可导出的题目');
    const filenameBase = setName === 'wrong' ? '高压电工-错题' : setName === 'favorites' ? '高压电工-收藏题目' : '高压电工-错题与收藏';
    let blob;
    let filename;
    if (format === 'csv') {
      const header = ['题号', '题干', '题型', '来源', '选项', '正确答案', '解析'];
      const csvRows = rows.map(question => [question.number, question.titleText, question.type, exportSource(question.id, setName), question.options.map(option => `${option.label}: ${option.text}`).join(' | '), question.answerRaw, stripHtml(question.analysisHtml)]);
      const csv = [header, ...csvRows].map(row => row.map(value => `"${String(value).replace(/"/g, '""')}"`).join(',')).join('\r\n');
      blob = new Blob([`\ufeff${csv}`], { type: 'text/csv;charset=utf-8' });
      filename = `${filenameBase}.csv`;
    } else if (format === 'markdown') {
      blob = new Blob([buildMarkdown(rows, setName)], { type: 'text/markdown;charset=utf-8' });
      filename = `${filenameBase}.md`;
    } else {
      const data = rows.map(question => ({ number: question.number, title: question.titleText, type: question.type, source: exportSource(question.id, setName), options: question.options.map(option => ({ label: option.label, text: option.text })), answer: question.answerRaw, analysis: stripHtml(question.analysisHtml) }));
      blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json;charset=utf-8' });
      filename = `${filenameBase}.json`;
    }
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    window.setTimeout(() => { link.remove(); URL.revokeObjectURL(url); }, 1000);
    showToast(`已导出 ${rows.length} 题`);
  }

  function getExportIds(setName) {
    if (setName === 'wrong') return getWrongIds();
    if (setName === 'favorites') return getFavorites();
    return Array.from(new Set([...getWrongIds(), ...getFavorites()]));
  }

  function exportSource(id, setName) {
    if (setName !== 'combined') return setName === 'wrong' ? '错题' : '收藏';
    const inWrong = getWrongIds().includes(id);
    const inFavorites = getFavorites().includes(id);
    return inWrong && inFavorites ? '错题、收藏' : inWrong ? '错题' : '收藏';
  }

  function escapeMarkdown(value) {
    return String(value || '').replace(/([\\`*_{}\[\]()#+\-.!|>])/g, '\\$1');
  }

  function buildMarkdown(rows, setName) {
    const title = setName === 'combined' ? '错题与收藏' : setName === 'wrong' ? '错题' : '收藏题目';
    const sections = rows.map(question => {
      const options = question.options.map(option => `- **${option.label}.** ${escapeMarkdown(option.text)}`).join('\n');
      return `## ${question.number}. ${escapeMarkdown(question.titleText)}\n\n- 题型：${escapeMarkdown(question.type)}\n- 来源：${exportSource(question.id, setName)}\n- 正确答案：**${escapeMarkdown(question.answerRaw)}**\n\n### 选项\n\n${options}\n\n### 解析\n\n${stripHtml(question.analysisHtml)}\n`;
    }).join('\n');
    return `# 高压电工题目导出：${title}\n\n> 共 ${rows.length} 题，导出时间：${formatDate(Date.now())}\n\n${sections}`;
  }

  function stripHtml(html) {
    const template = document.createElement('template');
    template.innerHTML = html;
    return cleanText(template.content.textContent);
  }

  function showToast(message) {
    const element = app?.querySelector('.toast');
    if (!element) return;
    element.textContent = message;
    element.classList.add('visible');
    if (toastTimer) window.clearTimeout(toastTimer);
    toastTimer = window.setTimeout(() => element.classList.remove('visible'), 2200);
  }

  function hasDismissedSupportPrompt() {
    try { return localStorage.getItem(SUPPORT_PROMPT_KEY) === '1'; } catch (error) { return true; }
  }

  function dismissSupportPrompt() {
    try { localStorage.setItem(SUPPORT_PROMPT_KEY, '1'); } catch (error) { /* Ignore storage failures. */ }
    ui.supportPromptOpen = false;
  }

  function closeOverlays() {
    ui.settingsOpen = false;
    ui.exportOpen = false;
    ui.indexOpen = false;
    ui.historyOpen = false;
    render();
  }

  function formatDate(value) {
    if (!value) return '';
    return new Intl.DateTimeFormat('zh-CN', { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }).format(new Date(value));
  }

  function formatTime(seconds) {
    const safe = Math.max(0, Number(seconds) || 0);
    const hours = Math.floor(safe / 3600);
    const minutes = Math.floor((safe % 3600) / 60);
    const secs = safe % 60;
    return hours ? `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(secs).padStart(2, '0')}` : `${String(minutes).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
  }

  function onClick(event) {
    if (event.target.classList.contains('menu-scrim')) {
      ui.menuOpen = false;
      render();
      return;
    }
    if (event.target.classList.contains('overlay')) {
      if (event.target.dataset.overlay === 'support') dismissSupportPrompt();
      closeOverlays();
      return;
    }
    const actionElement = event.target.closest('[data-action]');
    if (!actionElement || !app.contains(actionElement)) return;
    const action = actionElement.dataset.action;
    if (action === 'toggle-menu') { ui.menuOpen = !ui.menuOpen; render(); return; }
    if (action === 'close-menu') { ui.menuOpen = false; render(); return; }
    if (action === 'switch-mode') { switchMode(actionElement.dataset.mode); return; }
    if (action === 'toggle-settings') { ui.settingsOpen = !ui.settingsOpen; ui.exportOpen = false; ui.indexOpen = false; ui.historyOpen = false; render(); return; }
    if (action === 'toggle-export') { ui.exportOpen = !ui.exportOpen; ui.settingsOpen = false; ui.indexOpen = false; ui.historyOpen = false; render(); return; }
    if (action === 'toggle-index') { ui.indexOpen = !ui.indexOpen; ui.settingsOpen = false; ui.exportOpen = false; ui.historyOpen = false; render(); return; }
    if (action === 'memorize-view') { state.settings.memorizeView = actionElement.dataset.size; saveState(); render(); return; }
    if (action === 'memorize-page') { setMemorizePage(actionElement.dataset.page); return; }
    if (action === 'show-history') { ui.historyOpen = true; ui.settingsOpen = false; ui.exportOpen = false; ui.indexOpen = false; render(); return; }
    if (action === 'close-overlay') { closeOverlays(); return; }
    if (action === 'dismiss-support') { dismissSupportPrompt(); closeOverlays(); return; }
    if (action === 'select-option') { selectOption(actionElement.dataset.questionId, actionElement.dataset.option); return; }
    if (action === 'toggle-favorite') { toggleFavorite(actionElement.dataset.questionId); return; }
    if (action === 'toggle-reveal') { toggleReveal(actionElement.dataset.questionId, actionElement.dataset.part); return; }
    if (action === 'dismiss-wrong') { dismissWrong(actionElement.dataset.questionId); return; }
    if (action === 'invert-selection') { invertSelection(actionElement.dataset.selectionMode, getModeIds(actionElement.dataset.selectionMode)); return; }
    if (action === 'remove-selected') { removeSelected(actionElement.dataset.selectionMode); return; }
    if (action === 'previous') { move(-1); return; }
    if (action === 'next') { move(1); return; }
    if (action === 'jump-to') { jumpTo(actionElement.dataset.questionId); return; }
    if (action === 'start-exam') { startExam(); render(); return; }
    if (action === 'submit-exam') { submitExam(false); return; }
    if (action === 'view-exam') { viewExam(actionElement.dataset.recordId); return; }
    if (action === 'delete-exam') { deleteExam(actionElement.dataset.recordId); return; }
    if (action === 'toggle-review-wrong') { ui.reviewWrongOnly = !ui.reviewWrongOnly; render(); return; }
    if (action === 'export-set') { exportSet(actionElement.dataset.set, actionElement.dataset.format); return; }
  }

  function onChange(event) {
    if (event.target.matches('[data-selection-id]')) {
      toggleSelection(event.target.dataset.selectionId, event.target.checked);
      return;
    }
    if (event.target.matches('[data-select-all]')) {
      const mode = event.target.dataset.selectAll;
      setSelection(mode, getModeIds(mode), event.target.checked);
      return;
    }
    if (event.target.matches('[data-memorize-page]')) {
      setMemorizePage(event.target.value);
      return;
    }
    if (event.target.matches('[data-setting]')) handleSettingChange(event.target);
    if (event.target.matches('[data-setting-select]')) {
      state.settings[event.target.dataset.settingSelect] = Number(event.target.value);
      saveState();
      render();
    }
  }

  function onInput(event) {
    if (event.target.matches('[data-global-search]')) {
      ui.indexQuery = event.target.value;
      return;
    }
    if (!event.target.matches('[data-index-search]')) return;
    ui.indexQuery = event.target.value;
    const list = app.querySelector('.index-list');
    const ids = getModeIds(state.mode);
    if (list) list.innerHTML = renderIndexButtons(ids, ids[getModeIndex(state.mode, ids)]);
  }

  function onKeyDown(event) {
    if (event.key === 'Escape') {
      if (ui.settingsOpen || ui.exportOpen || ui.indexOpen || ui.historyOpen) { ui.settingsOpen = false; ui.exportOpen = false; ui.indexOpen = false; ui.historyOpen = false; render(); }
      else if (ui.menuOpen) { ui.menuOpen = false; document.body.classList.remove('menu-open'); }
      return;
    }
    if (event.target.matches('[data-global-search]') && event.key === 'Enter') {
      event.preventDefault();
      ui.indexOpen = true;
      render();
      window.requestAnimationFrame(() => app.querySelector('.index-dialog [data-index-search]')?.focus());
      return;
    }
    if (event.target.matches('input, select, textarea, button')) return;
    if (event.key === 'ArrowLeft') move(-1);
    if (event.key === 'ArrowRight') move(1);
  }

  function init() {
    if (state.examDraft && !isExamDraftCompatible(state.examDraft)) {
      state.examDraft = null;
      saveState();
    }
    app = document.createElement('div');
    app.id = 'app';
    document.body.insertBefore(app, document.body.firstChild);
    document.body.classList.add('app-ready');
    Array.from(document.body.children).filter(element => element !== app).forEach(element => element.remove());
    app.addEventListener('click', onClick);
    app.addEventListener('change', onChange);
    app.addEventListener('input', onInput);
    document.addEventListener('keydown', onKeyDown);
    ui.supportPromptOpen = !hasDismissedSupportPrompt();
    render();
  }

  init();
})();
