/**
 * 出题队列、选项乱序、判分。
 *
 * 关键约定（见 docs/SPEC.md 第 1 节）：
 *   - single / judge：所选 key 集合与 answer 集合完全相等才算对
 *   - multi：全对才给分，漏选或多选一律判错（没有任何部分分）
 *   - 选项乱序只对 single / multi 生效，judge 永远不乱序
 *   - 乱序必须确定性：seed = hash(question.id + shuffleSalt)
 *   - 乱序后显示字母按位置重新编号，判分映射回原始 key
 */

import { compareForReview, isDue, todayStr } from './srs.js';

export const TYPE_LABEL = {
  single: '单选题',
  multi: '多选题',
  judge: '判断题',
};

export function typeLabel(type) {
  return TYPE_LABEL[type] || '题目';
}

export const FLAG_LABEL = {
  review: '待复核',
  'ai-answer': 'AI 补答案',
  figure: '含配图',
  broken: '已损坏',
};

/** 题库数据标记的展示文案；正常题为空字符串 */
export function flagLabel(flag) {
  return FLAG_LABEL[flag] || '';
}

/** 答案 key 排序，便于比较 */
export function normalizeKeys(keys) {
  if (!keys) return [];
  return (Array.isArray(keys) ? keys : [keys])
    .filter((key) => key !== null && key !== undefined)
    .map((key) => String(key))
    .sort();
}

/** 判分：所选原始 key 集合与正确答案集合完全相等 */
export function isCorrect(question, selectedKeys) {
  if (!question || !Array.isArray(question.answer)) return false;
  const correct = normalizeKeys(question.answer);
  const selected = normalizeKeys(selectedKeys);
  if (correct.length === 0 || selected.length !== correct.length) return false;
  for (let i = 0; i < correct.length; i += 1) {
    if (correct[i] !== selected[i]) return false;
  }
  return true;
}

/* --------------------------- 确定性洗牌 ---------------------------- */

/** xmur3 变体：把字符串散列成 32 位无符号整数 */
export function hashString(str) {
  const text = String(str);
  let h = 1779033703 ^ text.length;
  for (let i = 0; i < text.length; i += 1) {
    h = Math.imul(h ^ text.charCodeAt(i), 3432918353);
    h = (h << 13) | (h >>> 19);
  }
  h = Math.imul(h ^ (h >>> 16), 2246822507);
  h = Math.imul(h ^ (h >>> 13), 3266489909);
  h ^= h >>> 16;
  return h >>> 0;
}

/** mulberry32 伪随机数生成器 */
export function mulberry32(seed) {
  let a = seed >>> 0;
  return function next() {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** 用给定随机源做 Fisher-Yates 洗牌（返回新数组） */
export function shuffleWith(rand, list) {
  const arr = list.slice();
  for (let i = arr.length - 1; i > 0; i -= 1) {
    const j = Math.floor(rand() * (i + 1));
    const tmp = arr[i];
    arr[i] = arr[j];
    arr[j] = tmp;
  }
  return arr;
}

/** 确定性洗牌：同一个 seed 永远得到同一个顺序 */
export function seededShuffle(list, seed) {
  return shuffleWith(mulberry32(hashString(seed)), list);
}

/**
 * 生成一道题的显示选项（含乱序映射）。
 * @param {Object} question
 * @param {string} [salt] 会话级乱序盐
 * @param {boolean} [shuffleEnabled]
 * @returns {Array<{key:string,text:string,display:string}>} key 为原始 key，display 为显示字母
 */
export function prepareOptions(question, salt = '', shuffleEnabled = true) {
  const options = Array.isArray(question && question.options) ? question.options : [];
  const source = options.map((opt) => ({ key: String(opt.key), text: opt.text }));
  const canShuffle = shuffleEnabled && question.type !== 'judge' && source.length > 1;
  const ordered = canShuffle ? seededShuffle(source, `${question.id}|${salt}`) : source;
  return ordered.map((opt, index) => ({
    key: opt.key,
    text: opt.text,
    display: question.type === 'judge' ? opt.key : String.fromCharCode(65 + index),
  }));
}

/**
 * 正确答案的展示文案：乱序后返回显示字母（如 "AC"），判断题返回“正确/错误”。
 * @param {Array<{key:string,text:string,display:string}>} prepared
 * @param {Object} question
 */
export function answerDisplay(prepared, question) {
  if (!question) return '';
  if (question.type === 'judge') {
    const key = normalizeKeys(question.answer)[0];
    const options = Array.isArray(question.options) ? question.options : [];
    const found = options.find((opt) => String(opt.key) === key);
    return found ? found.text : key || '';
  }
  const keys = new Set(normalizeKeys(question.answer));
  const letters = prepared.filter((opt) => keys.has(opt.key)).map((opt) => opt.display);
  return letters.sort().join('');
}

/**
 * 当前选择对应的显示字母（用于“你的答案”文案）。
 * @param {Array} prepared
 * @param {string[]} selectedKeys 原始 key 数组
 * @param {Object} question
 */
export function selectionDisplay(prepared, selectedKeys, question) {
  if (!question) return '未作答';
  if (question.type === 'judge') {
    if (!selectedKeys || selectedKeys.length === 0) return '未作答';
    const options = Array.isArray(question.options) ? question.options : [];
    const found = options.find((opt) => String(opt.key) === normalizeKeys(selectedKeys)[0]);
    return found ? found.text : String(selectedKeys[0]);
  }
  const selected = new Set(normalizeKeys(selectedKeys));
  const letters = prepared.filter((opt) => selected.has(opt.key)).map((opt) => opt.display);
  return letters.length > 0 ? letters.sort().join('') : '未作答';
}

/* ------------------------------ 出题队列 ----------------------------- */

/**
 * 是否属于“可练题池”：非重复题，且不是损坏题。
 * 全站所有计数（首页、章节、统计、复习）都以此为准，避免口径不一。
 */
export function isPracticable(question) {
  return !!question && !question.dupOf && question.flag !== 'broken';
}

/** 可练题池（已排除重复题与损坏题），与 includeDup 设置无关 */
export function practicablePool(questions) {
  return (Array.isArray(questions) ? questions : []).filter(isPracticable);
}

/** 过滤题库：章节 + 是否包含重复题（broken 题永远排除，无开关） */
export function filterPool(questions, { chapterId = null, chapterIds = null, includeDup = false } = {}) {
  const wanted = chapterIds && chapterIds.length > 0 ? new Set(chapterIds) : null;
  return questions.filter((q) => {
    if (q.flag === 'broken') return false;
    if (!includeDup && q.dupOf) return false;
    if (wanted) return wanted.has(q.chapter);
    if (chapterId && chapterId !== 'all') return q.chapter === chapterId;
    return true;
  });
}

/**
 * 构建练习队列。
 *
 * @param {Object} opts
 * @param {Array} opts.questions 全部题目
 * @param {string} [opts.chapterId]
 * @param {'all'|'wrong'|'favorite'|'review'} [opts.scope]
 * @param {Object} [opts.wrong] 错题本
 * @param {string[]} [opts.favorites] 收藏 id
 * @param {Object} [opts.progress] 进度（含 SRS）
 * @param {boolean} [opts.includeDup]
 * @param {boolean} [opts.shuffle] 是否需要乱序题目顺序
 * @param {string} [opts.salt]
 * @param {string} [opts.today]
 * @returns {Array} 题目数组
 */
export function buildPracticeQueue(opts) {
  const {
    questions,
    chapterId = null,
    scope = 'all',
    wrong = {},
    favorites = [],
    progress = {},
    includeDup = false,
    shuffle = false,
    salt = '',
    today = todayStr(),
  } = opts || {};

  let pool = filterPool(questions, { chapterId, includeDup });

  if (scope === 'wrong') {
    pool = pool.filter((q) => !!wrong[q.id]);
    pool.sort((a, b) => {
      const ta = String((wrong[a.id] && wrong[a.id].lastWrongAt) || '');
      const tb = String((wrong[b.id] && wrong[b.id].lastWrongAt) || '');
      return tb.localeCompare(ta);
    });
  } else if (scope === 'favorite') {
    const favSet = new Set(favorites);
    const order = new Map(favorites.map((id, index) => [id, index]));
    pool = pool.filter((q) => favSet.has(q.id));
    pool.sort((a, b) => (order.get(a.id) || 0) - (order.get(b.id) || 0));
  } else if (scope === 'review') {
    // 复习顺序由 SPEC 固定：先 level 低的，再按 due 升序
    pool = pool.filter((q) => progress[q.id] && isDue(progress[q.id], today));
    pool.sort(compareForReview(progress));
    return pool;
  }

  if (shuffle && scope !== 'review') {
    pool = seededShuffle(pool, `${salt}|${scope}|${chapterId || 'all'}`);
  }
  return pool;
}

/* ------------------------------ 模拟抽题 ----------------------------- */

/**
 * 按题型比例分配题量，并尽量保证每种存在的题型至少一道。
 * @param {string[]} types 存在的题型
 * @param {Object} counts { single: n, multi: n, judge: n }
 * @param {number} total 目标题量
 * @returns {Object} 各题型配额
 */
export function allocateQuotas(types, counts, total) {
  const quotas = {};
  types.forEach((type) => {
    quotas[type] = 0;
  });
  if (total <= 0 || types.length === 0) return quotas;
  const poolSize = types.reduce((sum, type) => sum + counts[type], 0);
  if (poolSize <= 0) return quotas;
  const target = Math.min(total, poolSize);

  let assigned = 0;
  const fractions = [];
  for (const type of types) {
    const exact = (target * counts[type]) / poolSize;
    const base = Math.min(Math.floor(exact), counts[type]);
    quotas[type] = base;
    assigned += base;
    fractions.push([type, exact - base]);
  }
  fractions.sort((a, b) => b[1] - a[1]);

  // 最大余数法补足
  let remaining = target - assigned;
  let guard = 0;
  while (remaining > 0 && guard < 10000) {
    let placed = false;
    for (const [type] of fractions) {
      if (remaining > 0 && quotas[type] < counts[type]) {
        quotas[type] += 1;
        remaining -= 1;
        placed = true;
      }
    }
    guard += 1;
    if (!placed) break;
  }

  // 保证每种存在的题型至少一道（题量足够时）
  if (target >= types.length) {
    for (const type of types) {
      if (quotas[type] >= 1) continue;
      let donor = null;
      for (const other of types) {
        if (other === type) continue;
        if (quotas[other] >= 2 && (donor === null || quotas[other] > quotas[donor])) donor = other;
      }
      // 上面循环里 other===type 已跳过，donor 不会是自己
      if (donor) {
        quotas[donor] -= 1;
        quotas[type] = 1;
      }
    }
  }

  // 数量兜底：补满 / 裁掉
  let sum = types.reduce((acc, type) => acc + quotas[type], 0);
  while (sum < target) {
    let added = false;
    for (const type of types) {
      if (quotas[type] < counts[type]) {
        quotas[type] += 1;
        sum += 1;
        added = true;
        if (sum >= target) break;
      }
    }
    if (!added) break;
  }
  while (sum > target) {
    let trimmed = false;
    for (const type of types) {
      if (quotas[type] > 1 || types.length > target) {
        quotas[type] -= 1;
        sum -= 1;
        trimmed = true;
        if (sum <= target) break;
      }
    }
    if (!trimmed) break;
  }
  return quotas;
}

/**
 * 模拟考试抽题：范围内按题型比例抽取，并尽量保证单选、多选、判断都有。
 * @param {Array} pool 范围内题目（已过滤重复题）
 * @param {number|'all'} requestedCount
 * @param {string} seed 种子（salt + 考试 id），保证同一次考试可复现
 * @returns {Array} 按考试顺序排列的题目
 */
export function sampleExam(pool, requestedCount, seed = '') {
  const questions = Array.isArray(pool) ? pool : [];
  const target =
    requestedCount === 'all' || requestedCount === Infinity
      ? questions.length
      : Math.max(0, Math.floor(Number(requestedCount) || 0));
  const total = Math.min(target, questions.length);
  if (total <= 0) return [];

  const groups = new Map();
  for (const question of questions) {
    const type = TYPE_LABEL[question.type] ? question.type : 'single';
    if (!groups.has(type)) groups.set(type, []);
    groups.get(type).push(question);
  }
  const types = ['single', 'multi', 'judge'].filter((type) => groups.has(type));
  const counts = {};
  types.forEach((type) => {
    counts[type] = groups.get(type).length;
  });

  const quotas = allocateQuotas(types, counts, total);
  const picked = [];
  for (const type of types) {
    const shuffledGroup = seededShuffle(groups.get(type), `${seed}|${type}`);
    picked.push(...shuffledGroup.slice(0, quotas[type]));
  }
  // 防御：极端情况下配额总和不足目标，从剩余题里补齐
  if (picked.length < total) {
    const pickedIds = new Set(picked.map((question) => question.id));
    const rest = seededShuffle(
      questions.filter((question) => !pickedIds.has(question.id)),
      `${seed}|rest`
    );
    picked.push(...rest.slice(0, total - picked.length));
  }
  return seededShuffle(picked, `${seed}|order`);
}

/** 题型拆分统计：用于考试结果页 */
export function typeBreakdown(records) {
  const result = {
    single: { total: 0, correct: 0 },
    multi: { total: 0, correct: 0 },
    judge: { total: 0, correct: 0 },
  };
  for (const record of records || []) {
    const bucket = result[record.question && record.question.type];
    if (!bucket) continue;
    bucket.total += 1;
    if (record.correct) bucket.correct += 1;
  }
  return result;
}
