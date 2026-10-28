/**
 * 设置：练习偏好、主题、数据备份与恢复。
 */

import { h, mount, sectionTitle, toast, confirmDialog } from '../ui.js';
import {
  APP_VERSION,
  exportAll,
  getSettings,
  importAll,
  resetAll,
  saveSettings,
} from '../store.js';
import { todayStr } from '../srs.js';

const THEMES = [
  { value: 'system', label: '跟随系统' },
  { value: 'light', label: '浅色' },
  { value: 'dark', label: '深色' },
];

function downloadBackup() {
  const payload = exportAll();
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `appliance-maker-quiz-${todayStr()}.json`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function render(root, ctx) {
  const settings = getSettings();

  function settingRow({ title, desc, checked, key, onChange }) {
    return h(
      'label',
      { class: 'setting-row' },
      h(
        'span',
        { class: 'setting-row__text' },
        h('span', { class: 'setting-row__title', text: title }),
        h('span', { class: 'setting-row__desc', text: desc })
      ),
      h('input', {
        class: 'switch',
        type: 'checkbox',
        checked,
        onChange: (event) => {
          saveSettings({ [key]: event.target.checked });
          if (onChange) onChange(event.target.checked);
        },
      })
    );
  }

  const themeGroup = h(
    'div',
    { class: 'chip-group' },
    THEMES.map((theme) =>
      h(
        'label',
        { class: 'chip' },
        h('input', {
          class: 'chip__input',
          type: 'radio',
          name: 'theme',
          value: theme.value,
          checked: settings.theme === theme.value,
          onChange: () => {
            saveSettings({ theme: theme.value });
            ctx.applyTheme(theme.value);
          },
        }),
        h('span', { class: 'chip__label', text: theme.label })
      )
    )
  );

  const importInput = h('input', {
    type: 'file',
    accept: '.json,application/json',
    hidden: true,
    onChange: async (event) => {
      const file = event.target.files && event.target.files[0];
      event.target.value = '';
      if (!file) return;
      try {
        const text = await file.text();
        const result = importAll(text);
        toast(
          `已导入：${result.progressCount} 条练习记录、${result.wrongCount} 道错题、${result.favoriteCount} 道收藏`,
          { tone: 'success', duration: 3600 }
        );
        ctx.reload();
      } catch (err) {
        toast(`导入失败：${err && err.message ? err.message : '文件格式不正确'}`, {
          tone: 'error',
          duration: 4000,
        });
      }
    },
  });

  const page = h(
    'div',
    { class: 'page' },
    h('header', { class: 'page-head' }, [
      h('h1', { class: 'page-title', text: '设置' }),
      h('p', { class: 'page-subtitle', text: '偏好和数据都只保存在这台电脑的浏览器里，不会上传。' }),
    ]),

    h(
      'section',
      { class: 'card card--pad' },
      sectionTitle('练习'),
      h(
        'div',
        { class: 'setting-list' },
        settingRow({
          title: '选项乱序',
          desc: '顺序按题目标识固定打乱，每次进入练习的选项顺序一致；判断题不受影响。',
          key: 'shuffle',
          checked: settings.shuffle,
        }),
        settingRow({
          title: '自动下一题',
          desc: '提交答案后约 1.2 秒自动进入下一题。',
          key: 'autoNext',
          checked: settings.autoNext,
        }),
        settingRow({
          title: '包含重复题',
          desc: '题库中标记为重复的题，默认不进入练习、模考和复习。',
          key: 'includeDup',
          checked: settings.includeDup,
        })
      )
    ),

    h(
      'section',
      { class: 'card card--pad' },
      sectionTitle('外观'),
      h(
        'div',
        { class: 'setting-block' },
        h('span', { class: 'setting-row__title', text: '主题' }),
        h('p', { class: 'setting-row__desc', text: '深色模式跟随系统时，会随系统外观自动切换。' }),
        themeGroup
      )
    ),

    h(
      'section',
      { class: 'card card--pad' },
      sectionTitle('数据', null, '换设备或重装浏览器前，建议先导出一份备份。'),
      h(
        'div',
        { class: 'setting-actions' },
        h(
          'button',
          { class: 'btn', type: 'button', onClick: () => downloadBackup() },
          '导出备份（JSON）'
        ),
        h(
          'button',
          { class: 'btn', type: 'button', onClick: () => importInput.click() },
          '从备份恢复'
        ),
        importInput,
        h(
          'button',
          {
            class: 'btn btn--danger',
            type: 'button',
            onClick: async () => {
              const confirmed = await confirmDialog(
                '会清空练习记录、错题本、收藏、设置和考试历史，且无法撤销。确定要清空吗？',
                { title: '清空所有数据', confirmText: '全部清空', danger: true }
              );
              if (!confirmed) return;
              resetAll();
              ctx.applyTheme('system');
              toast('所有数据已清空', { tone: 'info' });
              ctx.navigate('#/');
            },
          },
          '清空所有数据'
        )
      )
    ),

    h(
      'section',
      { class: 'card card--pad' },
      sectionTitle('关于'),
      h(
        'dl',
        { class: 'info-list' },
        h('dt', { text: '题库' }),
        h('dd', { text: `${ctx.meta.title || '小型家用电器制造工题库'}${ctx.meta.version ? ` · ${ctx.meta.version}` : ''}` }),
        h('dt', { text: '题量' }),
        h('dd', { text: `${ctx.questions.length} 题 / ${ctx.chapters.length} 个章节` }),
        h('dt', { text: '应用版本' }),
        h('dd', { text: APP_VERSION }),
        h('dt', { text: '数据存储' }),
        h('dd', { text: '浏览器 localStorage（键名以 appq: 开头）' })
      )
    )
  );

  mount(root, page);
  return () => {};
}
