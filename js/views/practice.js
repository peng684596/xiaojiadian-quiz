/**
 * 章节练习 / 错题重练 / 收藏重练 / 今日复习。
 *
 * 路由 query：
 *   chapter=<id>     指定章节
 *   scope=all|wrong|favorite|review
 *   ids=q0001,q0002  指定题目（练习小结里的“重练错题”）
 *   shuffle=1        题目顺序乱序
 */

import {
  badge,
  button,
  emptyState,
  fmtDuration,
  fmtPercent,
  h,
  mount,
  progressBar,
  questionMedia,
  toast,
} from '../ui.js';
import {
  isFavorite,
  getFavorites,
  getProgress,
  getWrong,
  recordAnswer,
  toggleFavorite,
} from '../store.js';
import { answerDisplay, buildPracticeQueue, flagLabel, isCorrect, prepareOptions, selectionDisplay, typeLabel } from '../quiz.js';
import { todayStr } from '../srs.js';

const BACK_HREF = {
  wrong: '#/wrong',
  favorite: '#/favorites',
  review: '#/review',
  ids: '#/wrong',
};

function resolveQueue(ctx) {
  const query = ctx.route.query;
  const scopeParam = typeof query.scope === 'string' ? query.scope : 'all';
  const scope = ['all', 'wrong', 'favorite', 'review'].includes(scopeParam) ? scopeParam : 'all';
  const chapterId = typeof query.chapter === 'string' ? query.chapter : null;
  const settings = ctx.settings;

  if (typeof query.ids === 'string' && query.ids.trim()) {
    const ids = query.ids
      .split(',')
      .map((id) => id.trim())
      .filter(Boolean);
    const queue = ids.map((id) => ctx.questionMap.get(id)).filter(Boolean);
    // 收藏页的「单独重练」也走 ids，通过 from=favorite 区分来源与返回目标
    const fromFavorite = query.from === 'favorite';
    return {
      queue,
      scope: 'ids',
      chapterId: null,
      sourceLabel: fromFavorite ? '收藏重练' : '错题重练',
      back: fromFavorite ? '#/favorites' : '#/wrong',
    };
  }

  const queue = buildPracticeQueue({
    questions: ctx.questions,
    chapterId,
    scope,
    wrong: getWrong(),
    favorites: getFavorites(),
    progress: getProgress(),
    includeDup: settings.includeDup,
    shuffle: query.shuffle === '1',
    salt: ctx.salt,
    today: todayStr(),
  });

  let sourceLabel = '全部题目';
  if (scope === 'wrong') sourceLabel = '错题重练';
  else if (scope === 'favorite') sourceLabel = '收藏重练';
  else if (scope === 'review') sourceLabel = '今日复习';
  else if (chapterId && ctx.chapterMap.has(chapterId)) sourceLabel = ctx.chapterMap.get(chapterId).name;

  return { queue, scope, chapterId, sourceLabel, back: BACK_HREF[scope] || '#/chapters' };
}

export function render(root, ctx) {
  const resolved = resolveQueue(ctx);
  const { queue, scope, sourceLabel, back } = resolved;

  if (queue.length === 0) {
    const messages = {
      wrong: { title: '错题本是空的', hint: '练习中答错的题会自动收进来，先把章节过一遍吧。' },
      favorite: { title: '还没有收藏题目', hint: '答题时点右上角的星标，就能把题目收进这里。' },
      review: { title: '今天没有待复习的题', hint: '记忆曲线会在该复习的时候提醒你，先去练几道新题吧。' },
      all: { title: '这个范围里暂无题目', hint: '题库可能还没准备好，或该章节暂时没有内容。' },
    };
    const info = messages[scope] || messages.all;
    mount(
      root,
      h(
        'div',
        { class: 'page' },
        h('header', { class: 'page-head' }, [
          h('a', { class: 'btn btn--ghost btn--sm', href: back }, '← 返回'),
          h('h1', { class: 'page-title', text: sourceLabel }),
        ]),
        h('div', { class: 'card card--pad' }, emptyState({ ...info, actionLabel: '去章节练习', onAction: () => ctx.navigate('#/chapters') }))
      )
    );
    return () => {};
  }

  const state = {
    index: 0,
    answers: queue.map(() => ({ selected: [], graded: false, correct: false, streak: 0 })),
    startedAt: Date.now(),
    autoNextTimer: null,
    prepared: new Map(),
    finished: false,
  };

  const preparedFor = (question) => {
    if (!state.prepared.has(question.id)) {
      state.prepared.set(question.id, prepareOptions(question, ctx.salt, ctx.settings.shuffle));
    }
    return state.prepared.get(question.id);
  };

  const page = h('div', { class: 'page practice-page' });
  const topbar = h('div', { class: 'practice-topbar' });
  const cardHost = h('div', { class: 'practice-card-host' });

  function clearAutoNext() {
    if (state.autoNextTimer) {
      window.clearTimeout(state.autoNextTimer);
      state.autoNextTimer = null;
    }
  }

  function answeredCount() {
    return state.answers.filter((answer) => answer.graded).length;
  }

  function correctCount() {
    return state.answers.filter((answer) => answer.graded && answer.correct).length;
  }

  function updateTopbar() {
    const question = queue[state.index];
    const chapterName = question && ctx.chapterMap.has(question.chapter) ? ctx.chapterMap.get(question.chapter).name : '';
    mount(
      topbar,
      h(
        'div',
        { class: 'practice-topbar__row' },
        h(
          'a',
          { class: 'btn btn--ghost btn--sm practice-topbar__back', href: back },
          '← 退出'
        ),
        h(
          'div',
          { class: 'practice-topbar__info' },
          h('strong', { class: 'practice-topbar__title', text: sourceLabel }),
          h('span', {
            class: 'practice-topbar__meta',
            text: `第 ${state.index + 1} / ${queue.length} 题 · 已答 ${answeredCount()}`,
          })
        ),
        chapterName ? badge(chapterName) : null
      ),
      progressBar((state.index + 1) / queue.length, { size: 'sm', label: '练习进度' })
    );
  }

  function goTo(index) {
    if (index < 0 || index >= queue.length) return;
    clearAutoNext();
    state.index = index;
    renderQuestion();
  }

  function finish() {
    clearAutoNext();
    state.finished = true;
    renderSummary();
  }

  function goNext() {
    clearAutoNext();
    if (state.index >= queue.length - 1) {
      finish();
      return;
    }
    state.index += 1;
    renderQuestion();
  }

  function scheduleAutoNext() {
    if (!ctx.settings.autoNext) return;
    clearAutoNext();
    state.autoNextTimer = window.setTimeout(() => {
      state.autoNextTimer = null;
      goNext();
    }, 1200);
  }

  function grade() {
    const answer = state.answers[state.index];
    if (answer.graded) return;
    const question = queue[state.index];
    answer.graded = true;
    answer.correct = isCorrect(question, answer.selected);
    const result = recordAnswer(question.id, answer.correct);
    answer.streak = result.streak;
    scheduleAutoNext();
    renderQuestion({ focusNext: true });
  }

  function toggleMultiOption(key) {
    const answer = state.answers[state.index];
    if (answer.graded) return;
    const exists = answer.selected.includes(key);
    answer.selected = exists ? answer.selected.filter((item) => item !== key) : [...answer.selected, key];
    updateOptionsOnly();
  }

  function toggleFavoriteFor(question) {
    const isFav = toggleFavorite(question.id);
    toast(isFav ? '已加入收藏' : '已取消收藏', { tone: isFav ? 'success' : 'info', duration: 1400 });
    renderQuestion({ keepScroll: true });
  }

  function optionState(option, answer, question) {
    const correctKeys = new Set(question.answer.map(String));
    const selected = answer.selected.includes(option.key);
    if (!answer.graded) return selected ? 'is-selected' : '';
    if (correctKeys.has(option.key)) {
      return selected ? 'is-correct' : 'is-missed';
    }
    return selected ? 'is-wrong' : '';
  }

  function optionButton(option, answer, question) {
    const stateClass = optionState(option, answer, question);
    const correctKeys = new Set(question.answer.map(String));
    const selected = answer.selected.includes(option.key);
    let mark = '';
    if (answer.graded) {
      if (correctKeys.has(option.key)) mark = '✓';
      else if (selected) mark = '✗';
    }
    return h(
      'button',
      {
        class: ['option', stateClass],
        type: 'button',
        'aria-pressed': selected ? 'true' : 'false',
        'aria-label':
          question.type === 'judge'
            ? option.text
            : `${option.display}. ${option.text}`,
        disabled: answer.graded || undefined,
        onClick: () => {
          if (question.type === 'multi') {
            toggleMultiOption(option.key);
          } else {
            const current = state.answers[state.index];
            if (current.graded) return;
            current.selected = [option.key];
            grade();
          }
        },
      },
      question.type === 'judge' ? null : h('span', { class: 'option__key', 'aria-hidden': 'true', text: option.display }),
      h('span', { class: 'option__text', text: option.text }),
      mark ? h('span', { class: 'option__mark', 'aria-hidden': 'true', text: mark }) : null
    );
  }

  function updateOptionsOnly() {
    const answer = state.answers[state.index];
    const question = queue[state.index];
    const prepared = preparedFor(question);
    const optionEls = cardHost.querySelectorAll('.option');
    optionEls.forEach((optionEl, index) => {
      const option = prepared[index];
      if (!option) return;
      optionEl.className = ['option', optionState(option, answer, question)].filter(Boolean).join(' ');
      optionEl.setAttribute('aria-pressed', answer.selected.includes(option.key) ? 'true' : 'false');
    });
    const submitBtn = cardHost.querySelector('[data-role="submit"]');
    if (submitBtn) submitBtn.disabled = answer.selected.length === 0;
  }

  function feedbackNode(answer, question, prepared) {
    if (!answer.graded) return null;
    const correctText = answerDisplay(prepared, question);
    const yours = selectionDisplay(prepared, answer.selected, question);
    const nodes = [
      h(
        'div',
        { class: `feedback feedback--${answer.correct ? 'correct' : 'wrong'}`, role: 'status' },
        h('span', { class: 'feedback__mark', 'aria-hidden': 'true', text: answer.correct ? '✓' : '✗' }),
        h('strong', { class: 'feedback__title', text: answer.correct ? '回答正确' : '回答错误' }),
        h('span', { class: 'feedback__answer', text: `正确答案：${correctText}` }),
        answer.correct ? null : h('span', { class: 'feedback__yours', text: `你的答案：${yours}` })
      ),
    ];
    if (scope === 'wrong' && answer.correct) {
      if (answer.streak >= 2) {
        nodes.push(
          h(
            'p',
            { class: 'practice-hint practice-hint--success' },
            `已连续答对 ${answer.streak} 次，可以在错题本里把这题标记为「已掌握」。`
          )
        );
      } else if (answer.streak === 1) {
        nodes.push(
          h('p', { class: 'practice-hint', text: '已连续答对 1 次，再答对 1 次即可标记为已掌握。' })
        );
      }
    }
    if (question.explain) {
      nodes.push(
        h(
          'div',
          { class: 'explain' },
          h('span', { class: 'explain__label', text: '解析' }),
          h('p', { class: 'explain__text', text: question.explain })
        )
      );
    }
    return nodes;
  }

  function renderQuestion(options = {}) {
    const question = queue[state.index];
    const answer = state.answers[state.index];
    const prepared = preparedFor(question);
    const fav = isFavorite(question.id);
    const chapterName = ctx.chapterMap.has(question.chapter) ? ctx.chapterMap.get(question.chapter).name : '';

    const head = h(
      'div',
      { class: 'question-card__head' },
      h(
        'div',
        { class: 'question-card__tags' },
        badge(typeLabel(question.type), question.type === 'single' ? 'primary' : question.type === 'multi' ? 'warn' : 'success'),
        chapterName ? badge(chapterName) : null,
        question.flag ? badge(flagLabel(question.flag), 'warn') : null,
        h('span', { class: 'question-card__no', text: `No.${question.no}` })
      ),
      h(
        'button',
        {
          class: ['star-btn', fav ? 'is-active' : ''],
          type: 'button',
          'aria-pressed': fav ? 'true' : 'false',
          'aria-label': fav ? '取消收藏' : '收藏本题',
          title: fav ? '取消收藏' : '收藏本题',
          onClick: () => toggleFavoriteFor(question),
        },
        fav ? '★' : '☆'
      )
    );

    const stem = h('h2', { class: 'question-stem', tabindex: '-1', text: question.stem });
    const media = questionMedia(question.images);

    const optionsWrap = h(
      'div',
      {
        class: 'options',
        role: 'group',
        'aria-label': question.type === 'multi' ? '多选题选项，可选择多个' : '选项',
      },
      prepared.map((option) => optionButton(option, answer, question))
    );

    const submitRow =
      question.type === 'multi' && !answer.graded
        ? h(
            'div',
            { class: 'practice-submit-row' },
            h(
              'p',
              { class: 'practice-hint', text: '多选题需要全部选对才得分，选完后点下方按钮提交。' },
            ),
            h(
              'button',
              {
                class: 'btn btn--primary',
                type: 'button',
                'data-role': 'submit',
                disabled: answer.selected.length === 0 || undefined,
                onClick: grade,
              },
              '提交答案'
            )
          )
        : null;

    const feedback = feedbackNode(answer, question, prepared);

    const nav = h(
      'div',
      { class: 'practice-nav' },
      h(
        'button',
        {
          class: 'btn',
          type: 'button',
          disabled: state.index === 0 || undefined,
          onClick: () => goTo(state.index - 1),
        },
        '← 上一个'
      ),
      h(
        'div',
        { class: 'practice-nav__right' },
        !answer.graded
          ? h('span', { class: 'practice-nav__hint', text: question.type === 'multi' ? '选择后提交' : '选择后自动判定' })
          : null,
        answer.graded
          ? h(
              'button',
              {
                class: 'btn btn--primary',
                type: 'button',
                onClick: goNext,
              },
              state.index >= queue.length - 1 ? '查看小结' : '下一题 →'
            )
          : h(
              'button',
              { class: 'btn btn--primary practice-next-placeholder', type: 'button', disabled: true },
              state.index >= queue.length - 1 ? '查看小结' : '下一题 →'
            )
      )
    );

    const card = h(
      'article',
      { class: 'question-card card' },
      head,
      stem,
      media,
      optionsWrap,
      submitRow,
      feedback,
      h('div', { class: 'question-card__footer' }, nav)
    );

    mount(cardHost, card);
    updateTopbar();

    if (options.focusNext) {
      const nextButton = card.querySelector('.practice-nav__right .btn:not(.practice-next-placeholder)');
      if (nextButton) nextButton.focus({ preventScroll: true });
    }
  }

  function renderSummary() {
    clearAutoNext();
    const total = queue.length;
    const correct = correctCount();
    const answered = answeredCount();
    const accuracy = total > 0 ? correct / total : 0;
    const elapsed = Math.round((Date.now() - state.startedAt) / 1000);
    const wrongQuestions = queue.filter((question) => {
      const answer = state.answers[queue.indexOf(question)];
      return answer.graded && !answer.correct;
    });

    const summary = h(
      'div',
      { class: 'page practice-summary' },
      h(
        'div',
        { class: 'summary-hero card' },
        h('span', { class: 'summary-hero__kicker', text: '练习小结' }),
        h('div', { class: 'summary-hero__score' }, [
          h('strong', { text: String(correct) }),
          h('span', { text: ` / ${total}` }),
        ]),
        h('p', { class: 'summary-hero__accuracy', text: `正确率 ${fmtPercent(accuracy)}` }),
        h(
          'div',
          { class: 'summary-hero__stats' },
          h('span', null, `已答 ${answered} 题`),
          h('span', null, `用时 ${fmtDuration(elapsed)}`),
          h('span', null, `错题 ${total - correct} 道`)
        )
      )
    );

    if (wrongQuestions.length > 0) {
      summary.appendChild(
        h(
          'section',
          { class: 'stack' },
          h('h2', { class: 'section-title', text: '这次答错的题' }),
          h(
            'div',
            { class: 'review-list' },
            wrongQuestions.map((question) => {
              const prepared = preparedFor(question);
              const answer = state.answers[queue.indexOf(question)];
              return h(
                'div',
                { class: 'review-item card' },
                h(
                  'div',
                  { class: 'review-item__head' },
                  badge(typeLabel(question.type)),
                  h('span', { class: 'muted small', text: ctx.chapterMap.has(question.chapter) ? ctx.chapterMap.get(question.chapter).name : '' })
                ),
                h('p', { class: 'review-item__stem', text: question.stem }),
                h(
                  'p',
                  { class: 'review-item__answer' },
                  h('span', { class: 'is-wrong', text: `你的答案：${selectionDisplay(prepared, answer.selected, question)}` }),
                  h('span', { class: 'is-correct', text: `正确答案：${answerDisplay(prepared, question)}` })
                )
              );
            })
          )
        )
      );
    }

    const actions = h(
      'div',
      { class: 'summary-actions' },
      total - correct > 0
        ? button('重练错题', {
            variant: 'primary',
            onClick: () => {
              const ids = wrongQuestions.map((question) => question.id).join(',');
              ctx.navigate(`#/practice?ids=${encodeURIComponent(ids)}`);
            },
          })
        : null,
      button('再来一组', {
        onClick: () => ctx.reload(),
      }),
      h('a', { class: 'btn btn--ghost', href: back }, '返回')
    );
    summary.appendChild(actions);

    mount(root, h('div', { class: 'page practice-summary-page' }, summary));
    window.scrollTo({ top: 0, behavior: 'auto' });
  }

  mount(page, topbar, cardHost);
  mount(root, page);
  renderQuestion();

  return () => {
    clearAutoNext();
  };
}
