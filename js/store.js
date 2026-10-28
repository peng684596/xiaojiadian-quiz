/**
 * localStorage / sessionStorage 读写层。
 *
 * 键前缀统一 appq:（见 docs/SPEC.md 第 3 节）：
 *   appq:progress   { [questionId]: { seen, correct, wrong, lastSeen, level, due, reps, lapses } }
 *   appq:wrong      { [questionId]: { count, lastWrongAt, streak } }
 *   appq:favorites  string[]
 *   appq:settings   { shuffle, autoNext, theme, includeDup }
 *   appq:stats      { daily: { 'YYYY-MM-DD': { answered, correct } }, examHistory: [] }
 *   appq:session    sessionStorage：乱序 salt + 未完成考试状态
 *
 * 所有写入都 try/catch 兜底（隐私模式、配额满）。
 */

import { addDays, intervalForLevel, review, todayStr } from './srs.js';

export const PREFIX = 'appq:';
export const APP_VERSION = '1.0.0';
export const EXAM_HISTORY_LIMIT = 20;

const KEYS = {
  progress: `${PREFIX}progress`,
  wrong: `${PREFIX}wrong`,
  favorites: `${PREFIX}favorites`,
  settings: `${PREFIX}settings`,
  stats: `${PREFIX}stats`,
  session: `${PREFIX}session`,
};
export { KEYS };

const DEFAULT_SETTINGS = {
  shuffle: true,
  autoNext: false,
  theme: 'system', // system | light | dark
  includeDup: false,
};

function clone(value) {
  if (value === null || typeof value !== 'object') return value;
  try {
    return JSON.parse(JSON.stringify(value));
  } catch (err) {
    return Array.isArray(value) ? [] : {};
  }
}

function safeStorage(which) {
  try {
    return which === 'session' ? window.sessionStorage : window.localStorage;
  } catch (err) {
    return null;
  }
}

function readJSON(key, fallback, which = 'local') {
  const storage = safeStorage(which);
  if (!storage) return clone(fallback);
  try {
    const raw = storage.getItem(key);
    if (raw === null || raw === undefined || raw === '') return clone(fallback);
    const parsed = JSON.parse(raw);
    if (parsed === null || parsed === undefined) return clone(fallback);
    return parsed;
  } catch (err) {
    return clone(fallback);
  }
}

function writeJSON(key, value, which = 'local') {
  const storage = safeStorage(which);
  if (!storage) return false;
  try {
    storage.setItem(key, JSON.stringify(value));
    return true;
  } catch (err) {
    return false;
  }
}

function asObject(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

/* ------------------------------ settings ------------------------------ */

export function getSettings() {
  const raw = asObject(readJSON(KEYS.settings, {}));
  const theme = ['system', 'light', 'dark'].includes(raw.theme) ? raw.theme : DEFAULT_SETTINGS.theme;
  return {
    shuffle: typeof raw.shuffle === 'boolean' ? raw.shuffle : DEFAULT_SETTINGS.shuffle,
    autoNext: typeof raw.autoNext === 'boolean' ? raw.autoNext : DEFAULT_SETTINGS.autoNext,
    theme,
    includeDup: typeof raw.includeDup === 'boolean' ? raw.includeDup : DEFAULT_SETTINGS.includeDup,
  };
}

export function saveSettings(patch) {
  const next = { ...getSettings(), ...asObject(patch) };
  writeJSON(KEYS.settings, next);
  return next;
}

/* ------------------------------ progress ------------------------------ */

export function getProgress() {
  return asObject(readJSON(KEYS.progress, {}));
}

export function saveProgress(progress) {
  return writeJSON(KEYS.progress, asObject(progress));
}

/* -------------------------------- wrong ------------------------------- */

export function getWrong() {
  return asObject(readJSON(KEYS.wrong, {}));
}

export function saveWrong(wrong) {
  return writeJSON(KEYS.wrong, asObject(wrong));
}

/* ------------------------------ favorites ----------------------------- */

export function getFavorites() {
  return asArray(readJSON(KEYS.favorites, [])).filter((id) => typeof id === 'string');
}

export function saveFavorites(ids) {
  return writeJSON(KEYS.favorites, asArray(ids));
}

export function isFavorite(questionId) {
  return getFavorites().includes(questionId);
}

/** 切换收藏状态，返回切换后的状态（true = 已收藏） */
export function toggleFavorite(questionId) {
  const favorites = getFavorites();
  const idx = favorites.indexOf(questionId);
  if (idx >= 0) {
    favorites.splice(idx, 1);
    saveFavorites(favorites);
    return false;
  }
  favorites.push(questionId);
  saveFavorites(favorites);
  return true;
}

/* -------------------------------- stats ------------------------------- */

export function getStats() {
  const raw = asObject(readJSON(KEYS.stats, {}));
  return {
    daily: asObject(raw.daily),
    examHistory: asArray(raw.examHistory).filter((item) => item && typeof item === 'object'),
  };
}

export function saveStats(stats) {
  return writeJSON(KEYS.stats, {
    daily: asObject(stats && stats.daily),
    examHistory: asArray(stats && stats.examHistory).slice(0, EXAM_HISTORY_LIMIT),
  });
}

/** 追加一条考试成绩（最多保留 20 条） */
export function addExamRecord(record) {
  const stats = getStats();
  stats.examHistory.unshift({ ...asObject(record), at: record.at || new Date().toISOString() });
  stats.examHistory = stats.examHistory.slice(0, EXAM_HISTORY_LIMIT);
  saveStats(stats);
  return stats.examHistory;
}

/* ------------------------------- session ------------------------------ */

export function getSession() {
  const raw = asObject(readJSON(KEYS.session, {}, 'session'));
  return {
    salt: typeof raw.salt === 'string' ? raw.salt : '',
    exam: raw.exam && typeof raw.exam === 'object' ? raw.exam : null,
  };
}

export function saveSession(patch) {
  const next = { ...getSession(), ...asObject(patch) };
  writeJSON(KEYS.session, next, 'session');
  return next;
}

export function clearSession() {
  const storage = safeStorage('session');
  if (!storage) return;
  try {
    storage.removeItem(KEYS.session);
  } catch (err) {
    /* ignore */
  }
}

/** 本会话的确定性乱序盐：sessionStorage 里只生成一次 */
export function getShuffleSalt() {
  const session = getSession();
  if (session.salt) return session.salt;
  let salt = '';
  try {
    if (window.crypto && typeof window.crypto.getRandomValues === 'function') {
      const buf = new Uint32Array(2);
      window.crypto.getRandomValues(buf);
      salt = buf[0].toString(16) + buf[1].toString(16);
    }
  } catch (err) {
    salt = '';
  }
  if (!salt) salt = String(Math.random()).slice(2) + String(Date.now());
  saveSession({ salt });
  return salt;
}

/* ----------------------------- answer record -------------------------- */

/**
 * 记录一道题的作答：练习进度 + SRS + 每日统计 + 错题本。
 *
 * @param {string} questionId
 * @param {boolean} correct
 * @param {{source?: string, now?: Date, date?: string}} [options]
 * @returns {{progress: Object, wrong: Object|null, streak: number}}
 */
export function recordAnswer(questionId, correct, options = {}) {
  const now = options.now instanceof Date ? options.now : new Date();
  const today = options.date || todayStr(now);
  const iso = now.toISOString();

  // 1) 练习进度 + SRS
  const progress = getProgress();
  const prev = asObject(progress[questionId]);
  const srsState = review(prev, correct, today);
  progress[questionId] = {
    seen: (Number(prev.seen) || 0) + 1,
    correct: (Number(prev.correct) || 0) + (correct ? 1 : 0),
    wrong: (Number(prev.wrong) || 0) + (correct ? 0 : 1),
    lastSeen: iso,
    level: srsState.level,
    due: srsState.due,
    reps: srsState.reps,
    lapses: srsState.lapses,
  };
  saveProgress(progress);

  // 2) 每日答题统计
  const stats = getStats();
  const day = asObject(stats.daily[today]);
  stats.daily[today] = {
    answered: (Number(day.answered) || 0) + 1,
    correct: (Number(day.correct) || 0) + (correct ? 1 : 0),
  };
  saveStats(stats);

  // 3) 错题本：答错进本并重置连续答对；答对时只累计 streak，不自动移出
  const wrong = getWrong();
  let entry = wrong[questionId] || null;
  if (correct) {
    if (entry) {
      entry = { ...entry, streak: (Number(entry.streak) || 0) + 1 };
      wrong[questionId] = entry;
      saveWrong(wrong);
    }
  } else {
    entry = {
      count: (Number(entry && entry.count) || 0) + 1,
      lastWrongAt: iso,
      streak: 0,
    };
    wrong[questionId] = entry;
    saveWrong(wrong);
  }

  return { progress: progress[questionId], wrong: entry, streak: Number(entry && entry.streak) || 0 };
}

/** 把题目从错题本移出（已掌握） */
export function markMastered(questionId) {
  const wrong = getWrong();
  if (!wrong[questionId]) return false;
  delete wrong[questionId];
  saveWrong(wrong);
  return true;
}

export function clearWrongBook() {
  saveWrong({});
}

/* ------------------------------ statistics ---------------------------- */

/** 逐日统计序列（从旧到新），days 天 */
export function dailySeries(days = 14, today = todayStr()) {
  const { daily } = getStats();
  const series = [];
  for (let i = days - 1; i >= 0; i -= 1) {
    const date = addDays(today, -i);
    const entry = asObject(daily[date]);
    series.push({
      date,
      label: date.slice(5),
      answered: Number(entry.answered) || 0,
      correct: Number(entry.correct) || 0,
    });
  }
  return series;
}

/** 累计答题数与正确率 */
export function totalStats(today = todayStr()) {
  const { daily } = getStats();
  let answered = 0;
  let correct = 0;
  for (const key of Object.keys(daily)) {
    const entry = asObject(daily[key]);
    answered += Number(entry.answered) || 0;
    correct += Number(entry.correct) || 0;
  }
  return {
    answered,
    correct,
    accuracy: answered > 0 ? correct / answered : 0,
    days: Object.keys(daily).length,
  };
}

/**
 * 连续打卡：当天有任一答题记录算打卡；今天还没答题时从昨天往前算。
 * @param {Object} daily appq:stats.daily
 * @param {string} [today]
 * @returns {{current:number, longest:number, activeDays:number}}
 */
export function computeStreaks(daily, today = todayStr()) {
  const active = new Set(
    Object.keys(asObject(daily)).filter((date) => {
      const entry = asObject(daily[date]);
      return (Number(entry.answered) || 0) > 0;
    })
  );
  const sorted = Array.from(active).sort();
  let longest = 0;
  let run = 0;
  let prev = null;
  for (const date of sorted) {
    if (prev && addDays(prev, 1) === date) run += 1;
    else run = 1;
    if (run > longest) longest = run;
    prev = date;
  }
  let current = 0;
  let cursor = active.has(today) ? today : addDays(today, -1);
  while (active.has(cursor)) {
    current += 1;
    cursor = addDays(cursor, -1);
  }
  return { current, longest, activeDays: active.size };
}

export function currentStreaks(today = todayStr()) {
  return computeStreaks(getStats().daily, today);
}

/* ----------------------------- import/export -------------------------- */

/** 导出全部本地数据（用于设置页下载 JSON） */
export function exportAll() {
  return {
    schema: 'appq-backup',
    version: 1,
    appVersion: APP_VERSION,
    exportedAt: new Date().toISOString(),
    progress: getProgress(),
    wrong: getWrong(),
    favorites: getFavorites(),
    settings: getSettings(),
    stats: getStats(),
  };
}

/**
 * 导入 JSON 备份。返回 { progressCount, wrongCount, favoriteCount }。
 * 数据不合法时抛出 Error。
 */
export function importAll(payload) {
  let data = payload;
  if (typeof data === 'string') {
    try {
      data = JSON.parse(data);
    } catch (err) {
      throw new Error('文件不是合法的 JSON');
    }
  }
  if (!data || typeof data !== 'object' || Array.isArray(data)) {
    throw new Error('备份格式不正确');
  }
  if (data.schema !== undefined && data.schema !== 'appq-backup') {
    throw new Error('不是本网站的备份文件');
  }
  const progress = asObject(data.progress);
  const wrong = asObject(data.wrong);
  const favorites = asArray(data.favorites).filter((id) => typeof id === 'string');
  const settings = asObject(data.settings);
  const stats = asObject(data.stats);
  if (!data.progress && !data.wrong && !data.favorites && !data.stats && !data.settings) {
    throw new Error('备份文件里没有可导入的数据');
  }

  writeJSON(KEYS.progress, progress);
  writeJSON(KEYS.wrong, wrong);
  writeJSON(KEYS.favorites, favorites);
  writeJSON(KEYS.stats, {
    daily: asObject(stats.daily),
    examHistory: asArray(stats.examHistory).slice(0, EXAM_HISTORY_LIMIT),
  });
  if (Object.keys(settings).length > 0) {
    saveSettings(settings);
  }

  return {
    progressCount: Object.keys(progress).length,
    wrongCount: Object.keys(wrong).length,
    favoriteCount: favorites.length,
  };
}

/** 清空本站全部本地数据（保留其他站点数据） */
export function resetAll() {
  const local = safeStorage('local');
  if (local) {
    try {
      const remove = [];
      for (let i = 0; i < local.length; i += 1) {
        const key = local.key(i);
        if (key && key.startsWith(PREFIX)) remove.push(key);
      }
      remove.forEach((key) => local.removeItem(key));
    } catch (err) {
      /* ignore */
    }
  }
  clearSession();
}

/** 供设置页展示：每 level 对应的下一次间隔文案 */
export function intervalLabel(level) {
  return `${intervalForLevel(level)} 天`;
}
