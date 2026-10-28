/**
 * 模拟考试：设置 → 答题（倒计时 / 答题卡 / 标记）→ 交卷 → 成绩与逐题回顾。
 *
 * 未完成的考试保存在 sessionStorage（appq:session）里，刷新或误关页面后回到
 * #/exam 会自动恢复到离开时的位置；超时则按已作答内容自动交卷。
 */

import {
  badge,
  confirmDialog,
  fmtDuration,
  fmtPercent,
  h,
  mount,
  questionMedia,
  progressBar,
  toast,
} from '../ui.js';
import { addExamRecord, getSession, getSettings, getStats, recordAnswer, saveSession } from '../store.js';
import {
  answerDisplay,
  filterPool,
  flagLabel,
  isCorrect,
  prepareOptions,
  sampleExam,
  selectionDisplay,
  typeBreakdown,
  typeLabel,
} from '../quiz.js';

const COUNT_OPTIONS = [
  { value: '20', label: '20 题' },
  { value: '50', label: '50 题' },
  { value: '100', label: '100 题' },
  { value: 'all', label: '全部' },
];
const DURATION_OPTIONS = [30, 60, 90, 120];

function chapterLabel(ctx, chapterIds) {
  if (!chapterIds || chapterIds.length === 0) return '全部章节';
  const names = chapterIds.map((id) => (ctx.chapterMap.has(id) ? ctx.chapterMap.get(id).name : id));
  if (names.length <= 2) return names.join('、');
  return `${names.slice(0, 2).join('、')} 等 ${names.length} 个章节`;
}

function formatClock(seconds) {
  const safe = Math.max(0, Math.ceil(seconds));
  const minutes = Math.floor(safe / 60);
  const rest = safe % 60;
  return `${String(minutes).padStart(2, '0')}:${String(rest).padStart(2, '0')}`;
}

function examQuestionRecords(questions, answers) {
  return questions.map((question) => {
    const selected = answers[question.id] || [];
    return {
      question,
      selected,
      answered: selected.length > 0,
      correct: isCorrect(question, selected),
    };
  });
}

/** 进入考试页：恢复未完成考试 / 显示设置 */
export function render(root, ctx) {
  const stored = getSession().exam;
  if (stored && Array.isArray(stored.questionIds) && stored.questionIds.length > 0 && Number.isFinite(stored.endsAt)) {
    const questions = stored.questionIds.map((id) => ctx.questionMap.get(id)).filter(Boolean);
    if (questions.length === stored.questionIds.length) {
      if (Date.now() >= stored.endsAt) {
        // 离开期间已超时：按已作答内容自动结算
        const runner = renderRunner(root, ctx, stored, { autoSubmit: true });
        return runner;
      }
      return renderRunner(root, ctx, stored, {});
    }
  }
  if (stored) saveSession({ exam: null });
  return renderSetup(root, ctx);
}

/* ------------------------------- 设置页 ------------------------------- */

function renderSetup(root, ctx) {
  const settings = getSettings();
  const state = {
    range: 'all',
    chapters: [],
    count: '20',
    duration: 60,
    shuffle: settings.shuffle,
  };

  const page = h('div', { class: 'page exam-setup' });
  const poolNote = h('p', { class: 'form-note' });
  const chapterField = h('div', { class: 'form-field chapter-picker', hidden: true });

  function currentPool() {
    return filterPool(ctx.questions, {
      chapterIds: state.range === 'chapters' ? state.chapters : null,
      includeDup: settings.includeDup,
    });
  }

  function updateNote() {
    const pool = currentPool();
    const requested = state.count === 'all' ? pool.length : Number(state.count);
    const actual = Math.min(requested, pool.length);
    poolNote.textContent =
      pool.length === 0
        ? '当前范围没有可抽的题目，请更换范围。'
        : `当前范围共 ${pool.length} 题，本次实际出 ${actual} 题，限时 ${state.duration} 分钟。`;
    startButton.disabled = pool.length === 0;
    startButton.classList.toggle('btn--disabled', pool.length === 0);
  }

  function chapterCheckboxes() {
    return ctx.chapters.map((chapter) => {
      const count = filterPool(ctx.questions, {
        chapterIds: [chapter.id],
        includeDup: settings.includeDup,
      }).length;
      return h(
        'label',
        { class: ['check-chip', count === 0 ? 'is-disabled' : ''] },
        h('input', {
          type: 'checkbox',
          value: chapter.id,
          checked: state.chapters.includes(chapter.id),
          disabled: count === 0 || undefined,
          onChange: (event) => {
            if (event.target.checked) {
              if (!state.chapters.includes(chapter.id)) state.chapters.push(chapter.id);
            } else {
              state.chapters = state.chapters.filter((id) => id !== chapter.id);
            }
            updateNote();
          },
        }),
        h('span', { text: chapter.name }),
        h('span', { class: 'check-chip__count', text: `${count}` })
      );
    });
  }

  const rangeRadios = h(
    'div',
    { class: 'radio-row' },
    [
      { value: 'all', label: '全部章节' },
      { value: 'chapters', label: '指定章节' },
    ].map((option) =>
      h(
        'label',
        { class: 'radio-card' },
        h('input', {
          type: 'radio',
          name: 'exam-range',
          value: option.value,
          checked: state.range === option.value,
          onChange: () => {
            state.range = option.value;
            chapterField.hidden = state.range !== 'chapters';
            if (state.range === 'chapters' && state.chapters.length === 0) {
              const first = ctx.chapters.find((chapter) =>
                filterPool(ctx.questions, {
                  chapterIds: [chapter.id],
                  includeDup: settings.includeDup,
                }).length > 0
              );
              if (first) {
                state.chapters.push(first.id);
                chapterField.querySelectorAll('input[type="checkbox"]').forEach((input) => {
                  if (input.value === first.id) input.checked = true;
                });
              }
            }
            updateNote();
          },
        }),
        h('span', { class: 'radio-card__label', text: option.label })
      )
    )
  );

  const countRadios = h(
    'div',
    { class: 'radio-row radio-row--compact' },
    COUNT_OPTIONS.map((option) =>
      h(
        'label',
        { class: 'radio-chip' },
        h('input', {
          type: 'radio',
          name: 'exam-count',
          value: option.value,
          checked: state.count === option.value,
          onChange: () => {
            state.count = option.value;
            updateNote();
          },
        }),
        h('span', { text: option.label })
      )
    )
  );

  const durationRadios = h(
    'div',
    { class: 'radio-row radio-row--compact' },
    DURATION_OPTIONS.map((minutes) =>
      h(
        'label',
        { class: 'radio-chip' },
        h('input', {
          type: 'radio',
          name: 'exam-duration',
          value: String(minutes),
          checked: state.duration === minutes,
          onChange: () => {
            state.duration = minutes;
            updateNote();
          },
        }),
        h('span', { text: `${minutes} 分钟` })
      )
    )
  );

  const shuffleToggle = h(
    'label',
    { class: 'switch-row' },
    h('span', { class: 'switch-row__text' }, [
      h('strong', { text: '选项乱序' }),
      h('span', { class: 'muted small', text: '打乱每道题的选项顺序，避免机械记忆' }),
    ]),
    h('input', {
      type: 'checkbox',
      class: 'switch',
      checked: state.shuffle,
      onChange: (event) => {
        state.shuffle = event.target.checked;
      },
    })
  );

  const startButton = h(
    'button',
    {
      class: 'btn btn--primary btn--lg',
      type: 'button',
      onClick: () => {
        const pool = currentPool();
        if (pool.length === 0) {
          toast('当前范围没有题目，无法开始考试', { tone: 'error' });
          return;
        }
        const requested = state.count === 'all' ? 'all' : Number(state.count);
        const picked = sampleExam(pool, requested, `${ctx.salt}|${Date.now()}`);
        if (picked.length === 0) {
          toast('抽题失败，请稍后再试', { tone: 'error' });
          return;
        }
        const now = Date.now();
        const exam = {
          id: `${now}`,
          startedAt: now,
          endsAt: now + state.duration * 60 * 1000,
          durationMin: state.duration,
          questionIds: picked.map((question) => question.id),
          answers: {},
          marked: {},
          index: 0,
          config: {
            chapterIds: state.range === 'chapters' ? [...state.chapters] : [],
            chapterLabel: chapterLabel(ctx, state.range === 'chapters' ? state.chapters : []),
            count: requested,
            shuffle: state.shuffle,
            seed: `${ctx.salt}|${now}`,
          },
        };
        saveSession({ exam });
        renderRunner(root, ctx, exam, {});
      },
    },
    '开始考试'
  );

  mount(
    page,
    h('header', { class: 'page-head' }, [
      h('h1', { class: 'page-title', text: '模拟考试' }),
      h('p', { class: 'page-subtitle', text: '限时自测。交卷后按题型给出得分，并保留最近 20 次成绩。' }),
    ]),
    h(
      'div',
      { class: 'exam-setup__grid' },
      h(
        'section',
        { class: 'card card--pad form-section' },
        h('h2', { class: 'form-section__title', text: '考试范围' }),
        rangeRadios,
        chapterField
      ),
      h(
        'section',
        { class: 'card card--pad form-section' },
        h('h2', { class: 'form-section__title', text: '题量' }),
        countRadios,
        h('p', { class: 'form-hint', text: '按范围内各题型比例抽取，尽量保证单选、多选、判断都有。' })
      ),
      h(
        'section',
        { class: 'card card--pad form-section' },
        h('h2', { class: 'form-section__title', text: '考试时长' }),
        durationRadios,
        h('p', { class: 'form-hint', text: '倒计时结束会自动交卷，最后 1 分钟时间变红提醒。' })
      ),
      h(
        'section',
        { class: 'card card--pad form-section' },
        h('h2', { class: 'form-section__title', text: '作答设置' }),
        shuffleToggle
      )
    ),
    h(
      'div',
      { class: 'exam-start card card--pad' },
      poolNote,
      startButton
    )
  );

  mount(chapterField, h('div', { class: 'check-grid' }, chapterCheckboxes()));
  updateNote();
  mount(root, page);
  return () => {};
}

/* ------------------------------- 答题页 ------------------------------- */

function renderRunner(root, ctx, storedExam, options = {}) {
  const questions = storedExam.questionIds
    .map((id) => ctx.questionMap.get(id))
    .filter(Boolean);
  const exam = {
    ...storedExam,
    answers: { ...(storedExam.answers || {}) },
    marked: { ...(storedExam.marked || {}) },
    config: { ...(storedExam.config || {}) },
  };
  let index = Math.min(Math.max(0, Number(exam.index) || 0), Math.max(0, questions.length - 1));
  let finished = false;
  let timerId = null;

  const preparedCache = new Map();
  const preparedFor = (question) => {
    if (!preparedCache.has(question.id)) {
      preparedCache.set(
        question.id,
        prepareOptions(question, `${ctx.salt}|exam|${exam.id}`, exam.config.shuffle !== false)
      );
    }
    return preparedCache.get(question.id);
  };

  const page = h('div', { class: 'page exam-page' });
  const topbar = h('div', { class: 'exam-topbar card' });
  const mainArea = h('div', { class: 'exam-main' });
  const sheetArea = h('aside', { class: 'exam-sheet card' });
  const layout = h('div', { class: 'exam-layout' }, mainArea, sheetArea);

  function persist() {
    exam.index = index;
    saveSession({ exam });
  }

  function answeredList() {
    return questions.filter((question) => (exam.answers[question.id] || []).length > 0);
  }

  function markedList() {
    return questions.filter((question) => exam.marked[question.id]);
  }

  function remainingSeconds() {
    return Math.max(0, Math.ceil((exam.endsAt - Date.now()) / 1000));
  }

  function updateTimer() {
    const timerEl = topbar.querySelector('[data-role="timer"]');
    if (!timerEl) return;
    const seconds = remainingSeconds();
    timerEl.textContent = formatClock(seconds);
    timerEl.classList.toggle('is-urgent', seconds <= 60);
    const wrap = topbar.querySelector('.exam-timer');
    if (wrap) wrap.classList.toggle('is-urgent', seconds <= 60);
  }

  function updateTopbar() {
    const answered = answeredList().length;
    const marked = markedList().length;
    mount(
      topbar,
      h(
        'div',
        { class: 'exam-topbar__left' },
        h('span', { class: 'exam-topbar__label', text: '剩余时间' }),
        h('div', { class: 'exam-timer' }, h('strong', { 'data-role': 'timer', text: formatClock(remainingSeconds()) }))
      ),
      h(
        'div',
        { class: 'exam-topbar__mid' },
        h('span', { text: `已答 ${answered} / ${questions.length}` }),
        h('span', { class: 'exam-topbar__dot', 'aria-hidden': 'true', text: '·' }),
        h('span', { text: `标记 ${marked}` })
      ),
      h(
        'div',
        { class: 'exam-topbar__actions' },
        h('button', { class: 'btn btn--sm btn--primary', type: 'button', onClick: requestSubmit }, '交卷')
      )
    );
    updateTimer();
  }

  function optionState(option, selected) {
    return selected.includes(option.key) ? 'is-selected' : '';
  }

  function optionButton(option, question, selected) {
    return h(
      'button',
      {
        class: ['option', optionState(option, selected)],
        type: 'button',
        'aria-pressed': selected.includes(option.key) ? 'true' : 'false',
        'aria-label': question.type === 'judge' ? option.text : `${option.display}. ${option.text}`,
        onClick: () => chooseOption(question, option.key),
      },
      question.type === 'judge' ? null : h('span', { class: 'option__key', 'aria-hidden': 'true', text: option.display }),
      h('span', { class: 'option__text', text: option.text })
    );
  }

  function chooseOption(question, key) {
    if (finished) return;
    const current = exam.answers[question.id] || [];
    if (question.type === 'multi') {
      const next = current.includes(key) ? current.filter((item) => item !== key) : [...current, key];
      exam.answers[question.id] = next;
    } else {
      exam.answers[question.id] = [key];
    }
    persist();
    renderQuestion({ keepScroll: true });
    updateTopbar();
    renderSheet();
  }

  function toggleMark(question) {
    if (finished) return;
    if (exam.marked[question.id]) delete exam.marked[question.id];
    else exam.marked[question.id] = true;
    persist();
    renderQuestion({ keepScroll: true });
    updateTopbar();
    renderSheet();
  }

  function goTo(nextIndex) {
    if (finished) return;
    index = Math.max(0, Math.min(questions.length - 1, nextIndex));
    persist();
    renderQuestion();
    renderSheet();
  }

  function renderQuestion(options = {}) {
    const question = questions[index];
    if (!question) return;
    const prepared = preparedFor(question);
    const selected = exam.answers[question.id] || [];
    const marked = !!exam.marked[question.id];
    const chapterName = ctx.chapterMap.has(question.chapter) ? ctx.chapterMap.get(question.chapter).name : '';

    const card = h(
      'article',
      { class: 'question-card card exam-question' },
      h(
        'div',
        { class: 'question-card__head' },
        h(
          'div',
          { class: 'question-card__tags' },
          badge(`第 ${index + 1} 题`, 'primary'),
          badge(typeLabel(question.type), question.type === 'multi' ? 'warn' : 'neutral'),
          chapterName ? badge(chapterName) : null,
          question.flag ? badge(flagLabel(question.flag), 'warn') : null,
          marked ? badge('已标记', 'warn') : null
        ),
        h(
          'button',
          {
            class: ['mark-btn', marked ? 'is-active' : ''],
            type: 'button',
            'aria-pressed': marked ? 'true' : 'false',
            onClick: () => toggleMark(question),
          },
          marked ? '★ 已标记' : '☆ 标记'
        )
      ),
      h('h2', { class: 'question-stem', text: question.stem }),
      questionMedia(question.images),
      h(
        'div',
        { class: 'options', role: 'group', 'aria-label': question.type === 'multi' ? '多选题选项' : '选项' },
        prepared.map((option) => optionButton(option, question, selected))
      ),
      h(
        'div',
        { class: 'practice-nav' },
        h(
          'button',
          { class: 'btn', type: 'button', disabled: index === 0 || undefined, onClick: () => goTo(index - 1) },
          '← 上一题'
        ),
        h(
          'div',
          { class: 'practice-nav__right' },
          h('span', { class: 'practice-nav__hint', text: `第 ${index + 1} / ${questions.length} 题` }),
          h(
            'button',
            {
              class: 'btn btn--primary',
              type: 'button',
              disabled: index >= questions.length - 1 || undefined,
              onClick: () => goTo(index + 1),
            },
            '下一题 →'
          )
        )
      )
    );
    mount(mainArea, card);
    if (!options.keepScroll) {
      try {
        window.scrollTo({ top: 0, behavior: 'auto' });
      } catch (err) {
        window.scrollTo(0, 0);
      }
    }
  }

  function renderSheet() {
    const answered = answeredList().length;
    mount(
      sheetArea,
      h('div', { class: 'exam-sheet__head' }, [
        h('h2', { class: 'exam-sheet__title', text: '答题卡' }),
        h('span', { class: 'muted small', text: `${answered} / ${questions.length} 已答` }),
      ]),
      h(
        'div',
        { class: 'sheet-grid', role: 'group', 'aria-label': '答题卡，点击题号跳转' },
        questions.map((question, questionIndex) => {
          const isAnswered = (exam.answers[question.id] || []).length > 0;
          const isMarked = !!exam.marked[question.id];
          return h(
            'button',
            {
              class: [
                'sheet-cell',
                isAnswered ? 'is-answered' : '',
                isMarked ? 'is-marked' : '',
                questionIndex === index ? 'is-current' : '',
              ],
              type: 'button',
              'aria-label': `第 ${questionIndex + 1} 题，${isAnswered ? '已答' : '未答'}${isMarked ? '，已标记' : ''}`,
              onClick: () => goTo(questionIndex),
            },
            String(questionIndex + 1)
          );
        })
      ),
      h(
        'div',
        { class: 'sheet-legend' },
        h('span', { class: 'sheet-legend__item' }, [h('i', { class: 'dot-swatch dot-swatch--answered' }), '已答']),
        h('span', { class: 'sheet-legend__item' }, [h('i', { class: 'dot-swatch dot-swatch--unanswered' }), '未答']),
        h('span', { class: 'sheet-legend__item' }, [h('i', { class: 'dot-swatch dot-swatch--marked' }), '标记'])
      ),
      h(
        'div',
        { class: 'exam-sheet__actions' },
        h('button', { class: 'btn btn--primary', type: 'button', onClick: requestSubmit }, '交卷')
      )
    );
  }

  function stopTimer() {
    if (timerId) {
      window.clearInterval(timerId);
      timerId = null;
    }
  }

  function requestSubmit() {
    if (finished) return;
    const answered = answeredList().length;
    const unanswered = questions.length - answered;
    const marked = markedList().length;
    confirmDialog('确认要交卷吗？交卷后不能修改答案。', {
      title: '交卷确认',
      confirmText: '确认交卷',
      hint: `已答 ${answered} 题，未答 ${unanswered} 题${marked > 0 ? `，标记 ${marked} 题` : ''}。`,
    }).then((confirmed) => {
      if (confirmed) finalize({ auto: false });
    });
  }

  function finalize({ auto = false } = {}) {
    if (finished) return;
    finished = true;
    stopTimer();
    const now = Date.now();
    const elapsedSec = Math.min(
      exam.durationMin * 60,
      Math.max(0, Math.round((now - exam.startedAt) / 1000))
    );
    const records = examQuestionRecords(questions, exam.answers);
    const correctCount = records.filter((record) => record.correct).length;
    const answeredCount = records.filter((record) => record.answered).length;

    // 只有真正作答的题计入累计统计与错题本
    for (const record of records) {
      if (record.answered) recordAnswer(record.question.id, record.correct);
    }

    const breakdown = typeBreakdown(records);
    addExamRecord({
      at: new Date().toISOString(),
      chapterLabel: exam.config.chapterLabel || chapterLabel(ctx, exam.config.chapterIds || []),
      count: records.length,
      correct: correctCount,
      answered: answeredCount,
      accuracy: records.length > 0 ? correctCount / records.length : 0,
      durationSec: elapsedSec,
      typeBreakdown: breakdown,
    });

    saveSession({ exam: null });
    toast(auto ? '考试时间到，已自动交卷' : '已交卷', { tone: 'info', duration: 2200 });
    renderResult(root, ctx, {
      records,
      correctCount,
      answeredCount,
      elapsedSec,
      auto,
      exam,
    });
  }

  mount(page, topbar, layout);
  mount(root, page);
  renderQuestion();
  renderSheet();
  updateTopbar();

  timerId = window.setInterval(() => {
    updateTimer();
    if (remainingSeconds() <= 0) {
      stopTimer();
      if (!finished) finalize({ auto: true });
    }
  }, 500);

  if (options.autoSubmit) {
    // 进入时已超时：直接结算
    window.setTimeout(() => {
      if (!finished) finalize({ auto: true });
    }, 60);
  }

  return () => {
    stopTimer();
  };
}

/* ------------------------------- 成绩页 ------------------------------- */

function renderResult(root, ctx, result) {
  const { records, correctCount, answeredCount, elapsedSec, auto } = result;
  const total = records.length;
  const accuracy = total > 0 ? correctCount / total : 0;
  const breakdown = typeBreakdown(records);

  const scoreCard = h(
    'section',
    { class: 'result-hero card' },
    h('span', { class: 'result-hero__kicker', text: auto ? '时间到 · 自动交卷' : '考试完成' }),
    h(
      'div',
      { class: 'result-hero__score' },
      h('strong', { text: String(correctCount) }),
      h('span', { text: ` / ${total} 分` })
    ),
    h('p', { class: 'result-hero__accuracy', text: `正确率 ${fmtPercent(accuracy)}` }),
    h(
      'div',
      { class: 'result-hero__stats' },
      h('span', null, `已答 ${answeredCount} 题`),
      h('span', null, `用时 ${fmtDuration(elapsedSec)}`),
      h(
        'span',
        null,
        `成绩已记录 · 历史共 ${getStats().examHistory.length} 次`
      )
    )
  );

  const typeRows = Object.keys(breakdown)
    .filter((type) => breakdown[type].total > 0)
    .map((type) => {
      const item = breakdown[type];
      const ratio = item.total > 0 ? item.correct / item.total : 0;
      return h(
        'div',
        { class: 'breakdown-row' },
        h(
          'div',
          { class: 'breakdown-row__head' },
          h('span', { text: typeLabel(type) }),
          h('span', { text: `${item.correct} / ${item.total}` })
        ),
        progressBar(ratio, {
          size: 'sm',
          tone: ratio >= 0.8 ? 'success' : ratio >= 0.6 ? 'primary' : 'danger',
          label: `${typeLabel(type)}正确率`,
        })
      );
    });

  const typeSection = h(
    'section',
    { class: 'stack' },
    h('h2', { class: 'section-title', text: '按题型拆分' }),
    h('div', { class: 'card card--pad breakdown-card' }, typeRows)
  );

  const reviewSection = h(
    'section',
    { class: 'stack' },
    h('h2', { class: 'section-title', text: '逐题回顾' }),
    h(
      'div',
      { class: 'review-list' },
      records.map((record, recordIndex) => {
        const prepared = preparedOptionsCache(ctx, record.question, result.exam);
        const stateClass = record.correct ? 'is-correct' : record.answered ? 'is-wrong' : 'is-unanswered';
        return h(
          'article',
          { class: ['review-item card', stateClass] },
          h(
            'div',
            { class: 'review-item__head' },
            badge(`第 ${recordIndex + 1} 题`),
            badge(typeLabel(record.question.type)),
            record.question.flag ? badge(flagLabel(record.question.flag), 'warn') : null,
            h('span', { class: `review-verdict ${stateClass}` }, record.correct ? '✓ 正确' : record.answered ? '✗ 错误' : '— 未作答')
          ),
          h('p', { class: 'review-item__stem', text: record.question.stem }),
          h(
            'p',
            { class: 'review-item__answer' },
            h('span', { class: 'is-wrong', text: `你的答案：${selectionDisplay(prepared, record.selected, record.question)}` }),
            h('span', { class: 'is-correct', text: `正确答案：${answerDisplay(prepared, record.question)}` })
          ),
          record.question.explain
            ? h('p', { class: 'review-item__explain', text: `解析：${record.question.explain}` })
            : null
        );
      })
    )
  );

  mount(
    root,
    h(
      'div',
      { class: 'page result-page' },
      h('header', { class: 'page-head' }, [
        h('h1', { class: 'page-title', text: '考试成绩' }),
        h(
          'p',
          { class: 'page-subtitle', text: '答案与解析都在下面，错题已自动收进错题本。' }
        ),
      ]),
      scoreCard,
      typeSection,
      reviewSection,
      h(
        'div',
        { class: 'summary-actions' },
        h(
          'button',
          {
            class: 'btn btn--primary',
            type: 'button',
            onClick: () => ctx.navigate('#/exam'),
          },
          '再考一次'
        ),
        h('a', { class: 'btn', href: '#/wrong' }, '去错题本'),
        h('a', { class: 'btn btn--ghost', href: '#/' }, '回到首页')
      )
    )
  );
  window.scrollTo({ top: 0, behavior: 'auto' });
}

const resultPrepared = new WeakMap();
function preparedOptionsCache(ctx, question, exam) {
  if (!resultPrepared.has(question)) {
    resultPrepared.set(
      question,
      prepareOptions(question, `${ctx.salt}|exam|${exam.id}`, exam.config.shuffle !== false)
    );
  }
  return resultPrepared.get(question);
}
