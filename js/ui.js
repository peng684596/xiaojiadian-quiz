/**
 * 轻量 DOM 与通用 UI 组件（无第三方依赖）。
 *
 * 约定：只用 h() 创建元素；不拼 innerHTML（数据来自 JSON，统一走 textContent）。
 */

/* ------------------------------- 元素创建 ------------------------------ */

function applyStyle(el, style) {
  if (!style) return;
  if (typeof style === 'string') {
    el.style.cssText = style;
    return;
  }
  for (const [key, value] of Object.entries(style)) {
    if (value === null || value === undefined) continue;
    if (key.includes('-') || key.startsWith('--')) el.style.setProperty(key, String(value));
    else el.style[key] = String(value);
  }
}

/**
 * 创建元素。
 *   h('div', { class: 'card' }, '内容')
 *   h('button', { type: 'button', onClick: fn, disabled: true }, '确定')
 *   h('span', null, 子元素) —— 第二个参数省略或直接传子元素也可以
 *
 * @param {string} tag
 * @param {Object|null} [attrs]
 * @param {...any} children
 * @returns {HTMLElement}
 */
export function h(tag, attrs, ...children) {
  let props = attrs;
  let kids;
  if (
    props === null ||
    props === undefined ||
    typeof props !== 'object' ||
    props instanceof Node ||
    Array.isArray(props)
  ) {
    kids = [props, ...children];
    props = {};
  } else {
    kids = children;
  }

  const el = document.createElement(tag);

  for (const [key, value] of Object.entries(props)) {
    if (value === null || value === undefined || value === false) continue;
    if (key === 'class' || key === 'className') {
      el.className = Array.isArray(value) ? value.filter(Boolean).join(' ') : String(value);
    } else if (key === 'style') {
      applyStyle(el, value);
    } else if (key === 'dataset' && value && typeof value === 'object') {
      Object.assign(el.dataset, value);
    } else if (key === 'html') {
      el.innerHTML = String(value);
    } else if (key === 'text') {
      el.textContent = String(value);
    } else if (/^on[A-Z]/.test(key) && typeof value === 'function') {
      el.addEventListener(key.slice(2).toLowerCase(), value);
    } else if (key in el && typeof value !== 'string') {
      try {
        el[key] = value;
      } catch (err) {
        el.setAttribute(key, String(value));
      }
    } else {
      el.setAttribute(key, value === true ? '' : String(value));
    }
  }

  appendChildren(el, kids);
  return el;
}

function appendChildren(parent, kids) {
  for (const kid of kids.flat(Infinity)) {
    if (kid === null || kid === undefined || kid === false || kid === true) continue;
    parent.appendChild(kid instanceof Node ? kid : document.createTextNode(String(kid)));
  }
}

/** 文档片段 */
export function frag(...children) {
  const fragment = document.createDocumentFragment();
  appendChildren(fragment, children);
  return fragment;
}

/** 清空元素 */
export function clear(el) {
  if (el) el.replaceChildren();
}

/** 用新内容替换容器内容 */
export function mount(container, ...children) {
  clear(container);
  appendChildren(container, children);
}

export function $(selector, root = document) {
  return root.querySelector(selector);
}

export function $$(selector, root = document) {
  return Array.from(root.querySelectorAll(selector));
}

/* ------------------------------- 格式化 ------------------------------- */

/** 0-1 的比率转百分比文案；无数据返回 "—" */
export function fmtPercent(value, digits = 0) {
  if (!Number.isFinite(value)) return '—';
  const pct = Math.max(0, Math.min(1, value)) * 100;
  return `${pct.toFixed(digits)}%`;
}

/** 每题正确率 = 答对次数 / 作答次数 */
export function accuracyText(correct, attempts, digits = 0) {
  if (!attempts) return '—';
  return fmtPercent(correct / attempts, digits);
}

/** 秒数转中文时长 */
export function fmtDuration(totalSeconds, { compact = false } = {}) {
  const seconds = Math.max(0, Math.round(Number(totalSeconds) || 0));
  if (seconds < 60) return `${seconds} 秒`;
  const minutes = Math.floor(seconds / 60);
  const rest = seconds % 60;
  if (minutes < 60) {
    if (compact && rest === 0) return `${minutes} 分钟`;
    return rest > 0 ? `${minutes} 分 ${rest} 秒` : `${minutes} 分钟`;
  }
  const hours = Math.floor(minutes / 60);
  const restMinutes = minutes % 60;
  return restMinutes > 0 ? `${hours} 小时 ${restMinutes} 分` : `${hours} 小时`;
}

/** ISO 字符串 → "2026-10-19" / "10-19 15:20" */
export function fmtDate(value, { withTime = false } = {}) {
  if (!value) return '—';
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return '—';
  const pad = (n) => String(n).padStart(2, '0');
  const day = `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
  if (!withTime) return day;
  return `${day} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

/** 相对时间："刚刚 / 3 分钟前 / 昨天 / 10-19" */
export function fmtRelative(value) {
  if (!value) return '—';
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return '—';
  const diff = Date.now() - date.getTime();
  if (diff < 60 * 1000) return '刚刚';
  if (diff < 60 * 60 * 1000) return `${Math.floor(diff / 60000)} 分钟前`;
  if (diff < 24 * 60 * 60 * 1000) return `${Math.floor(diff / 3600000)} 小时前`;
  if (diff < 48 * 60 * 60 * 1000) return '昨天';
  return fmtDate(date);
}

/* ------------------------------- 组件 --------------------------------- */

/**
 * 进度条
 * @param {number} ratio 0-1
 * @param {{tone?:string, size?:'sm'|'md', label?:string}} [options]
 */
export function progressBar(ratio, options = {}) {
  const value = Math.max(0, Math.min(1, Number(ratio) || 0));
  const { tone = 'primary', size = 'md', label } = options;
  const fill = h('span', {
    class: ['progress__fill', tone !== 'primary' ? `progress__fill--${tone}` : ''],
    style: { width: `${(value * 100).toFixed(2)}%` },
  });
  return h(
    'div',
    {
      class: ['progress', size === 'sm' ? 'progress--sm' : ''],
      role: 'progressbar',
      'aria-valuemin': '0',
      'aria-valuemax': '100',
      'aria-valuenow': String(Math.round(value * 100)),
      'aria-label': label || '完成进度',
    },
    fill
  );
}

/**
 * 数字统计卡（可点击）
 * @param {{label:string, value:string|number, hint?:string, onClick?:Function, tone?:string}} options
 */
export function statCard({ label, value, hint, onClick, tone = 'primary' } = {}) {
  const tag = onClick ? 'button' : 'div';
  const attrs = {
    class: ['stat-card', tone !== 'primary' ? `stat-card--${tone}` : ''],
  };
  if (onClick) {
    attrs.type = 'button';
    attrs.onClick = onClick;
  }
  return h(
    tag,
    attrs,
    h('span', { class: 'stat-card__label', text: label }),
    h('strong', { class: 'stat-card__value', text: value }),
    hint ? h('span', { class: 'stat-card__hint', text: hint }) : null
  );
}

/** 区块标题（带可选的右侧操作） */
export function sectionTitle(title, action = null, subtitle = null) {
  return h(
    'div',
    { class: 'section-head' },
    h(
      'div',
      { class: 'section-head__text' },
      h('h2', { class: 'section-title', text: title }),
      subtitle ? h('p', { class: 'section-subtitle', text: subtitle }) : null
    ),
    action
  );
}

/** 题干配图（题库里只有少数读图题带图，路径相对于站点根） */
export function questionMedia(images) {
  if (!Array.isArray(images) || images.length === 0) return null;
  return h(
    'div',
    { class: 'question-media' },
    images.map((image) =>
      h(
        'figure',
        { class: 'question-media__figure' },
        h('img', {
          class: 'question-media__img',
          src: image.src,
          alt: image.alt || '题干配图',
          loading: 'lazy',
          decoding: 'async',
          width: image.w || undefined,
          height: image.h || undefined,
        }),
        image.alt ? h('figcaption', { class: 'question-media__caption', text: image.alt }) : null
      )
    )
  );
}

/** 空状态 */
export function emptyState({ title = '这里还是空的', hint = '', actionLabel = '', onAction = null } = {}) {
  return h(
    'div',
    { class: 'empty-state' },
    h('div', { class: 'empty-state__icon', 'aria-hidden': 'true', text: '◌' }),
    h('p', { class: 'empty-state__title', text: title }),
    hint ? h('p', { class: 'empty-state__hint', text: hint }) : null,
    actionLabel && onAction
      ? h('button', { class: 'btn btn--primary btn--sm', type: 'button', onClick: onAction }, actionLabel)
      : null
  );
}

/** 按钮 */
export function button(label, { onClick, variant = 'default', size = '', type = 'button', disabled = false, icon = null } = {}) {
  const classes = ['btn'];
  if (variant !== 'default') classes.push(`btn--${variant}`);
  if (size) classes.push(`btn--${size}`);
  return h(
    'button',
    { class: classes.join(' '), type, onClick, disabled: disabled || undefined },
    icon ? h('span', { class: 'btn__icon', 'aria-hidden': 'true', text: icon }) : null,
    label
  );
}

/** 荣誉标签 */
export function badge(text, tone = 'neutral') {
  return h('span', { class: ['badge', tone !== 'neutral' ? `badge--${tone}` : ''], text });
}

/* ------------------------------- toast -------------------------------- */

function ensureRoot(id, className) {
  let root = document.getElementById(id);
  if (!root) {
    root = h('div', { id, class: className });
    document.body.appendChild(root);
  }
  return root;
}

let toastTimer = null;

/**
 * 顶部轻提示
 * @param {string} message
 * @param {{tone?:'info'|'success'|'error', duration?:number}} [options]
 */
export function toast(message, { tone = 'info', duration = 2400 } = {}) {
  const root = ensureRoot('toast-root', 'toast-root');
  const item = h('div', { class: ['toast', `toast--${tone}`], role: 'status' }, message);
  root.appendChild(item);
  // 最多同时显示 3 条
  while (root.children.length > 3) root.removeChild(root.firstElementChild);
  window.clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => {
    item.classList.add('is-leaving');
    window.setTimeout(() => item.remove(), 180);
  }, duration);
}

/* ------------------------------- modal -------------------------------- */

/**
 * 打开模态框。返回 { el, close, closed }，closed 是一个 Promise。
 * @param {{title?:string, body?:any, actions?:Array, dismissible?:boolean}} options
 */
export function openModal({ title = '', body = null, actions = [], dismissible = true } = {}) {
  const root = ensureRoot('modal-root', 'modal-root');
  const previousFocus = document.activeElement;
  let resolveClosed;
  const closed = new Promise((resolve) => {
    resolveClosed = resolve;
  });
  let finished = false;

  const close = (result) => {
    if (finished) return;
    finished = true;
    document.removeEventListener('keydown', onKeyDown);
    backdrop.classList.add('is-leaving');
    window.setTimeout(() => {
      backdrop.remove();
      if (!root.querySelector('.modal-backdrop')) document.body.classList.remove('modal-open');
      if (previousFocus && typeof previousFocus.focus === 'function') previousFocus.focus();
    }, 120);
    resolveClosed(result);
  };

  const onKeyDown = (event) => {
    if (event.key === 'Escape' && dismissible) {
      event.preventDefault();
      close(undefined);
    }
  };

  const actionButtons = actions.map((action) => {
    const value = action.value === undefined ? true : action.value;
    const variant = action.danger ? 'danger' : action.variant || 'default';
    return h(
      'button',
      {
        class: ['btn', `btn--${variant}`],
        type: 'button',
        onClick: () => {
          if (typeof action.onClick === 'function') {
            const result = action.onClick();
            if (result === false) return;
          }
          if (action.keepOpen) return;
          close(value);
        },
      },
      action.label
    );
  });

  const backdrop = h(
    'div',
    {
      class: 'modal-backdrop',
      onClick: (event) => {
        if (dismissible && event.target === backdrop) close(undefined);
      },
    },
    h(
      'div',
      { class: 'modal', role: 'dialog', 'aria-modal': 'true', 'aria-label': title || '对话框' },
      title || dismissible
        ? h(
            'div',
            { class: 'modal__head' },
            h('h2', { class: 'modal__title', text: title }),
            dismissible
              ? h('button', { class: 'modal__close', type: 'button', 'aria-label': '关闭', onClick: () => close(undefined) }, '✕')
              : null
          )
        : null,
      h('div', { class: 'modal__body' }, body),
      actionButtons.length > 0 ? h('div', { class: 'modal__actions' }, actionButtons) : null
    )
  );

  root.appendChild(backdrop);
  document.body.classList.add('modal-open');
  document.addEventListener('keydown', onKeyDown);

  const focusTarget = backdrop.querySelector('.modal__actions .btn--primary') || backdrop.querySelector('button');
  if (focusTarget) window.setTimeout(() => focusTarget.focus(), 30);

  return { el: backdrop, close, closed };
}

/**
 * 二次确认。返回 Promise<boolean>。
 */
export async function confirmDialog(message, options = {}) {
  const {
    title = '请确认',
    confirmText = '确定',
    cancelText = '取消',
    danger = false,
    hint = '',
  } = options;
  let result = false;
  const modal = openModal({
    title,
    body: frag(
      h('p', { class: 'modal__message', text: message }),
      hint ? h('p', { class: 'modal__hint', text: hint }) : null
    ),
    actions: [
      { label: cancelText, value: false },
      { label: confirmText, value: true, danger, variant: danger ? 'danger' : 'primary' },
    ],
  });
  const value = await modal.closed;
  result = value === true;
  return result;
}

/* -------------------------------- 主题 -------------------------------- */

const darkQuery = (() => {
  try {
    return window.matchMedia('(prefers-color-scheme: dark)');
  } catch (err) {
    return null;
  }
})();

/** 解析主题：system/light/dark → light/dark */
export function resolveTheme(theme) {
  if (theme === 'light' || theme === 'dark') return theme;
  return darkQuery && darkQuery.matches ? 'dark' : 'light';
}

/** 应用主题到 <html data-theme> */
export function applyTheme(theme) {
  const resolved = resolveTheme(theme);
  document.documentElement.dataset.theme = resolved;
  document.documentElement.style.colorScheme = resolved;
}

/** 监听系统主题变化（仅在跟随系统时生效） */
export function watchSystemTheme(onChange) {
  if (!darkQuery) return () => {};
  const handler = () => onChange();
  try {
    darkQuery.addEventListener('change', handler);
    return () => darkQuery.removeEventListener('change', handler);
  } catch (err) {
    try {
      darkQuery.addListener(handler);
      return () => darkQuery.removeListener(handler);
    } catch (err2) {
      return () => {};
    }
  }
}
