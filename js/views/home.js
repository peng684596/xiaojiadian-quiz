/**
 * 首页：四个数字卡 + 快捷入口 + 章节进度 + 连续打卡。
 */

import {
  h,
  mount,
  fmtPercent,
  progressBar,
  statCard,
  sectionTitle,
  badge,
} from '../ui.js';
import { currentStreaks, getProgress, getStats, getWrong, totalStats } from '../store.js';
import { dueCount, todayStr } from '../srs.js';

function chapterRow(chapter, pool, progress) {
  const list = pool.filter((question) => question.chapter === chapter.id);
  const total = list.length;
  const seen = list.filter((question) => progress[question.id] && progress[question.id].seen > 0).length;
  const attempts = list.reduce((sum, question) => sum + (Number(progress[question.id] && progress[question.id].seen) || 0), 0);
  const correct = list.reduce((sum, question) => sum + (Number(progress[question.id] && progress[question.id].correct) || 0), 0);
  const ratio = total > 0 ? seen / total : 0;
  const accuracy = attempts > 0 ? fmtPercent(correct / attempts) : '—';

  const inner = [
    h(
      'div',
      { class: 'chapter-row__head' },
      h('span', { class: 'chapter-row__index', 'aria-hidden': 'true', text: String(chapter.order).padStart(2, '0') }),
      h('span', { class: 'chapter-row__name', text: chapter.name }),
      total > 0 ? h('span', { class: 'chapter-row__chevron', 'aria-hidden': 'true', text: '›' }) : badge('暂无题目')
    ),
    h(
      'div',
      { class: 'chapter-row__meta' },
      h('span', { text: total > 0 ? `已练 ${seen} / ${total}` : '等待题库更新' }),
      h('span', { text: `正确率 ${accuracy}` })
    ),
    progressBar(ratio, { size: 'sm', label: `${chapter.name} 练习进度` }),
  ];

  if (total === 0) {
    return h('div', { class: 'chapter-row chapter-row--empty' }, inner);
  }
  return h(
    'a',
    { class: 'chapter-row', href: `#/practice?chapter=${encodeURIComponent(chapter.id)}` },
    inner
  );
}

export function render(root, ctx) {
  const { chapters, meta } = ctx;
  const progress = getProgress();
  const wrong = getWrong();
  const stats = getStats();
  const today = todayStr();
  // 全站统一口径：可练题池 = 排除重复题与损坏题
  const pool = ctx.practicable;
  const learned = pool.filter((question) => progress[question.id] && progress[question.id].seen > 0).length;
  const due = dueCount(pool, progress, today);
  const wrongCount = Object.keys(wrong).filter((id) => {
    const question = ctx.questionMap.get(id);
    return question && question.flag !== 'broken';
  }).length;
  const streak = currentStreaks(today);
  const totals = totalStats(today);
  const todayEntry = stats.daily[today] || { answered: 0, correct: 0 };
  const libraryTotal = meta.usableTotal || pool.length;

  const hero = h(
    'section',
    { class: 'hero card' },
    h('span', { class: 'hero__kicker' }, badge('2024 全国工业设计职业技能大赛 · 决赛理论题库', 'primary')),
    h('h1', { class: 'hero__title', text: meta.title }),
    h(
      'p',
      { class: 'hero__subtitle' },
      '把零散的知识点刷成稳定记忆：先按章节过一遍，再收拾错题，最后交给记忆曲线。'
    ),
    h(
      'div',
      { class: 'hero__meta' },
      h('span', null, `可练 ${libraryTotal} 题`),
      h('span', { class: 'dot', 'aria-hidden': 'true', text: '·' }),
      h('span', null, `${chapters.length} 个章节`),
      h('span', { class: 'dot', 'aria-hidden': 'true', text: '·' }),
      h('span', null, totals.answered > 0 ? `累计已答 ${totals.answered} 题` : '学习记录只保存在本机')
    ),
    h(
      'div',
      { class: 'hero__today' },
      todayEntry.answered > 0
        ? `今天已答 ${todayEntry.answered} 题，答对 ${todayEntry.correct} 题。继续保持。`
        : '今天还没开始，先来 10 道题热热身。'
    )
  );

  const statsGrid = h(
    'section',
    { class: 'stat-grid', 'aria-label': '学习概览' },
    statCard({
      label: '可练题目',
      value: libraryTotal,
      hint: '已排除重复题与损坏题',
      onClick: () => ctx.navigate('#/chapters'),
    }),
    statCard({
      label: '已练题数',
      value: learned,
      hint: learned > 0 ? `覆盖率 ${fmtPercent(learned / Math.max(1, pool.length))}` : '还没开始',
      tone: 'success',
      onClick: () => ctx.navigate('#/stats'),
    }),
    statCard({
      label: '今日待复习',
      value: due,
      hint: due > 0 ? '按记忆曲线到期' : '暂时没有到期的题',
      tone: 'warn',
      onClick: () => ctx.navigate(due > 0 ? '#/practice?scope=review' : '#/review'),
    }),
    statCard({
      label: '错题本',
      value: wrongCount,
      hint: wrongCount > 0 ? '建议今天清一清' : '没有错题，漂亮',
      tone: wrongCount > 0 ? 'danger' : 'success',
      onClick: () => ctx.navigate('#/wrong'),
    })
  );

  const actions = h(
    'section',
    { class: 'quick-actions', 'aria-label': '快捷入口' },
    h('a', { class: 'quick-action quick-action--primary', href: '#/chapters' }, [
      h('strong', { text: '开始练习' }),
      h('span', { text: '按章节逐题过关' }),
    ]),
    h('a', { class: 'quick-action', href: '#/exam' }, [
      h('strong', { text: '模拟考试' }),
      h('span', { text: '限时自测，检验水平' }),
    ]),
    h('a', { class: 'quick-action', href: due > 0 ? '#/practice?scope=review' : '#/review' }, [
      h('strong', { text: '今日复习' }),
      h('span', { text: due > 0 ? `${due} 道题到期` : '复习队列为空' }),
    ]),
    h('a', { class: 'quick-action', href: '#/wrong' }, [
      h('strong', { text: '错题本' }),
      h('span', { text: wrongCount > 0 ? `${wrongCount} 道待攻克` : '错题会自动收进来' }),
    ])
  );

  const chapterSection = h(
    'section',
    { class: 'stack' },
    sectionTitle(
      '章节进度',
      h('a', { class: 'link-arrow', href: '#/chapters' }, '查看全部章节'),
      '按章节推进，每道题的作答和掌握程度都会记录。'
    ),
    h(
      'div',
      { class: 'chapter-list' },
      chapters.map((chapter) => chapterRow(chapter, pool, progress))
    )
  );

  const streakCard = h(
    'section',
    { class: 'streak-card card' },
    h(
      'div',
      { class: 'streak-card__main' },
      h('span', { class: 'streak-card__label', text: '连续打卡' }),
      h('strong', { class: 'streak-card__value', text: `${streak.current} 天` })
    ),
    h(
      'div',
      { class: 'streak-card__meta' },
      h('span', null, `最长纪录 ${streak.longest} 天`),
      h('span', null, `累计打卡 ${streak.activeDays} 天`),
      h('span', null, `累计正确率 ${totals.answered > 0 ? fmtPercent(totals.accuracy) : '—'}`)
    )
  );

  mount(
    root,
    h(
      'div',
      { class: 'page' },
      hero,
      statsGrid,
      actions,
      chapterSection,
      streakCard
    )
  );
}
