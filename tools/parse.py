# -*- coding: utf-8 -*-
"""PDF -> 结构化题库 JSON（2024 小型家用电器制造工 决赛理论题库）。

解析管线：
  1. vlines      逐页抽文本，按视觉行（spans 按 y 聚类、按 x 排序）重组，
                 顺带把上标 span 转成 Unicode 上标（1.6×10⁻¹⁹C）
  2. clean_lines 剔页眉页脚、附件号、Wingdings 私用区 √
  3. parse       按题号 / 选项 / 答案行分块，容忍跨页续行
  4. finalize    抽答案（题干括注 / 答案行），打质量标记
  5. repair      修排版缺陷、判定图片题
  6. build       生成站点用的 data/questions.json
"""
import json
import re
import sys
from collections import Counter

import pymupdf

PDF = (r"C:\Users\peng1\Documents\xwechat_files\wxid_b5uxo7um52ok22_2cf8"
       r"\msg\file\2026-10\24小家电理论题库.pdf")

# ---------------------------------------------------------------- 版面清洗
SUP_MAP = str.maketrans("0123456789-+", "⁰¹²³⁴⁵⁶⁷⁸⁹⁻⁺")
BODY_SIZE = 10.4          # 正文字号；小于它的 span 视为上标
JUNK_PREFIX = ("全国工业", "试题库", "理论试题库", "职业技能大赛")
JUNK_RE = re.compile(r"^\s*-\s*\d+\s*-\s*$|^附件\s*\d+$|^题库的答案仅供参考")
JUNK_SPAN_RE = re.compile(r"^\s*-\s*\d+\s*-\s*$|^附件\s*\d+|^题库的答案仅供参考")


def is_junk(s):
    """页眉页脚脏串判定。span 级和行级共用同一套规则。"""
    s = s.strip()
    if not s:
        return True
    if JUNK_SPAN_RE.match(s):
        return True
    return any(s.startswith(p) for p in JUNK_PREFIX)

SEC_RE = re.compile(r"^([一二三四五六七八九十]+)、(.+?)\s*$")
# 题号行：数字 + . 或 、 开头。不能加 (?!\d) 排除小数——本题库有 "1126.1mA…"
# "1137.5S 管理…" 这种题号后紧跟数字的题，只能靠「题号严格递增」来区分正文。
NUM_RE = re.compile(r"^(\d{1,4})\s*[.、．]\s*(.*)$")
OPT_RE = re.compile(r"^([A-D])\s*[.、．]?\s*(.*)$")
# 一行里并排多个选项（"A. 85 B. 90"）
OPT_INLINE_RE = re.compile(r"(?<![A-Za-z0-9])([A-D])\s*[.、．]\s*")
ANS_RE = re.compile(r"^答案[:：]\s*(.*)$")
INLINE_OBJ_RE = re.compile(r"[（(]\s*([A-D])\s*[.、．]?\s*[）)]\s*[。.．]?\s*$")
INLINE_ANY_RE = re.compile(r"[（(]\s*([A-D])\s*[.、．]?\s*[）)]")
INLINE_SYM_RE = re.compile(r"[（(]\s*([√×✓✗])\s*[）)]")
INLINE_WORD_RE = re.compile(r"[（(]\s*(正确|错误|对|错)\s*[）)]")

JUDGE_TRUE = ("正确", "对", "√", "✓")
JUDGE_FALSE = ("错误", "错", "×", "✗")


# --------------------------------------------------------------------------
# 1. 视觉行
# --------------------------------------------------------------------------
def vlines(page):
    """把一页的 spans 重排成按视觉顺序的文本行。

    PyMuPDF 的 block/line 顺序在跨页图注处会错位（1114 的符号在下一页顶部），
    只有按 bbox 的 y 聚类、行内按 x 排序才能拿到真实阅读顺序。
    """
    spans = []
    for blk in page.get_text("dict")["blocks"]:
        if blk["type"] != 0:
            continue
        for ln in blk["lines"]:
            for sp in ln["spans"]:
                if not sp["text"].strip():
                    continue
                # 页眉页脚在部分页与正文挤在同一视觉行（如 p5 的「19xxx…
                # 全国工业设计职业技能大赛理论试题库」），必须在 span 级就剔掉，
                # 否则整行过滤不掉、脏字会拼进题干。
                if is_junk(sp["text"]):
                    continue
                x0, y0, x1, y1 = sp["bbox"]
                spans.append(((y0 + y1) / 2, x0, x1, sp["size"], sp["text"]))
    spans.sort()

    groups = []
    for cy, x0, x1, size, txt in spans:
        if groups and abs(groups[-1][0] - cy) <= 3.5:
            groups[-1][1].append((x0, x1, size, txt))
            groups[-1][0] = (groups[-1][0] + cy) / 2
        else:
            groups.append([cy, [(x0, x1, size, txt)]])

    out = []
    for _cy, items in groups:
        items.sort()
        buf, prev = "", None
        for x0, x1, size, txt in items:
            if prev is not None and x0 - prev > 4:
                buf += " "
            # 上标：非行首、字号明显小于正文
            buf += txt.translate(SUP_MAP) if (prev is not None and size < 9.0) else txt
            prev = x1
        line = buf.strip()
        if line:
            out.append(line)
    return out


def clean_lines(doc):
    out = []
    for i in range(doc.page_count):
        for s in vlines(doc[i]):
            if JUNK_RE.match(s):
                continue
            if any(s.startswith(p) for p in JUNK_PREFIX):
                continue
            # Wingdings2 的 √ 在部分页被提取成私用区字符
            s = s.replace("\uf050", "√")
            out.append((i + 1, s))
    return out


def section_of(name):
    if "单项" in name:
        return "single"
    if "多项" in name:
        return "multi"
    if "判断" in name:
        return "judge"
    return None


def judge_key(tok):
    if tok in JUDGE_TRUE:
        return "T"
    if tok in JUDGE_FALSE:
        return "F"
    return None


# --------------------------------------------------------------------------
# 2. 分块
# --------------------------------------------------------------------------
def new_block(page, no, sec, stem):
    return {
        "page": page, "no": no, "section": sec,
        "stemParts": [stem] if stem else [],
        "options": [], "answerRaw": None, "explainParts": [],
    }


def parse(lines):
    blocks, cur, sec, last_opt = [], None, None, None

    for page, s in lines:
        m = SEC_RE.match(s)
        if m:
            new_sec = section_of(m.group(2))
            if new_sec:
                if cur is not None:
                    blocks.append(cur)
                cur, sec, last_opt = None, new_sec, None
                continue
        if sec is None:
            continue

        am = ANS_RE.match(s)
        if am and cur is not None:
            body = am.group(1).strip()
            if cur["answerRaw"] is None:
                cur["answerRaw"] = body
            else:
                cur["explainParts"].append(body)
            last_opt = None
            continue

        nm = NUM_RE.match(s)
        if nm and (cur is None or cur["no"] is None or int(nm.group(1)) > cur["no"]):
            if cur is not None:
                blocks.append(cur)
            cur = new_block(page, int(nm.group(1)), sec, nm.group(2).strip())
            last_opt = None
            continue

        if cur is None:
            continue

        # 一行并排多个选项：必须字母严格递增，否则会误拆正文
        marks = list(OPT_INLINE_RE.finditer(s))
        if (
            sec in ("single", "multi")
            and 2 <= len(marks) <= 4
            and marks[0].start() == 0
            and all(marks[i].group(1) < marks[i + 1].group(1) for i in range(len(marks) - 1))
        ):
            for i, mk in enumerate(marks):
                end = marks[i + 1].start() if i + 1 < len(marks) else len(s)
                txt = s[mk.end():end].strip()
                last_opt = {"key": mk.group(1), "parts": [txt] if txt else []}
                cur["options"].append(last_opt)
            continue

        if sec in ("single", "multi"):
            om = OPT_RE.match(s)
            if om and (cur["options"] or om.group(1) == "A"):
                head = om.group(2).strip()
                last_opt = {"key": om.group(1), "parts": [head] if head else []}
                cur["options"].append(last_opt)
                continue

        if sec in ("single", "multi") and last_opt is not None:
            last_opt["parts"].append(s)
        elif cur["answerRaw"] is not None:
            # 答案行之后的散行是解析 / 排版残留（如 p98 的「产品先期质量策划」
            # 分节标题掉进了 709 题后面），绝不能拼回题干。
            cur["explainParts"].append(s)
        else:
            cur["stemParts"].append(s)

    if cur is not None:
        blocks.append(cur)
    return blocks


# --------------------------------------------------------------------------
# 3. 规整 + 答案抽取
# --------------------------------------------------------------------------
def join(parts):
    out = ""
    for p in parts:
        p = p.strip()
        if not p:
            continue
        if out and re.match(r"[A-Za-z0-9（(]", p) and re.search(r"[A-Za-z0-9）)]$", out):
            out += " " + p          # 英文/数字断行补空格，中文直接拼
        else:
            out += p
    return out.strip()


def finalize(b):
    sec, stem = b["section"], join(b["stemParts"])
    options = [{"key": o["key"], "text": join(o["parts"])} for o in b["options"]]
    answer, flags = None, []
    explain = join(b["explainParts"])

    if sec == "judge":
        for rx in (INLINE_SYM_RE, INLINE_WORD_RE):
            m = rx.search(stem)
            if m:
                answer = judge_key(m.group(1))
                break
        if answer is not None:
            stem = (stem[: m.start()] + stem[m.end():]).strip()
        if b["answerRaw"]:
            # 判断题的答案行有两种写法：
            #   「答案：错误」              只有答案
            #   「答案：错误，故障诊断…」    答案 + 解析（366 题起）
            # 即使题干括号里已经给出答案，逗号后的解析也必须保留。
            head = re.split(r"[，,。.；;]", b["answerRaw"])[0].strip()
            if answer is None:
                answer = judge_key(head) or judge_key(b["answerRaw"][:1])
            tail = b["answerRaw"][len(head):].strip(" ，,。.；;")
            if tail and not explain:
                explain = tail
        if answer is None:
            flags.append("no-answer")
        return {
            "no": b["no"], "page": b["page"], "type": "judge", "stem": stem,
            "options": [{"key": "T", "text": "正确"}, {"key": "F", "text": "错误"}],
            "answer": [answer] if answer else [], "explain": explain, "flags": flags,
        }

    # 选项本身是图片时（1114/1115），PDF 在题干后另起数行写下 (A) (B) (C) (D)
    # 图注。这些会被当成题干正文拼进来，末尾那一串必须先剥掉，
    # 否则下面的行末括号正则会把最后一个 (D) 误当成答案。
    stem = re.sub(r"(?:\s*[(（]\s*[A-D]\s*[)）]){2,}\s*$", "", stem).strip()

    m = INLINE_OBJ_RE.search(stem)
    if m:
        answer = [m.group(1)]
        stem = stem[: m.start()].rstrip("。.． ")
        flags.append("inline-answer")
    else:
        mid = INLINE_ANY_RE.search(stem)
        if mid:
            answer = [mid.group(1)]
            stem = (stem[: mid.start()] + "（　）" + stem[mid.end():]).strip()
            flags.append("inline-answer")
    if answer is None and b["answerRaw"]:
        letters = sorted(set(re.findall(r"[A-D]", b["answerRaw"].upper())))
        if letters:
            answer = letters

    keys = {o["key"] for o in options}
    # 选项全为空 = 选项是图片（1114/1115），此时没有键可校验，
    # 题干括号里的答案必须原样保留，交给 build.py 合成 ABCD 占位选项。
    if answer and keys:
        dropped = [a for a in answer if a not in keys]
        if dropped:
            flags.append("answer-key-missing")
            answer = [a for a in answer if a in keys] or None
    if answer is None:
        flags.append("no-answer")
    if sec == "single" and answer and len(answer) > 1:
        flags.append("single-multi-answer")
    if sec == "multi" and answer and len(answer) < 2:
        flags.append("multi-single-answer")
    if not stem:
        flags.append("empty-stem")

    return {
        "no": b["no"], "page": b["page"], "type": sec, "stem": stem,
        "options": options, "answer": answer or [], "explain": explain, "flags": flags,
    }


# --------------------------------------------------------------------------
# 4. 修复
# --------------------------------------------------------------------------
IMAGE_HINT_RE = re.compile(r"右图|下图|如图|图中|上图|图示")


def repair(questions):
    # 4.1 选项键重复：同键已出现则丢掉后出现的空壳
    for q in questions:
        if not q["options"]:
            continue
        seen, kept = set(), []
        dropped = False
        for o in q["options"]:
            if o["key"] in seen:
                if not o["text"].strip():
                    dropped = True
                    continue
                q["flags"].append("dup-option-key")
            seen.add(o["key"])
            kept.append(o["key"])
        if len(kept) != len(q["options"]):
            q["options"] = [o for o in q["options"] if o["key"] in kept]
            q["flags"].append("dup-option-fixed")
            if dropped:
                q["answer"] = [a for a in q["answer"] if a in set(kept)]

    # 4.2 单选里混入的多答案题
    for q in questions:
        if "single-multi-answer" in q["flags"]:
            q["flags"].append("type-mismatch")

    # 4.3 图片来源题：题干说"右图/下图"但选项文本抽不出来
    for q in questions:
        if q["type"] == "single" and IMAGE_HINT_RE.search(q["stem"]):
            if len(q["options"]) < 2 or any(not o["text"].strip() for o in q["options"]):
                q["flags"].append("image-missing")
        # 4.3b 选项是矢量符号、文本层为空的题（1114/1115）：题干里残留的
        # (A)(B)(C) 标注行会被当作正文拼进题干，这里剥掉。
        if q["options"] and not any(o["text"].strip() for o in q["options"]):
            q["stem"] = re.sub(r"\s*(?:[(（]\s*[A-D]\s*[)）])+\s*$", "", q["stem"]).strip()
            q["flags"].append("option-figure")

    return questions


def renumber(questions):
    """题号在源 PDF 里连续，仍按文档顺序规整一遍（no=1..N，原号存 srcNo）。"""
    out = []
    for sec in ("single", "multi", "judge"):
        for i, q in enumerate([x for x in questions if x["type"] == sec], 1):
            q["srcNo"] = q["no"]
            q["no"] = i
            out.append(q)
    return out


def main():
    raw_path = sys.argv[1] if len(sys.argv) > 1 else "raw.json"
    doc = pymupdf.open(PDF)
    questions = renumber(repair([finalize(b) for b in parse(clean_lines(doc))]))

    for sec in ("single", "multi", "judge"):
        qs = [q for q in questions if q["type"] == sec]
        fc = Counter(f for q in qs for f in q["flags"])
        nos = [q["srcNo"] for q in qs]
        gaps = sorted(set(range(min(nos), max(nos) + 1)) - set(nos))
        print("[%s] n=%d src %d..%d gaps=%s" % (sec, len(qs), min(nos), max(nos), gaps[:12]))
        print("   flags:", dict(fc))

    json.dump(questions, open(raw_path, "w", encoding="utf-8"), ensure_ascii=False, indent=1)
    print("wrote", raw_path)


if __name__ == "__main__":
    main()
