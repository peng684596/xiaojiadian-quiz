/**
 * 章节练习入口：章节卡片列表 + 全部题目随机练习。
 */

import { fmtPercent, h, mount, progressBar, sectionTitle, button, badge } from '../ui.js';
import { getProgress } from '../store.js';

function chapterCard(chapter, pool, progress, ctx) {
  const list = pool.filter((question) => question.chapter === chapter.id);
  const total = list.length;
  const seen = list.filter((question) => progress[question.id] && progress[question.id].seen > 0).length;
  const attempts = list.reduce((sum, question) => sum + (Number(progress[question.id] && progress[question.id].seen) || 0), 0);
  const correct = list.reduce((sum, question) => sum + (Number(progress[question.id] && progress[question.id].correct) || 0), 0);
  const ratio = total > 0 ? seen / total : 0;
  const accuracy = attempts > 0 ? fmtPercent(correct / attempts) : '—';

  const body = [
    h(
      'div',
      { class: 'chapter-card__head' },
      h(
        'div',
        null,
        h('span', { class: 'chapter-card__index', text: `第 ${chapter.order} 章` }),
        h('h2', { class: 'chapter-card__title', text: chapter.name })
      ),
      total > 0 ? badge(`${total} 题`) : badge('暂无题目', 'warn')
    ),
    h(
      'div',
      { class: 'chapter-card__stats' },
      h('span', null, `已练 ${seen} / ${total}`),
      h('span', null, `正确率 ${accuracy}`),
      h('span', null, `完成度 ${fmtPercent(ratio)}`)
    ),
    progressBar(ratio, { size: 'sm', label: `${chapter.name} 完成进度` }),
  ];

  if (total === 0) {
    return h('div', { class: 'chapter-card chapter-card--empty' }, body);
  }

  const start = h('button', {
    class: 'btn btn--primary btn--sm',
    type: 'button',
    onClick: () => {
      ctx.navigate(`#/practice?chapter=${encodeURIComponent(chapter.id)}`);
    },
  }, '开始练习');

  return h(
    'article',
    { class: 'chapter-card' },
    body,
    h('div', { class: 'chapter-card__actions' }, start)
  );
}

export function render(root, ctx) {
  const { chapters } = ctx;
  const progress = getProgress();
  const pool = ctx.practicable;
  const learned = pool.filter((question) => progress[question.id] && progress[question.id].seen > 0).length;
  const attempts = pool.reduce((sum, question) => sum + (Number(progress[question.id] && progress[question.id].seen) || 0), 0);
  const correct = pool.reduce((sum, question) => sum + (Number(progress[question.id] && progress[question.id].correct) || 0), 0);

  const overview = h(
    'div',
    { class: 'card card--pad overview-bar' },
    h(
      'div',
      { class: 'overview-bar__text' },
      h('strong', { text: `可练题目 ${pool.length} 道` }),
      h(
        'span',
        { class: 'muted small' },
        `已练 ${learned} 道 · 累计正确率 ${attempts > 0 ? fmtPercent(correct / attempts) : '—'}`
      )
    ),
    h(
      'div',
      { class: 'overview-bar__actions' },
      button('随机练习全部', {
        variant: 'primary',
        size: 'sm',
        onClick: () => ctx.navigate('#/practice?scope=all&shuffle=1'),
        disabled: pool.length === 0,
      }),
      h('a', { class: 'btn btn--sm', href: '#/wrong' }, '去错题本')
    )
  );

  mount(
    root,
    h(
      'div',
      { class: 'page' },
      h('header', { class: 'page-head' }, [
        h('h1', { class: 'page-title', text: '章节练习' }),
        h('p', { class: 'page-subtitle', text: '按章节逐题过关，答错的题会自动收进错题本。' }),
      ]),
      overview,
      sectionTitle('全部章节', null, '章节顺序与考试大纲一致，建议按顺序推进。'),
      h(
        'div',
        { class: 'chapter-card-list' },
        chapters.map((chapter) => chapterCard(chapter, pool, progress, ctx))
      )
    )
  );
}
