/**
 * 记忆曲线：按 SM-2 lite 的间隔安排复习。
 */

import { h, mount, progressBar, sectionTitle, emptyState } from '../ui.js';
import { getProgress } from '../store.js';
import { MAX_LEVEL, dueCount, intervalForLevel, levelCounts, todayStr } from '../srs.js';

const LEVEL_LABEL = ['待巩固', '初学', '有印象', '较熟', '熟练', '牢记'];

function daysUntil(target, today) {
  const t = Date.UTC(
    Number(target.slice(0, 4)),
    Number(target.slice(5, 7)) - 1,
    Number(target.slice(8, 10))
  );
  const n = Date.UTC(
    Number(today.slice(0, 4)),
    Number(today.slice(5, 7)) - 1,
    Number(today.slice(8, 10))
  );
  return Math.round((t - n) / 86400000);
}

export function render(root, ctx) {
  const today = todayStr();
  const progress = getProgress();
  // 全站统一口径：可练题池（排除重复题与损坏题）
  const pool = ctx.practicable;
  const dueTotal = dueCount(pool, progress, today);
  const counts = levelCounts(progress, pool);

  const studiedCount = counts.reduce((sum, count) => sum + count, 0);
  const repsTotal = pool.reduce((sum, question) => {
    const entry = progress[question.id];
    return sum + (entry ? Number(entry.reps) || 0 : 0);
  }, 0);

  const nextDue = pool
    .map((question) => progress[question.id])
    .filter((entry) => entry && entry.due && entry.due > today)
    .map((entry) => entry.due)
    .sort()[0];

  function nextDueText() {
    if (!nextDue) return '把题练起来后，这里会显示下一次复习时间。';
    const days = daysUntil(nextDue, today);
    if (days <= 0) return '下次复习：今天';
    if (days === 1) return `下次复习：明天（${nextDue}）`;
    return `下次复习：${nextDue}（${days} 天后）`;
  }

  const maxLevelCount = Math.max(1, ...counts);

  const levelRows = counts.map((count, level) => {
    const interval = level > 0 ? intervalForLevel(level) : 0;
    return h(
      'div',
      { class: 'level-row' },
      h(
        'div',
        { class: 'level-row__label' },
        h('span', { class: 'level-row__badge', text: `Lv${level}` }),
        h('span', { text: LEVEL_LABEL[level] }),
        interval ? h('span', { class: 'muted small', text: `间隔 ${interval} 天` }) : null
      ),
      h(
        'div',
        { class: 'level-row__bar' },
        progressBar(count / maxLevelCount, {
          tone: level >= 4 ? 'success' : 'primary',
          size: 'sm',
        })
      ),
      h('span', { class: 'level-row__count', text: `${count} 题` })
    );
  });

  const main = h(
    'div',
    { class: 'page' },
    h('header', { class: 'page-head' }, [
      h('h1', { class: 'page-title', text: '记忆曲线' }),
      h('p', {
        class: 'page-subtitle',
        text: '答对升一级、答错重新开始。按 1 / 2 / 4 / 7 / 15 / 30 天的间隔帮你安排复习。',
      }),
    ]),

    h(
      'section',
      { class: 'card review-hero' },
      h(
        'div',
        { class: 'review-hero__main' },
        h('div', { class: 'review-hero__num', text: String(dueTotal) }),
        h('div', { class: 'review-hero__caption', text: '今天到期的题' }),
        h('p', { class: 'muted', text: nextDueText() })
      ),
      h(
        'div',
        { class: 'review-hero__actions' },
        dueTotal > 0
          ? h(
              'a',
              { class: 'btn btn--primary btn--lg', href: '#/practice?scope=review' },
              `开始今日复习（${dueTotal}）`
            )
          : h('span', { class: 'badge badge--success', text: '今天已经清空，休息一下' }),
        dueTotal === 0 && studiedCount > 0
          ? h('span', { class: 'muted small', text: '明天再来即可' })
          : null
      )
    ),

    h(
      'div',
      { class: 'stat-grid' },
      h(
        'div',
        { class: 'stat-card' },
        h('div', { class: 'stat-card__label', text: '已进入复习' }),
        h('div', { class: 'stat-card__value', text: `${studiedCount}` }),
        h('div', { class: 'stat-card__hint', text: '道题' })
      ),
      h(
        'div',
        { class: 'stat-card' },
        h('div', { class: 'stat-card__label', text: '累计复习' }),
        h('div', { class: 'stat-card__value', text: `${repsTotal}` }),
        h('div', { class: 'stat-card__hint', text: '次' })
      ),
      h(
        'div',
        { class: 'stat-card' },
        h('div', { class: 'stat-card__label', text: '最高等级' }),
        h('div', { class: 'stat-card__value', text: `Lv${MAX_LEVEL}` }),
        h('div', { class: 'stat-card__hint', text: '答对 5 次达成' })
      )
    ),

    h(
      'section',
      { class: 'card card--pad' },
      sectionTitle('等级分布', null, '等级越高，复习间隔越长。'),
      studiedCount > 0
        ? h('div', { class: 'level-list' }, levelRows)
        : emptyState({
            title: '还没有进入复习的题',
            hint: '先做几道题，答过的题会自动排进记忆曲线。',
            actionLabel: '去练习',
            onAction: () => ctx.navigate('#/chapters'),
          })
    ),

    h(
      'section',
      { class: 'card card--pad' },
      sectionTitle('复习规则'),
      h(
        'ul',
        { class: 'rule-list' },
        h('li', null, h('strong', { text: '答对' }), '：等级 +1（最高 Lv5），下一次复习间隔按下表拉长。'),
        h('li', null, h('strong', { text: '答错' }), '：等级回到 Lv0，今天重新复习。'),
        h('li', null, h('strong', { text: '间隔' }), '：Lv1 起依次为 1、2、4、7、15、30 天。'),
        h('li', null, h('strong', { text: '队列' }), '：先复习等级低的，同等级按到期时间先后排列。')
      )
    )
  );

  mount(root, main);
  return () => {};
}
