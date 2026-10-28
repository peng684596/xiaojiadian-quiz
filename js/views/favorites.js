/**
 * 收藏夹：查看收藏的题目，可重练或取消收藏。
 */

import { badge, button, confirmDialog, emptyState, h, mount, toast } from '../ui.js';
import { getFavorites, isFavorite, saveFavorites, toggleFavorite } from '../store.js';
import { typeLabel } from '../quiz.js';

export function render(root, ctx) {
  const favorites = getFavorites();
  const items = favorites
    .map((id) => ctx.questionMap.get(id))
    // 损坏题永远不进入任何列表
    .filter((question) => question && question.flag !== 'broken');

  function renderList() {
    if (items.length === 0) {
      mount(
        listHost,
        emptyState({
          title: '还没有收藏的题',
          hint: '练习时点题目右上角的 ★，就能把这道题收进来，之后集中重练。',
          actionLabel: '去练习',
          onAction: () => ctx.navigate('#/chapters'),
        })
      );
      countText.textContent = '共 0 道';
      return;
    }
    countText.textContent = `共 ${items.length} 道`;
    mount(
      listHost,
      h(
        'div',
        { class: 'list-cards' },
        items.map((question) => {
          const chapterName = ctx.chapterMap.has(question.chapter)
            ? ctx.chapterMap.get(question.chapter).name
            : question.chapter;
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
                badge(chapterName)
              ),
              h('span', { class: 'list-card__stat', text: `No.${Number(question.no) || ''}` })
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
                  onClick: () => ctx.navigate(`#/practice?ids=${encodeURIComponent(question.id)}&from=favorite`),
                },
                '单独重练'
              ),
              h(
                'button',
                {
                  class: 'btn btn--sm btn--ghost',
                  type: 'button',
                  onClick: () => {
                    toggleFavorite(question.id);
                    toast('已取消收藏', { tone: 'info' });
                    ctx.reload();
                  },
                },
                '取消收藏'
              )
            )
          );
        })
      )
    );
  }

  const listHost = h('div', { class: 'stack' });
  const countText = h('span', { class: 'muted small' });

  const page = h(
    'div',
    { class: 'page' },
    h('header', { class: 'page-head' }, [
      h('h1', { class: 'page-title', text: '收藏夹' }),
      h('p', { class: 'page-subtitle', text: '把容易忘、反复错的题收在这里，考前集中过一遍。' }),
    ]),
    h(
      'div',
      { class: 'toolbar card card--pad' },
      h('div', { class: 'toolbar__filters' }, countText),
      h(
        'div',
        { class: 'toolbar__actions' },
        items.length > 0
          ? h(
              'a',
              { class: 'btn btn--primary btn--sm', href: '#/practice?scope=favorite' },
              '开始重练'
            )
          : null,
        items.length > 0
          ? button('清空收藏', {
              variant: 'danger',
              size: 'sm',
              onClick: async () => {
                const confirmed = await confirmDialog('清空后收藏记录会被删除，题目本身不受影响，确定吗？', {
                  title: '清空收藏',
                  confirmText: '清空',
                  danger: true,
                });
                if (!confirmed) return;
                saveFavorites([]);
                toast('收藏已清空', { tone: 'info' });
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
