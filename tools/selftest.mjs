import { readFileSync } from 'node:fs';
import {
  isCorrect, prepareOptions, answerDisplay, selectionDisplay,
  isPracticable, practicablePool, filterPool, sampleExam,
  buildPracticeQueue, typeBreakdown, allocateQuotas, seededShuffle,
} from '../js/quiz.js';

const raw = JSON.parse(readFileSync(new URL('../data/questions.json', import.meta.url), 'utf8'));

// 复刻 app.js 的 flag 归一（flags 数组 -> 站内 flag）
const FLAG_BY_MARK = {
  broken: 'broken', 'answer-key-missing': 'review', 'no-answer': 'review',
  'single-multi-answer': 'review', 'multi-single-answer': 'review',
  'type-mismatch': 'review', 'image-missing': 'review', figure: 'figure',
};
function normalizeFlag(q) {
  const marks = Array.isArray(q.flags) ? q.flags : [];
  let out = null;
  for (const m of marks) {
    const mapped = FLAG_BY_MARK[m];
    if (mapped === 'broken') return 'broken';
    if (mapped) out = mapped;
  }
  return out;
}

const questions = raw.questions.map((q) => ({ ...q, flag: normalizeFlag(q) }));
const meta = raw.meta;

const problems = [];
function check(name, cond, extra = '') {
  if (!cond) problems.push(`${name} ${extra}`);
}

// 1. 总量
check('total', questions.length === meta.total, `${questions.length} vs ${meta.total}`);
const usable = questions.filter((q) => !q.dupOf && q.flag !== 'broken');
check('activeTotal', usable.length === meta.activeTotal, `${usable.length} vs ${meta.activeTotal}`);
check('practicablePool', practicablePool(questions).length === usable.length);

// 2. 选项/答案完整性（可练题）
for (const q of usable) {
  check(`opts:${q.id}`, q.options.length >= 2, `${q.options.length}`);
  const keys = new Set(q.options.map((o) => o.key));
  for (const a of q.answer) check(`ans-in-opts:${q.id}`, keys.has(a), a);
  // 单选题只允许一个答案；原卷把双答案题印进单选段的，已在数据里标 single-multi-answer
  if (q.type === 'single' && !(q.flags || []).includes('single-multi-answer')) {
    check(`single-1ans:${q.id}`, q.answer.length === 1, q.answer.join(','));
  }
  if (q.type === 'judge') check(`judge-keys:${q.id}`, q.options.length === 2 && ['T', 'F'].includes(q.answer[0]), q.answer.join(','));
}

// 3. 题型分布
const byType = {};
for (const q of usable) byType[q.type] = (byType[q.type] || 0) + 1;
check('types', JSON.stringify(byType) === JSON.stringify(meta.types), `${JSON.stringify(byType)} vs ${JSON.stringify(meta.types)}`);

// 4. 判分
check('judge-correct', isCorrect({ type: 'judge', answer: ['T'] }, ['T']) === true);
check('judge-wrong', isCorrect({ type: 'judge', answer: ['T'] }, ['F']) === false);
check('single-correct', isCorrect({ type: 'single', answer: ['B'] }, ['B']) === true);
check('multi-full', isCorrect({ type: 'multi', answer: ['A', 'B', 'C'] }, ['C', 'A', 'B']) === true);
check('multi-miss', isCorrect({ type: 'multi', answer: ['A', 'B', 'C'] }, ['A', 'B']) === false);
check('multi-extra', isCorrect({ type: 'multi', answer: ['A', 'B'] }, ['A', 'B', 'C']) === false);

// 5. 乱序确定性
const s1 = prepareOptions(usable[0], 'salt', true);
const s2 = prepareOptions(usable[0], 'salt', true);
check('shuffle-deterministic', JSON.stringify(s1) === JSON.stringify(s2));
const s3 = prepareOptions(usable[0], 'other', true);
check('shuffle-salted', JSON.stringify(s1) !== JSON.stringify(s3));
// 判断题不乱序
const judge = usable.find((q) => q.type === 'judge');
const j = prepareOptions(judge, 'salt', true);
check('judge-order', j.map((o) => o.key).join('') === judge.options.map((o) => o.key).join(''), j.map((o) => o.key).join(''));
// 乱序后答案字母正确映射
const multi = usable.find((q) => q.type === 'multi' && q.answer.length === 2);
const prep = prepareOptions(multi, 'x', true);
const shown = answerDisplay(prep, multi);
const expected = prep.filter((o) => multi.answer.includes(o.key)).map((o) => o.display).sort().join('');
check('answerDisplay', shown === expected, `${shown} vs ${expected}`);
check('selectionDisplay', selectionDisplay(prep, multi.answer, multi) === expected);

// 6. 章节计数
const chapterCount = {};
for (const q of usable) chapterCount[q.chapter] = (chapterCount[q.chapter] || 0) + 1;
for (const ch of raw.chapters) {
  check(`chapter-count:${ch.id}`, (chapterCount[ch.id] || 0) === ch.count, `${chapterCount[ch.id] || 0} vs ${ch.count}`);
}
const totalChapter = raw.chapters.reduce((a, c) => a + c.total, 0);
check('chapter-total', totalChapter === meta.total, `${totalChapter} vs ${meta.total}`);

// 7. 出题队列 / 考试抽样
const q1 = buildPracticeQueue({ questions, chapterId: 'c1' });
check('queue-c1', q1.length === raw.chapters.find((c) => c.id === 'c1').count, `${q1.length}`);
const q2 = buildPracticeQueue({ questions, chapterId: 'c1', includeDup: true });
check('queue-c1-dup', q2.length === raw.chapters.find((c) => c.id === 'c1').total, `${q2.length}`);
const exam = sampleExam(usable, 100, 'seed');
check('exam-100', exam.length === 100, `${exam.length}`);
const examIds = new Set(exam.map((x) => x.id));
check('exam-unique', examIds.size === 100);
check('exam-excludes-broken', exam.every((x) => x.flag !== 'broken'));

// 8. 图片题
const figs = usable.filter((q) => q.flag === 'figure');
check('figure-count', figs.length === meta.figureCount, `${figs.length} vs ${meta.figureCount}`);
for (const f of figs) check(`fig-images:${f.id}`, Array.isArray(f.images) && f.images.length > 0);

// 9. broken 题
const broken = questions.filter((q) => q.flag === 'broken');
check('broken-count', broken.length === meta.brokenCount, `${broken.length} vs ${meta.brokenCount}`);
check('broken-excluded', filterPool(questions).every((q) => q.flag !== 'broken'));

// 10. 重复题
const dups = questions.filter((q) => q.dupOf);
check('dup-count', dups.length === meta.dupCount, `${dups.length} vs ${meta.dupCount}`);

// 11. 序列化
const ser = JSON.stringify(questions[0]);
check('serializable', typeof ser === 'string');

console.log(`checked ${questions.length} questions / ${raw.chapters.length} chapters`);
if (problems.length === 0) {
  console.log('ALL OK');
} else {
  console.log(`PROBLEMS (${problems.length}):`);
  for (const p of problems.slice(0, 40)) console.log('  ' + p);
  process.exitCode = 1;
}
