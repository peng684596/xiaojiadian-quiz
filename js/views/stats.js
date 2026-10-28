/**
 * 统计：累计数据、近 14 天答题量、章节正确率、考试历史。
 */

import {
  badge,
  emptyState,
  fmtDate,
  fmtDuration,
  fmtPercent,
  h,
  mount,
  progressBar,
  sectionTitle,
} from '../ui.js';
import { currentStreaks, dailySeries, getProgress, getStats, totalStats } from '../store.js';
import { TYPE_LABEL } from '../quiz.js';

const TYPE_ORDER = ['single', 'multi', 'judge'];

export function render(root, ctx) {
  const today = new Date();
  const totals = totalStats();
  const streaks = currentStreaks();
  const series = dailySeries(14);
  const progress = getProgress();
  const examHistory = (getStats().examHistory || []).slice().reverse();
  const maxDaily = Math.max(1, ...series.map((item) => item.answered));

  const dailyBars = series.map((item) => {
    const height = item.answered === 0 ? 0 : Math.max(6, Math.round((item.answered / maxDaily) * 100));
    return h(
      'div',
      { class: 'chart-col', title: `${item.date}：答题 ${item.answered} 道，答对 ${item.correct} 道` },
      h(
        'div',
        { class: 'chart-col__bar-wrap' },
        item.answered > 0
          ? h('span', { class: 'chart-col__value', text: String(item.answered) })
          : null,
        h('span', {
          class: `chart-col__bar${item.answered > 0 ? '' : ' is-empty'}`,
          style: { height: `${height}%` },
        })
      ),
      h('span', {
        class: 'chart-col__label',
        text: item.date.slice(5).replace('-', '/'),
      })
    );
  });

  const chapterStats = ctx.chapters
    .map((chapter) => {
      const pool = ctx.chapterPracticable.get(chapter.id) || [];
      let attempts = 0;
      let correct = 0;
      pool.forEach((question) => {
        const entry = progress[question.id];
        if (!entry) return;
        attempts += Number(entry.seen) || 0;
        correct += Number(entry.correct) || 0;
      });
      return { chapter, total: pool.length, attempts, correct };
    })
    .filter((item) => item.total > 0);

  const chapterRows = chapterStats.map((item) => {
    const ratio = item.attempts > 0 ? item.correct / item.attempts : 0;
    return h(
      'div',
      { class: 'chapter-acc' },
      h(
        'div',
        { class: 'chapter-acc__head' },
        h('a', { class: 'chapter-acc__name', href: `#/practice?chapter=${item.chapter.id}`, text: item.chapter.name }),
        h('span', {
          class: 'chapter-acc__meta',
          text:
            item.attempts > 0
              ? `${fmtPercent(ratio)}（${item.correct}/${item.attempts}）`
              : '尚未练习',
        })
      ),
      progressBar(ratio, { size: 'sm', tone: ratio >= 0.8 ? 'success' : ratio < 0.5 ? 'danger' : 'primary' })
    );
  });

  const examRows = examHistory.map((record) => {
    const breakdown = record.typeBreakdown || {};
    const breakdownText = TYPE_ORDER.filter((type) => breakdown[type] && breakdown[type].total > 0)
      .map((type) => `${TYPE_LABEL[type]} ${fmtPercent(breakdown[type].correct / breakdown[type].total)}`)
      .join(' · ');
    const accuracy = Number(record.accuracy) || 0;
    return h(
      'li',
      { class: 'exam-history__item' },
      h(
        'div',
        { class: 'exam-history__head' },
        h('span', { class: 'exam-history__title', text: record.chapterLabel || '模拟考试' }),
        badge(fmtPercent(accuracy), accuracy >= 0.8 ? 'success' : accuracy < 0.6 ? 'danger' : 'warn')
      ),
      h(
        'div',
        { class: 'exam-history__meta' },
        h('span', { text: fmtDate(record.at, { withTime: true }) }),
        h('span', { text: `答对 ${record.correct}/${record.count}` }),
        h('span', { text: `用时 ${fmtDuration(record.durationSec, { compact: true })}` })
      ),
      breakdownText ? h('div', { class: 'exam-history__breakdown', text: breakdownText }) : null
    );
  });

  const page = h(
    'div',
    { class: 'page' },
    h('header', { class: 'page-head' }, [
      h('h1', { class: 'page-title', text: '统计' }),
      h('p', {
        class: 'page-subtitle',
        text: `数据只保存在本机浏览器里 · ${ctx.meta.title || '题库'}`,
      }),
    ]),

    h(
      'div',
      { class: 'stat-grid stat-grid--4' },
      h(
        'div',
        { class: 'stat-card' },
        h('div', { class: 'stat-card__label', text: '累计答题' }),
        h('div', { class: 'stat-card__value', text: `${totals.answered}` }),
        h('div', { class: 'stat-card__hint', text: '次' })
      ),
      h(
        'div',
        { class: 'stat-card' },
        h('div', { class: 'stat-card__label', text: '累计正确率' }),
        h('div', { class: 'stat-card__value', text: totals.answered > 0 ? fmtPercent(totals.accuracy) : '—' }),
        h('div', { class: 'stat-card__hint', text: totals.answered > 0 ? `答对 ${totals.correct} 次` : '还没有答题记录' })
      ),
      h(
        'div',
        { class: 'stat-card' },
        h('div', { class: 'stat-card__label', text: '当前连续打卡' }),
        h('div', { class: 'stat-card__value', text: `${streaks.current}` }),
        h('div', { class: 'stat-card__hint', text: '天' })
      ),
      h(
        'div',
        { class: 'stat-card' },
        h('div', { class: 'stat-card__label', text: '最长连续打卡' }),
        h('div', { class: 'stat-card__value', text: `${streaks.longest}` }),
        h('div', { class: 'stat-card__hint', text: `累计 ${streaks.activeDays} 天` })
      )
    ),

    h(
      'section',
      { class: 'card card--pad' },
      sectionTitle('近 14 天答题量', null, `今天 ${today.getMonth() + 1} 月 ${today.getDate()} 日`),
      h('div', { class: 'chart' }, dailyBars)
    ),

    h(
      'section',
      { class: 'card card--pad' },
      sectionTitle('各章节正确率', null, '按章节统计历史答题的正确率。'),
      chapterRows.length > 0
        ? h('div', { class: 'chapter-acc-list' }, chapterRows)
        : emptyState({ title: '题库里还没有章节', hint: '请检查 data/questions.json。' })
    ),

    h(
      'section',
      { class: 'card card--pad' },
      sectionTitle('考试历史', null, '最多保留最近 20 次。'),
      examRows.length > 0
        ? h('ul', { class: 'exam-history' }, examRows)
        : emptyState({
            title: '还没有考试记录',
            hint: '去模拟考试里完整做一套题，这里会记录成绩和题型分布。',
            actionLabel: '去模考',
            onAction: () => ctx.navigate('#/exam'),
          })
    )
  );

  mount(root, page);
  return () => {};
}
