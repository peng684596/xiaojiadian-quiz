/**
 * 错题本：按章节 / 题型筛选，可重练、标记已掌握、清空。
 */

import {
  badge,
  button,
  confirmDialog,
  emptyState,
  fmtRelative,
  h,
  mount,
  toast,
} from '../ui.js';
import { clearWrongBook, getWrong, markMastered } from '../store.js';
import { typeLabel } from '../quiz.js';

export function render(root, ctx) {
  const wrong = getWrong();
  const state = {
    chapter: 'all',
    type: 'all',
  };

  const entries = Object.keys(wrong)
    .map((id) => ({ id, entry: wrong[id], question: ctx.questionMap.get(id) }))
    // 损坏题永远不进入任何列表（即使历史数据里留有记录）
    .filter((item) => item.question && item.question.flag !== 'broken')
    .sort((a, b) => {
      const ta = String((a.entry && a.entry.lastWrongAt) || '');
      const tb = String((b.entry && b.entry.lastWrongAt) || '');
      return tb.localeCompare(ta);
    });

  const listHost = h('div', { class: 'stack' });
  const countText = h('span', { class: 'muted small' });

  const chapterSelect = h(
    'select',
    {
      class: 'select',
      'aria-label': '按章节筛选',
      onChange: (event) => {
        state.chapter = event.target.value;
        renderList();
      },
    },
    h('option', { value: 'all', text: '全部章节' }),
    ctx.chapters.map((chapter) => h('option', { value: chapter.id, text: chapter.name }))
  );

  const typeSelect = h(
    'select',
    {
      class: 'select',
      'aria-label': '按题型筛选',
      onChange: (event) => {
        state.type = event.target.value;
        renderList();
      },
    },
    h('option', { value: 'all', text: '全部题型' }),
    h('option', { value: 'single', text: '单选题' }),
    h('option', { value: 'multi', text: '多选题' }),
    h('option', { value: 'judge', text: '判断题' })
  );

  function filteredEntries() {
    return entries.filter((item) => {
      if (state.chapter !== 'all' && item.question.chapter !== state.chapter) return false;
      if (state.type !== 'all' && item.question.type !== state.type) return false;
      return true;
    });
  }

  function renderList() {
    const list = filteredEntries();
    countText.textContent = `共 ${list.length} 道`;
    if (list.length === 0) {
      mount(
        listHost,
        emptyState({
          title: entries.length === 0 ? '错题本还是空的' : '当前筛选下没有错题',
          hint:
            entries.length === 0
              ? '练习中答错的题会自动收进来，连续答对的题可以在这里标记「已掌握」。'
              : '换个章节或题型看看。',
          actionLabel: entries.length === 0 ? '去练习' : '',
          onAction: entries.length === 0 ? () => ctx.navigate('#/chapters') : null,
        })
      );
      return;
    }
    mount(
      listHost,
      h(
        'div',
        { class: 'list-cards' },
        list.map((item) => {
          const question = item.question;
          const chapterName = ctx.chapterMap.has(question.chapter) ? ctx.chapterMap.get(question.chapter).name : question.chapter;
          const streak = Number(item.entry && item.entry.streak) || 0;
          return h(
            'article',
            { class: 'list-card card' },
            h(
              'div',
              { class: 'list-card__head' },
              h(
                'div',
                { class: 'list-card__tags' },
                badge(typeLabel(question.type), question.type === 'multi' ? 'warn' : 'primary'),
                badge(chapterName),
                streak > 0 ? badge(`已连续答对 ${streak} 次`, 'success') : null
              ),
              h(
                'span',
                { class: 'list-card__stat' },
                `错 ${Number(item.entry.count) || 0} 次 · ${fmtRelative(item.entry.lastWrongAt)}`
              )
            ),
            h('p', { class: 'list-card__stem', text: question.stem }),
            h(
              'div',
              { class: 'list-card__actions' },
              h(
                'button',
                {
                  class: 'btn btn--sm',
                  type: 'button',
                  onClick: () => ctx.navigate(`#/practice?ids=${encodeURIComponent(question.id)}`),
                },
                '单独重练'
              ),
              h(
                'button',
                {
                  class: 'btn btn--sm btn--success',
                  type: 'button',
                  onClick: () => {
                    markMastered(question.id);
                    toast('已标记为掌握，移出错题本', { tone: 'success' });
                    ctx.reload();
                  },
                },
                '已掌握'
              )
            )
          );
        })
      )
    );
  }

  const page = h(
    'div',
    { class: 'page' },
    h('header', { class: 'page-head' }, [
      h('h1', { class: 'page-title', text: '错题本' }),
      h('p', { class: 'page-subtitle', text: '答错的题会自动进来。连续答对 2 次后，可以在这里把它标记为已掌握。' }),
    ]),
    h(
      'div',
      { class: 'toolbar card card--pad' },
      h('div', { class: 'toolbar__filters' }, chapterSelect, typeSelect, countText),
      h(
        'div',
        { class: 'toolbar__actions' },
        entries.length > 0
          ? h('a', { class: 'btn btn--primary btn--sm', href: '#/practice?scope=wrong' }, '开始重练')
          : null,
        entries.length > 0
          ? button('清空错题本', {
              variant: 'danger',
              size: 'sm',
              onClick: async () => {
                const confirmed = await confirmDialog('清空后所有错题记录都会删除，确定吗？', {
                  title: '清空错题本',
                  confirmText: '清空',
                  danger: true,
                });
                if (!confirmed) return;
                clearWrongBook();
                toast('错题本已清空', { tone: 'info' });
                ctx.reload();
              },
            })
          : null
      )
    ),
    listHost
  );

  renderList();
  mount(root, page);
  return () => {};
}
