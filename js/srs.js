/**
 * 记忆曲线调度（SM-2 lite）
 *
 * 每题的状态保存在 appq:progress[questionId] 中，字段：
 *   { level: 0..5, due: 'YYYY-MM-DD', lastSeen: ISO, reps, lapses }
 *
 * 规则（见 docs/SPEC.md 2.6）：
 *   - 间隔表 [1, 2, 4, 7, 15, 30] 天
 *   - 答对：level = min(level + 1, 5)，due = 今天 + 间隔[level]
 *   - 答错：level = 0，due = 今天（当天即可重练）
 *   - 新题（从未作答）不进复习队列
 */

export const INTERVALS = [1, 2, 4, 7, 15, 30];
export const MAX_LEVEL = INTERVALS.length - 1;

/** 两位补零 */
function pad2(n) {
  return String(n).padStart(2, '0');
}

/**
 * 本地时区的 YYYY-MM-DD（不能用 toISOString，那是 UTC，会跨时区错日期）。
 * @param {Date} [date]
 */
export function todayStr(date = new Date()) {
  return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`;
}

/** 把 Date 转成 ISO 字符串（失败时退化为当前时间字符串） */
export function toISO(date = new Date()) {
  try {
    return date.toISOString();
  } catch (err) {
    return new Date().toISOString();
  }
}

/**
 * 在 YYYY-MM-DD 上加减天数，返回 YYYY-MM-DD。
 * @param {string} dateStr
 * @param {number} days
 */
export function addDays(dateStr, days) {
  const [y, m, d] = String(dateStr).split('-').map(Number);
  if (!y || !m || !d) return todayStr();
  const dt = new Date(y, m - 1, d + days);
  return todayStr(dt);
}

/** 间隔表查值（level 越界时收敛到合法区间） */
export function intervalForLevel(level) {
  const idx = Math.max(0, Math.min(Number(level) || 0, MAX_LEVEL));
  return INTERVALS[idx];
}

/** 新建一道题的 SRS 状态 */
export function createState(today = todayStr()) {
  return { level: 0, due: today, reps: 0, lapses: 0 };
}

/**
 * 根据一次作答结果推进 SRS 状态。
 * 注意：答对时先 +1 再取间隔（与 SPEC 公式一致），首次答对进入 level 1。
 *
 * @param {{level?:number, reps?:number, lapses?:number}} state
 * @param {boolean} correct
 * @param {string} [today]
 * @returns {{level:number, due:string, reps:number, lapses:number}}
 */
export function review(state, correct, today = todayStr()) {
  const base = {
    level: Math.max(0, Math.min(Number(state && state.level) || 0, MAX_LEVEL)),
    reps: Math.max(0, Number(state && state.reps) || 0),
    lapses: Math.max(0, Number(state && state.lapses) || 0),
  };
  if (correct) {
    const level = Math.min(base.level + 1, MAX_LEVEL);
    return {
      level,
      due: addDays(today, intervalForLevel(level)),
      reps: base.reps + 1,
      lapses: base.lapses,
    };
  }
  return {
    level: 0,
    due: today,
    reps: base.reps + 1,
    lapses: base.lapses + 1,
  };
}

/** 该题今天是否到期（due <= 今天，字符串可直接比较） */
export function isDue(entry, today = todayStr()) {
  if (!entry || !entry.due) return false;
  return String(entry.due) <= today;
}

/** 复习队列排序：先 level 低的，再 due 升序，最后按 id 稳定排序 */
export function compareForReview(progress) {
  return function (a, b) {
    const pa = progress[a.id] || {};
    const pb = progress[b.id] || {};
    const la = Number(pa.level) || 0;
    const lb = Number(pb.level) || 0;
    if (la !== lb) return la - lb;
    const da = String(pa.due || '9999-12-31');
    const db = String(pb.due || '9999-12-31');
    if (da !== db) return da < db ? -1 : 1;
    return String(a.id).localeCompare(String(b.id));
  };
}

/**
 * 从当前进度里筛出今日到期的题目并排序。
 * @param {Array} questions
 * @param {Object} progress
 * @param {string} [today]
 */
export function reviewQueue(questions, progress, today = todayStr()) {
  return questions
    .filter((q) => progress && progress[q.id] && isDue(progress[q.id], today))
    .sort(compareForReview(progress));
}

/** 今日待复习数量（只统计题库中仍存在的题） */
export function dueCount(questions, progress, today = todayStr()) {
  let n = 0;
  for (const q of questions) {
    const entry = progress && progress[q.id];
    if (entry && isDue(entry, today)) n += 1;
  }
  return n;
}

/**
 * 按 level 0..5 统计题量（只统计已作答过的题）。
 * @param {Object} progress
 * @param {Array} [questions] 传入时只统计题库中仍存在的题
 * @returns {number[]} 长度 6
 */
export function levelCounts(progress, questions = null) {
  const counts = [0, 0, 0, 0, 0, 0];
  const ids = questions ? questions.map((q) => q.id) : Object.keys(progress || {});
  for (const id of ids) {
    const entry = progress && progress[id];
    if (!entry || !entry.seen) continue;
    const level = Math.max(0, Math.min(Number(entry.level) || 0, MAX_LEVEL));
    counts[level] += 1;
  }
  return counts;
}
