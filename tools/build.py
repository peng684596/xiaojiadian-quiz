# -*- coding: utf-8 -*-
"""build.py —— raw.json -> site/data/questions.json（站点唯一运行时数据源）

做六件事：
1. 定章节：原 PDF 只有三个题型大段（单选/多选/判断），没有章节。
   策略 = 题干关键词打分（本 PDF 题干普遍带「机械制图中，」「法定计量单位系统中，」
   这类主题前缀，关键词命中率很高）+ 题号段先验兜底（原 PDF 的题号本身按主题
   成段排布，关键词一个都没命中的题按所在题号段归章）。
2. 去重：题干 + 选项指纹相同的题，后出现的记 dupOf 指向保留题。
3. 配图：把需要看图的题从 PDF 裁成 PNG，落到 site/assets/fig/。
4. 定 id / flag / meta。
5. 写出 data/questions.json 与 data/meta.json。
"""
import hashlib
import json
import os
import re
from collections import Counter

HERE = os.path.dirname(os.path.abspath(__file__))          # <repo>/tools
SITE = os.path.dirname(HERE)                                # <repo>
DATA_DIR = os.path.join(SITE, "data")
FIG_DIR = os.path.join(SITE, "assets", "fig")
RAW = os.path.join(HERE, "raw.json")                        # 解析中间产物，不入库
PDF = (r"C:\Users\peng1\Documents\xwechat_files\wxid_b5uxo7um52ok22_2cf8"
       r"\msg\file\2026-10\24小家电理论题库.pdf")

TYPES = ("single", "multi", "judge")
TYPE_PREFIX = {"single": "s", "multi": "m", "judge": "j"}
TYPE_LABEL = {"single": "单选题", "multi": "多选题", "judge": "判断题"}

# ---------------------------------------------------------------- 章节定义
# 关键词权重：专有名词 3，主题词 2，泛词 1。
CHAPTERS = [
    ("c1", "职业道德与职业素养", [
        ("职业道德", 3), ("职业素养", 3), ("工匠精神", 3), ("遵纪守法", 3),
        ("行为规范", 3), ("廉洁自律", 3), ("技术秘密", 3), ("诚实守信", 3),
        ("知识产权", 2), ("社会责任", 2), ("公平竞争", 2), ("团队协作", 2),
        ("规章制度", 2), ("保密", 2), ("诚信", 2), ("敬业", 2), ("劳模", 2),
        ("企业形象", 2), ("公司声誉", 2), ("客户投诉", 1), ("同事", 1),
        ("加班", 1), ("员工", 1), ("偷工减料", 3), ("电器制造工", 2),
        ("电气工程师", 2), ("职业道德规范", 3),
    ]),
    ("c2", "工业设计与产品开发", [
        ("工业设计", 3), ("人机工程", 3), ("人体工程学", 3), ("CMF", 3),
        ("TRIZ", 3), ("包豪斯", 3), ("用户体验", 3), ("可用性测试", 3),
        ("用户研究", 3), ("可持续性设计", 3), ("设计评审", 2), ("设计流程", 2),
        ("设计理念", 2), ("造型设计", 2), ("形态设计", 2), ("色彩设计", 2),
        ("敏捷开发", 2), ("市场调研", 2), ("可制造性", 2), ("易用性", 2),
        ("产品原型", 2), ("原型制作", 3), ("产品发布", 2), ("品牌形象", 2),
        ("包装设计", 2), ("人体工效", 3), ("设计变更", 2), ("设计伦理", 2),
        ("设计方法", 2), ("产品设计", 2), ("设计", 1),
    ]),
    ("c3", "电工电子技术与元器件", [
        ("二极管", 3), ("三极管", 3), ("稳压管", 3), ("晶闸管", 3), ("可控硅", 3),
        ("触发器", 3), ("逻辑门", 3), ("欧姆定律", 3), ("色环", 3), ("万用表", 3),
        ("示波器", 3), ("运算放大器", 3), ("整流", 3), ("放大电路", 3),
        ("电解电容", 3), ("滤波", 3), ("谐振", 3), ("电阻", 2), ("电容", 2),
        ("电感", 2), ("电路", 2), ("电流", 2), ("电压", 2), ("功率因数", 2),
        ("串联", 2), ("并联", 2), ("短路", 2), ("断路", 2), ("放大器", 2),
        ("数字电路", 2), ("模拟电路", 2), ("电桥", 2), ("半导体", 2), ("电学", 3),
        ("电气安全规程", 3), ("相线", 2), ("火线", 2), ("中性线", 2), ("触电", 2),
        ("量程", 2), ("电热元件", 3), ("电热丝", 2), ("变压器", 2),
        ("接地", 1), ("导线", 1), ("绝缘", 1), ("频率", 1), ("信号", 1),
        ("电气符号", 3), ("万用电表", 3), ("电荷", 3), ("电位", 2),
    ]),
    ("c4", "机械制图与机械设计", [
        ("机械制图", 3), ("三视图", 3), ("剖视图", 3), ("剖面图", 3),
        ("机械设计", 3), ("尺寸标注", 3), ("形位公差", 3), ("表面粗糙度", 3),
        ("焊接符号", 3), ("装配图", 3), ("零件图", 3), ("动力学分析", 3),
        ("中心线", 3), ("视图", 2), ("公差", 2), ("粗糙度", 2), ("螺纹", 2),
        ("投影", 2), ("线型", 2), ("轴承", 2), ("齿轮", 2), ("传动", 2),
        ("密封", 2), ("疲劳", 2), ("磨损", 2), ("载荷", 2), ("扭矩", 2),
        ("液压", 2), ("气动", 2), ("制图", 2), ("材料", 1), ("焊接", 1),
        ("联轴器", 3), ("键连接", 3), ("销连接", 2), ("弹簧", 2), ("带传动", 3),
        ("链传动", 3), ("减速器", 3), ("公差配合", 3),
    ]),
    ("c5", "电气自动化与机电一体化", [
        ("机电一体化", 3), ("PLC", 3), ("伺服", 3), ("变频", 3), ("PID", 3),
        ("柔性制造", 3), ("可编程逻辑控制器", 3), ("步进电机", 3), ("编码器", 3),
        ("自动化技术", 3), ("电气自动化", 3), ("闭环控制", 3), ("开环", 2),
        ("执行器", 2), ("控制器", 2), ("继电器", 2), ("接触器", 2),
        ("机器人", 2), ("电动机", 2), ("传动系统", 2), ("数控", 2),
        ("控制精度", 2), ("电机", 1), ("限位", 1), ("驱动", 1),
    ]),
    ("c6", "智能制造与工业互联网", [
        ("智能制造", 3), ("工业4.0", 3), ("工业互联网", 3), ("数字孪生", 3),
        ("MES", 3), ("ERP", 3), ("CRM", 3), ("PLM", 3), ("数字主线", 3),
        ("智能工厂", 3), ("智能研发", 3), ("企业资源计划", 3), ("先进制造技术", 3),
        ("预测性维护", 3), ("智能物流", 3), ("大数据", 2), ("云计算", 2),
        ("区块链", 2), ("边缘计算", 2), ("数据采集", 2), ("智能检测", 2),
        ("智能装配", 2), ("智能维护", 2), ("精益生产", 2), ("数字化", 2),
        ("信息化", 2), ("电子商务", 2), ("客户定制化", 3), ("柔性生产", 3),
    ]),
    ("c7", "智能产品开发与用户体验", [
        ("智能产品开发", 3), ("智能产品设计", 3), ("产品开发", 2),
        ("用户需求", 3), ("需求分析", 3), ("产品规划", 3), ("产品迭代", 3),
        ("用户画像", 3), ("场景化设计", 3), ("交互设计", 3), ("物联网产品", 2),
        ("产品生命周期", 2), ("产品经理", 2), ("MVP", 3), ("用户测试", 3),
        ("可用性", 2), ("功能定义", 2), ("竞品分析", 3), ("用户反馈", 2),
    ]),
    ("c8", "电子信息与数字通信", [
        ("电子信息", 3), ("数字通信", 3), ("射频", 3), ("信噪比", 3),
        ("调制", 3), ("解调", 3), ("多路复用", 3), ("误码率", 3),
        ("傅里叶", 3), ("数字滤波", 3), ("数字信号处理", 3), ("DSP", 3),
        ("PCM", 3), ("阻抗匹配", 3), ("串行通信", 3), ("数字信号", 3),
        ("数字图像", 3), ("图像处理", 3), ("带宽", 2), ("频谱", 2),
        ("通信系统", 3), ("信道", 2), ("编码", 1), ("传输", 1), ("通信", 1),
    ]),
    ("c9", "物联网与嵌入式", [
        ("物联网", 3), ("IoT", 3), ("传感器网络", 3), ("智能家居", 3),
        ("嵌入式", 3), ("射频识别", 3), ("RFID", 3), ("智能交通", 2),
        ("无线通信", 2), ("组网", 2), ("智能终端", 2), ("二维码", 2),
        ("区块链溯源", 2), ("传感器", 2), ("单片机", 2), ("云平台", 2),
    ]),
    ("c10", "智能控制与人工智能", [
        ("智能控制", 3), ("人工智能", 3), ("机器学习", 3), ("神经网络", 3),
        ("深度学习", 3), ("自然语言处理", 3), ("NLP", 3), ("专家系统", 3),
        ("强化学习", 3), ("自适应控制", 3), ("模糊控制", 3), ("模糊逻辑", 3),
        ("语音识别", 3), ("图像识别", 3), ("计算机视觉", 3), ("智能体", 3),
        ("决策树", 3), ("监督学习", 3), ("无监督", 3), ("训练集", 3),
        ("特征提取", 3), ("智能算法", 2), ("算法", 1), ("模型", 1),
        ("卷积", 3), ("聚类", 3), ("回归", 2), ("迁移学习", 3),
    ]),
    ("c11", "增材制造与3D打印", [
        ("增材制造", 3), ("3D打印", 3), ("3D 打印", 3), ("FDM", 3), ("SLA", 3),
        ("SLS", 3), ("SLM", 3), ("EBM", 3), ("DLP", 3), ("光固化", 3),
        ("熔融沉积", 3), ("快速成型", 3), ("分层制造", 3), ("粘结剂喷射", 3),
        ("烧结", 2), ("树脂", 2), ("粉末", 2), ("打印", 2), ("支撑结构", 2),
        ("喷嘴", 2), ("壁厚", 1), ("激光", 1),
    ]),
    ("c12", "装配工艺与生产管理", [
        ("装配工艺", 3), ("部件装配", 3), ("密封设计", 3), ("密封部件", 3),
        ("电磁屏蔽", 3), ("电控部件", 3), ("工艺文件", 3), ("物料管控", 3),
        ("物料需求计划", 3), ("零部件管理", 3), ("作业策划", 3), ("设备造型", 3),
        ("现场管理", 3), ("生产计划", 2), ("装配线", 3), ("装配", 3),
        ("5S", 3), ("物料", 3), ("部件", 2), ("紧固", 2), ("润滑", 2),
        ("库存", 2), ("产线", 2), ("工装", 2), ("仓储", 2), ("工序", 2),
        ("节拍", 2), ("屏蔽", 2), ("周转", 1), ("工艺", 1),
    ]),
    ("c13", "先期质量策划与计量检测", [
        ("先期质量策划", 3), ("APQP", 3), ("FMEA", 3), ("PPAP", 3),
        ("控制计划", 3), ("过程能力", 3), ("质量审核", 2), ("抽样检验", 3),
        ("产品质量检测", 3), ("产品检测", 3), ("检测设计", 3),
        ("法定计量单位", 3), ("计量单位", 3), ("计量", 3), ("校准", 3),
        ("检测仪器", 3), ("测量误差", 3), ("精度等级", 3), ("计量器具", 3),
        ("机电产品性能", 3), ("机电产品调验", 3), ("性能试验", 2),
        ("寿命测试", 2), ("可靠性", 2), ("质量标准", 2), ("质量改进", 2),
        ("不合格品", 2), ("检验", 1), ("测试", 1), ("误差", 1), ("ISO", 1),
        ("GB", 1), ("CE", 1), ("标准", 1), ("检测", 1), ("质量", 1),
        ("测量", 1), ("单位", 1), ("国际标准化组织", 3),
    ]),
    ("c14", "家用电器设计与维修", [
        ("家电产品设计", 3), ("家电设计", 3), ("设计更改", 3), ("小家电", 3),
        ("家用电器", 3), ("家电", 3), ("设备故障维修", 3), ("故障维修", 3),
        ("空调", 3), ("冰箱", 3), ("洗衣机", 3), ("制冷", 3), ("压缩机", 3),
        ("微波炉", 3), ("电饭锅", 3), ("热水器", 3), ("电熨斗", 3),
        ("泄漏电流", 3), ("干燥过滤器", 3), ("冷媒", 3), ("制冷剂", 3),
        ("电风扇", 3), ("检修", 2), ("维修", 2), ("售后", 2), ("耐压", 2),
        ("接地电阻", 2), ("铭牌", 2), ("蒸发器", 2), ("冷凝器", 2),
        ("故障", 1), ("器具", 1), ("限温器", 3), ("磁钢", 3), ("电热毯", 3),
        ("吸油烟机", 3), ("电吹风", 3), ("电水壶", 3), ("电磁炉", 3),
    ]),
]
CHAPTER_NAME = {cid: n for cid, n, _k in CHAPTERS}

# 题号段先验：关键词一个都没命中时按题号段兜底。段边界来自逐块主题统计。
SEGMENTS = {
    "single": [
        (1, 60, "c1"), (61, 120, "c2"), (121, 170, "c3"), (171, 220, "c4"),
        (221, 260, "c5"), (261, 320, "c7"), (321, 340, "c6"), (341, 400, "c8"),
        (401, 440, "c9"), (441, 500, "c10"), (501, 540, "c6"), (541, 560, "c6"),
        (561, 600, "c5"), (601, 640, "c11"), (641, 700, "c10"), (701, 740, "c13"),
        (741, 800, "c4"), (801, 860, "c12"), (861, 900, "c13"), (901, 960, "c3"),
        (961, 1000, "c14"), (1001, 1060, "c14"), (1061, 1125, "c14"),
        (1126, 1185, "c3"),
    ],
    "multi": [
        (1, 20, "c1"), (21, 60, "c2"), (61, 80, "c3"), (81, 120, "c4"),
        (121, 160, "c3"), (161, 180, "c8"), (181, 200, "c5"), (201, 240, "c7"),
        (241, 260, "c9"), (261, 300, "c10"), (301, 340, "c5"), (341, 360, "c6"),
        (361, 400, "c11"), (401, 420, "c12"), (421, 450, "c4"),
        (451, 480, "c12"), (481, 500, "c13"),
        (501, 540, "c14"), (541, 570, "c10"),
    ],
    "judge": [
        (1, 20, "c1"), (21, 40, "c2"), (41, 60, "c3"), (61, 80, "c4"),
        (81, 100, "c3"), (101, 120, "c8"), (121, 140, "c5"), (141, 160, "c7"),
        (161, 180, "c9"), (181, 200, "c10"), (201, 220, "c5"), (221, 240, "c6"),
        (241, 260, "c11"), (261, 280, "c10"), (281, 320, "c12"), (321, 340, "c12"),
        (341, 380, "c13"), (381, 420, "c14"), (421, 485, "c14"),
    ],
}

# 需要配图的题：题号 -> (页码, 裁剪框, alt)。坐标来自逐张视觉核对。
FIGURES = {
    1113: (153, (434.52, 576.72, 502.44, 662.52), "陶瓷电容实物图，表面印字"),
    1114: (154, (90, 73, 410, 162), "四个三极管符号，图注 A~D"),
    1115: (154, (90, 186, 410, 250), "四个稳压二极管符号，图注 A~D"),
    1116: (154, (404.40, 264.00, 524.40, 300.00), "二极管实物图"),
    1119: (154, (440, 410, 520, 500), "三极管外形图，引脚标注 (1)(2)(3)"),
    1140: (157, (421.92, 118.92, 550.92, 186.48), "数字万用表显示屏读数"),
    1184: (162, (385.20, 240.12, 502.20, 297.12), "色环电阻实物图"),
}
FIG_OPTION_NOS = {1114, 1115}      # 选项本身是图片，合成 ABCD 占位选项
# 选项文字抽不出、必须作废的题。按「题型 + 题号」定位：三个题型各自从 1 编号，
# 只写题号会把多选 127、判断 127 一起误废掉。
BROKEN_KEYS = {
    ("single", 1147),   # 微调电容符号题：四个选项全是矢量图，文本层为空，跨页
    ("judge", 423),     # 原 PDF 漏印括号答案，无从推断
}
# 原卷排版缺陷的定点修补：题 → {选项键: 替换文本}
OPTION_TEXT_PATCH = {
    # 127 的 B 选项在原卷就是空白（该行只有一个 "B." 和空格），题目本身仍可作答
    ("single", 127): {"B": "（原卷此处空白）"},
}


def score_chapters(stem):
    """返回 {chapter: score}，只保留命中的章节。"""
    out = {}
    for cid, _name, kws in CHAPTERS:
        s = 0
        for kw, w in kws:
            if kw in stem:
                s += w
        if s:
            out[cid] = s
    return out


def segment_of(qtype, no):
    for lo, hi, cid in SEGMENTS[qtype]:
        if lo <= no <= hi:
            return cid
    return "c14"   # 题号段已覆盖全部题，兜底分支正常不会触发


def assign_chapters(rows):
    """关键词打分取最高；一分未命中则用题号段先验。"""
    miss = 0
    for r in rows:
        sc = score_chapters(r["stem"])
        if sc:
            best = max(sc.values())
            cands = [c for c, v in sc.items() if v == best]
            # 同分时优先题号段先验所属章节，其次按 CHAPTERS 顺序
            prior = segment_of(r["type"], r["no"])
            r["chapter"] = prior if prior in cands else cands[0]
        else:
            r["chapter"] = segment_of(r["type"], r["no"])
            miss += 1
    return miss


def norm_text(s):
    s = s.replace("（　）", "").replace("( )", "").replace("（）", "")
    s = re.sub(r"[\s　·,，。、；;：:“”\"'（）()《》<>\[\]【】]", "", s)
    return s.lower()


def fingerprint(r):
    opts = "|".join(norm_text(o["text"]) for o in r.get("options") or [])
    return hashlib.md5((norm_text(r["stem"]) + "##" + opts).encode("utf-8")).hexdigest()[:16]


def crop_figures():
    import pymupdf
    os.makedirs(FIG_DIR, exist_ok=True)
    doc = pymupdf.open(PDF)
    out = {}
    for no, (page, box, alt) in FIGURES.items():
        pix = doc[page - 1].get_pixmap(clip=pymupdf.Rect(*box), dpi=180)
        name = "fig-%04d.png" % no
        pix.save(os.path.join(FIG_DIR, name))
        out[no] = {"src": "assets/fig/" + name, "alt": alt,
                   "w": pix.width, "h": pix.height}
    return out


def clean_stem_for_fig(stem):
    """图片题的题干里会残留 (A)(B)(C)(D) 标记，剥掉。"""
    s = re.sub(r"([（(]\s*[A-D]\s*[）)]){2,}\s*$", "", stem).strip()
    s = re.sub(r"(\([A-D]\)){2,}\s*$", "", s).strip()
    return s


def main():
    raw = json.load(open(RAW, encoding="utf-8"))
    figs = crop_figures()

    # 清掉旧图（题号变了会留下孤儿文件）
    keep = {"fig-%04d.png" % n for n in figs}
    for fn in os.listdir(FIG_DIR):
        if fn.startswith("fig-") and fn.endswith(".png") and fn not in keep:
            os.remove(os.path.join(FIG_DIR, fn))

    rows = []
    prev_no = {t: 0 for t in TYPES}
    for q in raw:
        qtype = q["type"]
        no = q["srcNo"]
        unnumbered = no is None
        if unnumbered:
            no = prev_no[qtype]
        else:
            prev_no[qtype] = no
        stem = (q["stem"] or "").strip()
        opts = q.get("options") or []
        flags = [f for f in (q.get("flags") or []) if f not in ("inline-answer", "type-mismatch")]
        answer = q.get("answer") or []

        # 判断题的「正确/错误」是固定两项，前端 normalizeQuestion 要求
        # options 至少 2 项，空数组会让整道判断题被丢弃，所以必须保留。
        if qtype == "judge":
            opts = [{"key": "T", "text": "正确"}, {"key": "F", "text": "错误"}]

        if qtype == "single" and no in FIG_OPTION_NOS:
            stem = clean_stem_for_fig(stem)
            opts = [{"key": k, "text": "图 %s" % k} for k in "ABCD"]
            inline = re.search(r"[（(]\s*([A-D])\s*[.、．]?\s*[）)]", stem)
            if not answer and inline:
                answer = [inline.group(1)]
            flags = [f for f in flags
                     if f not in ("answer-key-missing", "no-answer", "image-missing",
                                  "option-figure")]
            flags.append("figure")
        elif qtype == "single" and no in figs:
            flags.append("figure")

        patch = OPTION_TEXT_PATCH.get((qtype, no))
        if patch:
            opts = [{"key": o["key"], "text": patch.get(o["key"], o["text"])} for o in opts]

        if qtype in ("single", "multi") and any(not (o["text"] or "").strip() for o in opts):
            flags.append("broken")
        if (qtype, no) in BROKEN_KEYS:
            flags.append("broken")
        if not answer:
            flags.append("broken")
        flags = sorted(set(flags))

        row = {
            "no": no,
            "page": q["page"],
            "type": qtype,
            "typeLabel": TYPE_LABEL[qtype],
            "chapter": None,
            "stem": stem,
            "options": [{"key": o["key"], "text": (o["text"] or "").strip()} for o in opts],
            "answer": list(answer),
            "explain": (q.get("explain") or "").strip(),
            "flags": flags,
            "sourceNo": q["srcNo"],
            "unnumbered": unnumbered,
        }
        if no in figs:
            row["images"] = [dict(figs[no])]
        rows.append(row)

    miss = assign_chapters(rows)

    for r in rows:
        r["id"] = "%s%04d%s" % (TYPE_PREFIX[r["type"]], r["no"],
                                "a" if r["unnumbered"] else "")

    # 去重：同指纹 = 重复，dupOf 指向保留题 id
    seen = {}
    dup_count = 0
    for r in rows:
        r["dupOf"] = None
        if "broken" in r["flags"]:
            continue
        fp = fingerprint(r)
        if fp in seen:
            r["dupOf"] = seen[fp]
            dup_count += 1
        else:
            seen[fp] = r["id"]

    active = [r for r in rows if "broken" not in r["flags"]]
    active_unique = [r for r in active if not r.get("dupOf")]

    cnt_all = Counter(r["chapter"] for r in rows)
    cnt_active = Counter(r["chapter"] for r in active_unique)

    chapters = []
    for order, (cid, name, _kw) in enumerate(CHAPTERS, 1):
        chapters.append({
            "id": cid, "name": name, "order": order,
            "count": cnt_active.get(cid, 0),
            "total": cnt_all.get(cid, 0),
        })

    meta = {
        "title": "2024 全国工业设计职业技能大赛 小型家用电器制造工 决赛理论题库",
        "shortTitle": "小型家用电器制造工题库",
        "version": "2024-appliance-r1",
        "source": "24小家电理论题库.pdf（260 页）",
        "help": "题库由赛项官方理论题库 PDF 解析而来，答案取自原文件。",
        "generatedAt": "2026-10-28",
        "total": len(rows),
        "activeTotal": len(active_unique),
        "dupCount": dup_count,
        "brokenCount": sum(1 for r in rows if "broken" in r["flags"]),
        "figureCount": sum(1 for r in rows if r.get("images")),
        "types": dict(Counter(r["type"] for r in active_unique)),
        "typeTotals": dict(Counter(r["type"] for r in rows)),
    }

    os.makedirs(DATA_DIR, exist_ok=True)
    payload = {"meta": meta, "chapters": chapters, "questions": rows}

    def dump(path, obj):
        with open(path, "w", encoding="utf-8", newline="\n") as fh:
            json.dump(obj, fh, ensure_ascii=False, separators=(",", ":"))

    dump(os.path.join(DATA_DIR, "questions.json"), payload)
    dump(os.path.join(DATA_DIR, "meta.json"), {"meta": meta, "chapters": chapters})

    size = os.path.getsize(os.path.join(DATA_DIR, "questions.json"))
    print("questions.json %.1f KB  total=%d active=%d dup=%d broken=%d fig=%d segmiss=%d"
          % (size / 1024, meta["total"], meta["activeTotal"], dup_count,
             meta["brokenCount"], meta["figureCount"], miss))
    print("types:", meta["types"], "raw:", meta["typeTotals"])
    for c in chapters:
        bar = "#" * int(c["count"] / 12)
        print("  %-5s %-24s %4d / %4d %s" % (c["id"], c["name"], c["count"], c["total"], bar))
    bad = [r for r in rows if "broken" not in r["flags"] and r["type"] != "judge"
           and set(r["answer"]) - {o["key"] for o in r["options"]}]
    print("answer-not-in-options:", len(bad), [r["id"] for r in bad[:8]])
    print("broken:", [r["id"] for r in rows if "broken" in r["flags"]])
    print("empty chapter:", [c["id"] for c in chapters if c["count"] == 0])


if __name__ == "__main__":
    main()
