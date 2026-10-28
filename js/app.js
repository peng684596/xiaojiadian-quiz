/**
 * 应用入口：加载题库、hash 路由、全局外壳。
 *
 * 路由表（hash 不改变页面路径，因此相对路径 fetch 在深链接下同样可用）：
 *   #/               首页
 *   #/chapters       章节列表
 *   #/practice       章节练习（query: chapter / scope / ids / shuffle）
 *   #/exam           模拟考试
 *   #/wrong          错题本
 *   #/favorites      收藏
 *   #/review         记忆曲线
 *   #/stats          统计
 *   #/settings       设置
 */

import { applyTheme, h, mount, toast, watchSystemTheme } from './ui.js';
import { practicablePool } from './quiz.js';
import * as store from './store.js';
import * as homeView from './views/home.js';
import * as chaptersView from './views/chapters.js';
import * as practiceView from './views/practice.js';
import * as examView from './views/exam.js';
import * as wrongView from './views/wrong.js';
import * as favoritesView from './views/favorites.js';
import * as reviewView from './views/review.js';
import * as statsView from './views/stats.js';
import * as settingsView from './views/settings.js';

const VIEWS = {
  home: homeView,
  chapters: chaptersView,
  practice: practiceView,
  exam: examView,
  wrong: wrongView,
  favorites: favoritesView,
  review: reviewView,
  stats: statsView,
  settings: settingsView,
};

const ROUTE_VIEW = {
  '/': 'home',
  '/chapters': 'chapters',
  '/practice': 'practice',
  '/exam': 'exam',
  '/wrong': 'wrong',
  '/favorites': 'favorites',
  '/review': 'review',
  '/stats': 'stats',
  '/settings': 'settings',
};

const ROUTE_TITLE = {
  home: '首页',
  chapters: '章节练习',
  practice: '答题',
  exam: '模拟考试',
  wrong: '错题本',
  favorites: '收藏',
  review: '记忆曲线',
  stats: '统计',
  settings: '设置',
};

const NAV_MATCH = {
  '/': 'home',
  '/chapters': 'chapters',
  '/practice': 'chapters',
  '/exam': 'exam',
  '/wrong': 'wrong',
  '/favorites': 'favorites',
  '/review': 'review',
  '/stats': 'stats',
  '/settings': 'settings',
};

const state = {
  meta: { title: '小型家用电器制造工题库', version: '', total: 0 },
  questions: [],
  chapters: [],
  chapterMap: new Map(),
  questionMap: new Map(),
  /** 可练题池：排除重复题与损坏题 */
  practicable: [],
  /** 章节 id → 该章可练题（用于所有章节计数） */
  chapterPracticable: new Map(),
  settings: store.getSettings(),
  salt: '',
  cleanup: null,
  booted: false,
};

const mainEl = document.getElementById('main');

/* ------------------------------- 数据加载 ------------------------------ */

const CHAPTER_FALLBACK = { id: 'misc', name: '综合', order: 99 };

function asText(value, fallback = '') {
  if (value === null || value === undefined) return fallback;
  return String(value);
}

function normalizeChapter(raw, index) {
  const id = asText(raw && (raw.id || raw.key)).trim();
  if (!id) return null;
  const chapter = {
    id,
    name: asText(raw.name || raw.title, `章节 ${index + 1}`).trim(),
    order: Number.isFinite(Number(raw.order)) ? Number(raw.order) : index + 1,
  };
  if (Number.isFinite(Number(raw.count))) chapter.count = Number(raw.count);
  return chapter;
}

function normalizeOption(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const key = asText(raw.key).trim();
  const text = asText(raw.text).trim();
  if (!key || !text) return null;
  return { key, text };
}

/**
 * 原始标记 → 站内 flag（见 docs/SPEC.md 第 1 节）。
 * broken 永不抽取；其余解析期可疑标记统一降级为 review（仍可练习，只是可筛可看）。
 */
const FLAG_BY_MARK = {
  broken: 'broken',
  'answer-key-missing': 'review',
  'no-answer': 'review',
  'single-multi-answer': 'review',
  'multi-single-answer': 'review',
  'type-mismatch': 'review',
  'image-missing': 'review',
  'figure': 'figure',
};

/** 兼容两种数据写法：`flag: "review"`（旧）与 `flags: ["..."]`（本项目导出格式）。 */
function normalizeFlag(raw) {
  const marks = [];
  if (Array.isArray(raw.flags)) marks.push(...raw.flags);
  if (raw.flag) marks.push(raw.flag);
  let out = null;
  for (const mark of marks) {
    const mapped = FLAG_BY_MARK[mark];
    if (mapped === 'broken') return 'broken';
    if (mapped) out = mapped;
  }
  return out;
}

function normalizeImages(raw) {
  if (!Array.isArray(raw)) return null;
  const images = [];
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue;
    const src = asText(item.src).trim();
    if (!src) continue;
    const image = { src, alt: asText(item.alt).trim() };
    if (Number.isFinite(Number(item.w)) && Number(item.w) > 0) image.w = Number(item.w);
    if (Number.isFinite(Number(item.h)) && Number(item.h) > 0) image.h = Number(item.h);
    images.push(image);
  }
  return images.length > 0 ? images : null;
}

function normalizeQuestion(raw, index) {
  if (!raw || typeof raw !== 'object') return null;
  const id = asText(raw.id).trim();
  const stem = asText(raw.stem).trim();
  const type = asText(raw.type);
  if (!id || !stem || !['single', 'multi', 'judge'].includes(type)) return null;

  const options = Array.isArray(raw.options) ? raw.options.map(normalizeOption).filter(Boolean) : [];
  if (options.length < 2) return null;
  const seenKeys = new Set();
  for (const option of options) {
    if (seenKeys.has(option.key)) return null;
    seenKeys.add(option.key);
  }

  const answer = (Array.isArray(raw.answer) ? raw.answer : [raw.answer])
    .map((key) => asText(key).trim())
    .filter((key) => key && seenKeys.has(key));
  if (answer.length === 0) return null;

  return {
    id,
    no: Number.isFinite(Number(raw.no)) ? Number(raw.no) : index + 1,
    page: raw.page === null || raw.page === undefined ? null : raw.page,
    type,
    chapter: asText(raw.chapter).trim(),
    stem,
    options,
    answer: Array.from(new Set(answer)).sort(),
    explain: asText(raw.explain).trim(),
    flag: normalizeFlag(raw),
    images: normalizeImages(raw.images),
    // dupOf 在真实数据里是“保留题的 PDF 题号”（数字），归一化时再解析成题目 id
    dupOf: raw.dupOf === null || raw.dupOf === undefined || raw.dupOf === '' ? null : raw.dupOf,
  };
}

/** 校验并归一化题库数据；返回 { questions, chapters, meta, dropped } */
function normalizeData(raw) {
  const source = raw && typeof raw === 'object' ? raw : {};
  const dropped = [];
  const rawQuestions = Array.isArray(source.questions) ? source.questions : [];

  let chapters = Array.isArray(source.chapters) ? source.chapters.map(normalizeChapter).filter(Boolean) : [];
  chapters.sort((a, b) => a.order - b.order);
  const chapterIds = new Set(chapters.map((chapter) => chapter.id));

  const questions = [];
  const seenIds = new Set();
  rawQuestions.forEach((item, index) => {
    let question = normalizeQuestion(item, index);
    if (!question && item && (item.flags || []).includes('broken')) {
      // broken 题：选项/答案残缺，normalizeQuestion 会判不合法。但它们已在
      // 数据里，丢掉会让 meta.total 对不上。用最小骨架收进来，前端永不抽取。
      const id = asText(item.id).trim();
      const stem = asText(item.stem).trim();
      if (id && stem) {
        question = {
          id,
          no: Number.isFinite(Number(item.no)) ? Number(item.no) : index + 1,
          page: item.page === null || item.page === undefined ? null : item.page,
          type: ['single', 'multi', 'judge'].includes(item.type) ? item.type : 'single',
          chapter: asText(item.chapter).trim(),
          stem,
          options: [],
          answer: [],
          explain: asText(item.explain).trim(),
          flag: 'broken',
          images: normalizeImages(item.images),
          dupOf: null,
        };
      }
    }
    if (!question) {
      dropped.push(index);
      return;
    }
    if (seenIds.has(question.id)) {
      dropped.push(index);
      return;
    }
    seenIds.add(question.id);
    if (!question.chapter || !chapterIds.has(question.chapter)) {
      question.chapter = chapterIds.has(CHAPTER_FALLBACK.id) ? CHAPTER_FALLBACK.id : chapters[0] ? chapters[0].id : CHAPTER_FALLBACK.id;
    }
    questions.push(question);
  });

  // 题库里出现、但 chapters 里没有声明的章节，补一个兜底章节，避免题目“消失”
  for (const question of questions) {
    if (!chapterIds.has(question.chapter)) {
      chapters.push({ id: question.chapter, name: question.chapter, order: chapters.length + 1 });
      chapterIds.add(question.chapter);
    }
  }
  if (chapters.length === 0) {
    chapters = [{ ...CHAPTER_FALLBACK }];
  }

  // 解析重复题指向：兼容“题目 id”和“PDF 题号”两种写法
  const byNo = new Map();
  questions.forEach((question) => {
    if (!byNo.has(question.no)) byNo.set(question.no, question);
  });
  for (const question of questions) {
    if (!question.dupOf) continue;
    const raw = question.dupOf;
    const rawText = asText(raw).trim();
    const target =
      questions.find((item) => item.id === rawText) ||
      (/^\d+$/.test(rawText) ? byNo.get(Number(rawText)) : null);
    question.dupOf = target && target.id !== question.id ? target.id : null;
  }

  questions.sort((a, b) => {
    if (a.no !== b.no) return a.no - b.no;
    return a.id.localeCompare(b.id);
  });

  const usableTotal = questions.filter((question) => !question.dupOf && question.flag !== 'broken').length;
  const sourceMeta = source.meta && typeof source.meta === 'object' ? source.meta : {};
  const meta = {
    title: asText(sourceMeta.title, '小型家用电器制造工题库').trim() || '小型家用电器制造工题库',
    shortTitle: asText(sourceMeta.shortTitle).trim(),
    version: asText(sourceMeta.version),
    total: questions.length,
    activeTotal: Number.isFinite(Number(sourceMeta.activeTotal)) ? Number(sourceMeta.activeTotal) : usableTotal,
    usableTotal,
  };

  return { questions, chapters, meta, dropped };
}

/* ------------------------------- 路由 --------------------------------- */

function parseHash() {
  const raw = (window.location.hash || '#/').replace(/^#/, '');
  const [pathPart, queryPart = ''] = raw.split('?');
  let path = pathPart || '/';
  if (!path.startsWith('/')) path = `/${path}`;
  if (path.length > 1) path = path.replace(/\/+$/, '');
  if (!path) path = '/';
  const query = {};
  if (queryPart) {
    for (const [key, value] of new URLSearchParams(queryPart)) {
      if (Object.prototype.hasOwnProperty.call(query, key)) {
        query[key] = Array.isArray(query[key]) ? [...query[key], value] : [query[key], value];
      } else {
        query[key] = value;
      }
    }
  }
  return { path: path === '' ? '/' : path, query };
}

function navigate(hash) {
  if (!hash) return;
  if (window.location.hash === hash) {
    render({ preserveScroll: true });
    return;
  }
  window.location.hash = hash;
}

function reload() {
  render({ preserveScroll: true });
}

function buildContext(route) {
  return {
    route,
    data: state.data,
    meta: state.meta,
    questions: state.questions,
    chapters: state.chapters,
    chapterMap: state.chapterMap,
    questionMap: state.questionMap,
    practicable: state.practicable,
    chapterPracticable: state.chapterPracticable,
    settings: state.settings,
    salt: state.salt,
    navigate,
    reload,
    applyTheme(theme) {
      store.saveSettings({ theme });
      state.settings = store.getSettings();
      applyTheme(state.settings.theme);
    },
  };
}

function updateChrome(viewName, route) {
  const navKey = NAV_MATCH[route.path] || '';
  document.querySelectorAll('[data-nav]').forEach((link) => {
    const active = link.getAttribute('data-nav') === navKey;
    link.classList.toggle('is-active', active);
    if (active) link.setAttribute('aria-current', 'page');
    else link.removeAttribute('aria-current');
  });
  const title = ROUTE_TITLE[viewName] || '题库';
  document.title = viewName === 'home' ? state.meta.title : `${title} · ${state.meta.title}`;
}

function render(options = {}) {
  if (!state.booted) return;
  const route = parseHash();
  const viewName = ROUTE_VIEW[route.path];
  const view = VIEWS[viewName] || null;

  // 卸载上一个视图（例如清理倒计时）
  if (typeof state.cleanup === 'function') {
    try {
      state.cleanup();
    } catch (err) {
      /* 清理失败不影响页面切换 */
    }
  }
  state.cleanup = null;

  state.settings = store.getSettings();
  applyTheme(state.settings.theme);

  const ctx = buildContext(route);
  mainEl.classList.remove('site-main--wide');

  if (!view) {
    updateChrome('home', route);
    mount(
      mainEl,
      h(
        'div',
        { class: 'page page--narrow' },
        h(
          'div',
          { class: 'card card--pad' },
          h('h1', { class: 'page-title', text: '页面走丢了' }),
          h('p', { class: 'muted', text: `没有找到 ${route.path} 对应的页面。` }),
          h('a', { class: 'btn btn--primary', href: '#/' }, '回到首页')
        )
      )
    );
  } else {
    updateChrome(viewName, route);
    try {
      const cleanup = view.render(mainEl, ctx);
      if (typeof cleanup === 'function') state.cleanup = cleanup;
    } catch (err) {
      renderError(err);
    }
  }

  if (!options.preserveScroll) {
    try {
      window.scrollTo({ top: 0, left: 0, behavior: 'auto' });
    } catch (err) {
      window.scrollTo(0, 0);
    }
  }
}

/* ------------------------------- 启动 --------------------------------- */

/**
 * 页头品牌只放题库简称：完整赛项名在首页大标题里，页头放全名会被截断成「家用电器…」。
 * 规则：去掉「第X届…大赛」这类前缀，取最后一段；仍过长时按字符截断。
 */
function brandLabel(title) {
  const short = String(state.meta.shortTitle || '').trim();
  if (short) return short;
  const full = String(title || '').trim();
  if (!full) return '题库';
  const parts = full.split(/\s+/);
  const tail = parts.length > 1 ? parts[parts.length - 1] : full;
  const label = tail.length >= 4 && tail.length < full.length ? tail : full;
  return label.length > 14 ? `${label.slice(0, 13)}…` : label;
}

function updateBrand() {
  const brandTitle = document.getElementById('brand-title');
  const brandSubtitle = document.getElementById('brand-subtitle');
  const footerTotal = document.getElementById('footer-total');
  if (brandTitle) brandTitle.textContent = brandLabel(state.meta.title);
  const usableTotal = state.meta.usableTotal || state.practicable.length;
  if (brandSubtitle) {
    // 与首页 hero、章节列表保持一致：全部章节都算（本项目的 misc 是「综合与时事」，不是兜底桶）
    brandSubtitle.textContent = `可练 ${usableTotal} 题 · ${state.chapters.length} 个章节`;
  }
  if (footerTotal) {
    const dupCount = state.questions.filter((question) => question.dupOf).length;
    footerTotal.textContent = `题库 ${state.questions.length} 题（含 ${dupCount} 道重复题；可练 ${usableTotal} 题）`;
  }
}

function renderBootError(error) {
  const detail = error && error.message ? error.message : String(error || '未知错误');
  mount(
    mainEl,
    h(
      'div',
      { class: 'page page--narrow' },
      h(
        'div',
        { class: 'card card--pad' },
        h('h1', { class: 'page-title', text: '题库加载失败' }),
        h('p', { class: 'muted' }, '请确认题库文件存在，并通过本地服务器打开页面（不要直接双击 index.html）。'),
        h('pre', { class: 'code-block', text: `python -m http.server 8123\n# 然后访问 http://localhost:8123/` }),
        h('p', { class: 'muted small', text: `错误详情：${detail}` }),
        h('a', { class: 'btn btn--primary', href: 'index.html' }, '重新加载')
      )
    )
  );
}

function renderError(error) {
  const detail = error && error.message ? error.message : String(error || '未知错误');
  mount(
    mainEl,
    h(
      'div',
      { class: 'page page--narrow' },
      h(
        'div',
        { class: 'card card--pad' },
        h('h1', { class: 'page-title', text: '页面渲染出错' }),
        h('p', { class: 'muted', text: detail }),
        h('button', { class: 'btn btn--primary', type: 'button', onClick: reload }, '重试'),
        h('a', { class: 'btn', href: '#/' }, '回到首页')
      )
    )
  );
}

async function boot() {
  state.settings = store.getSettings();
  applyTheme(state.settings.theme);

  let raw;
  try {
    const response = await fetch('data/questions.json', { cache: 'no-cache' });
    if (!response.ok) throw new Error(`HTTP ${response.status} ${response.statusText}`);
    raw = await response.json();
  } catch (error) {
    renderBootError(error);
    return;
  }

  const normalized = normalizeData(raw);
  state.data = raw;
  state.meta = normalized.meta;
  state.questions = normalized.questions;
  state.chapters = normalized.chapters;
  state.chapterMap = new Map(normalized.chapters.map((chapter) => [chapter.id, chapter]));
  state.questionMap = new Map(normalized.questions.map((question) => [question.id, question]));
  state.practicable = practicablePool(normalized.questions);
  state.meta.usableTotal = state.practicable.length;
  state.chapterPracticable = new Map(
    normalized.chapters.map((chapter) => [
      chapter.id,
      state.practicable.filter((question) => question.chapter === chapter.id),
    ])
  );
  state.salt = store.getShuffleSalt();
  state.booted = true;

  updateBrand();
  if (normalized.dropped.length > 0) {
    toast(`有 ${normalized.dropped.length} 道题格式不完整，已跳过`, { tone: 'error', duration: 4200 });
  }
  if (state.questions.length === 0) {
    toast('题库是空的，请检查 data/questions.json', { tone: 'error', duration: 5200 });
  }

  watchSystemTheme(() => {
    if (store.getSettings().theme === 'system') applyTheme('system');
  });

  document.querySelectorAll('[data-nav]').forEach((link) => {
    link.addEventListener('click', () => {
      // 点击当前页导航时也回到顶部
      if (link.getAttribute('href') === window.location.hash) render({ preserveScroll: false });
    });
  });

  window.addEventListener('hashchange', () => render());
  render();
}

boot();
