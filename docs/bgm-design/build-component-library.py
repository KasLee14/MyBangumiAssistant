# -*- coding: utf-8 -*-
"""从「模板」（保留 BGM 占位符的源文件）生成 component-library.html。

用法（脚本与模板同目录，绝对路径写在脚本内）：
  python docs/bgm-design/build-component-library.py build     # 模板 -> HTML
  python docs/bgm-design/build-component-library.py restore   # 由 HTML 反推模板（一般不需要）

模板 component-library.template.html 是文档内容的唯一手写来源，产物是生成结果：
改内容改模板，然后重新 build。生成时会注入：
  - web/src/styles/content.css 全文（第 4 节内联样式）
  - bangumi/src/web/protocol.ts 的类型摘录（逐字，只加语法着色）
  - 各组件的静态渲染复刻（与 React 组件同结构同类名）
  - 示例 JSON
类型摘录按 protocol.ts 的行号区间截取，协议里插删行后需要同步 TYPE_BLOCKS。
"""
import html as html_mod
import io
import os
import re
import sys

ROOT = r"E:\code2\bgm-assistant-v2"
DOCS = ROOT + r"\docs\bgm-design"
TEMPLATE = DOCS + r"\component-library.template.html"
OUT = DOCS + r"\component-library.html"
CSS = ROOT + r"\web\src\styles\content.css"
PROTOCOL = ROOT + r"\bangumi\src\web\protocol.ts"


def read(path):
    with io.open(path, encoding="utf-8") as handle:
        return handle.read()


def write(path, text):
    with io.open(path, "w", encoding="utf-8", newline="\n") as handle:
        handle.write(text)


# ---------------------------------------------------------------- 类型着色
TOKEN = re.compile(
    r"(?P<comment>/\*.*?\*/|//[^\n]*)"
    r"|(?P<string>'[^'\n]*')"
    r"|(?P<number>\b\d+\b)"
    r"|(?P<keyword>\b(?:export|interface|type|extends|const|readonly)\b)"
    r"|(?P<property>^\s{2}(?:'[^']+'|[A-Za-z_$][\w$]*)\??(?=\s*:))"
    r"|(?P<type>\b[A-Z][A-Za-z0-9_]*\b)",
    re.S | re.M,
)


def highlight(source):
    out = []
    pos = 0
    for match in TOKEN.finditer(source):
        out.append(html_mod.escape(source[pos:match.start()]))
        out.append('<span class="%s">%s</span>' % (match.lastgroup[0], html_mod.escape(match.group())))
        pos = match.end()
    out.append(html_mod.escape(source[pos:]))
    return "".join(out)


def unescape_markup(text):
    """html.escape 只处理 & < >，所以反转时也只还原这三种实体。"""
    return text.replace("&lt;", "<").replace("&gt;", ">").replace("&amp;", "&")


def type_block(lines, start, end):
    return '<pre class="code">%s</pre>' % highlight("\n".join(lines[start - 1:end]).rstrip())


# ---------------------------------------------------------------- 示例 JSON
JSON_SAMPLES = {
"subjects": r'''{
  "id": 12,
  "version": 1,
  "kind": "subjects",
  "subjects": {
    "title": "搜索「葬送的芙莉莲」· 动画",
    "layout": "grid",
    "total": 42,
    "hint": "结果由 search_subjects 返回，按相关度排序；这里只展示第一页。",
    "items": [
      {
        "id": 400602,
        "name": "葬送のフリーレン",
        "nameCn": "葬送的芙莉莲",
        "kind": "anime",
        "image": "https://lain.bgm.tv/pic/cover/l/2f/2f/400602_9z1z9.jpg",
        "score": 8.5,
        "scoreCount": 36463,
        "rank": 43,
        "date": "2023-09-29",
        "summary": "魔王を倒した勇者一行。その一人である魔法使いフリーレンは…",
        "tags": ["奇幻", "治愈", "公路片"],
        "url": "https://bgm.tv/subject/400602"
      },
      {
        "id": 459283,
        "name": "葬送のフリーレン ～●●の魔法～",
        "kind": "anime",
        "score": 7.2,
        "url": "https://bgm.tv/subject/459283"
      }
    ]
  }
}''',
"stats": r'''{
  "id": 13,
  "version": 1,
  "kind": "stats",
  "stats": {
    "title": "我的动画收藏 · 评分分布",
    "headline": { "value": "7.67", "label": "平均分 · 268 部已评分" },
    "mode": "histogram",
    "note": "1 分 … 10 分；柱高按各档人数相对最大档计算。",
    "entries": [
      { "label": "10", "value": "35", "ratio": 0.31 },
      { "label": "9",  "value": "96", "ratio": 0.84 },
      { "label": "8",  "value": "114", "ratio": 1 },
      { "label": "7",  "value": "92", "ratio": 0.81 },
      { "label": "6",  "value": "48", "ratio": 0.42 },
      { "label": "5",  "value": "21", "ratio": 0.18 },
      { "label": "4",  "value": "9",  "ratio": 0.08 },
      { "label": "3",  "value": "3",  "ratio": 0.03 },
      { "label": "2",  "value": "1",  "ratio": 0.01 },
      { "label": "1",  "value": "0",  "ratio": 0, "tone": "muted" }
    ]
  }
}''',
"progress": r'''{
  "id": 14,
  "version": 3,
  "kind": "progress",
  "progress": {
    "title": "葬送的芙莉莲 · 观看进度",
    "current": 12,
    "total": 28,
    "unit": "话",
    "note": "状态来自 get_user_episode_collection；本页 12 话，还有 16 话未加载。",
    "episodes": [
      { "id": 1051201, "label": "01", "state": "done" },
      { "id": 1051202, "label": "02", "state": "done" },
      { "id": 1051203, "label": "03", "state": "done" },
      { "id": 1051204, "label": "04", "state": "done" },
      { "id": 1051205, "label": "05", "state": "done" },
      { "id": 1051206, "label": "06", "state": "done" },
      { "id": 1051207, "label": "07", "state": "done" },
      { "id": 1051208, "label": "08", "state": "done" },
      { "id": 1051209, "label": "09", "state": "done" },
      { "id": 1051210, "label": "10", "state": "done" },
      { "id": 1051211, "label": "11", "state": "done" },
      { "id": 1051212, "label": "12", "state": "current" }
    ]
  }
}''',
"infobox": r'''{
  "id": 15,
  "version": 1,
  "kind": "infobox",
  "info": {
    "title": "条目信息",
    "rows": [
      { "label": "中文名", "value": "葬送的芙莉莲" },
      { "label": "别名", "value": "葬送のフリーレン / Frieren: Beyond Journey's End" },
      { "label": "话数", "value": "28" },
      { "label": "放送开始", "value": "2023 年 9 月 29 日" },
      { "label": "放送星期", "value": "星期五" },
      { "label": "原作", "value": "山田鐘人 / アベツカサ" },
      { "label": "动画制作", "value": "マッドハウス" },
      { "label": "官方网站", "value": "https://frieren-anime.jp/" },
      { "label": "播放平台", "value": "暂无", "tone": "muted" }
    ]
  }
}''',
"table": r'''{
  "id": 16,
  "version": 1,
  "kind": "table",
  "table": {
    "title": "章节列表 · 葬送的芙莉莲",
    "columns": [
      { "key": "ep", "label": "话数" },
      { "key": "name", "label": "标题" },
      { "key": "date", "label": "放送日期", "align": "right" },
      { "key": "state", "label": "我的状态" }
    ],
    "rows": [
      { "ep": "01", "name": "冒険の終わり", "date": "2023-09-29", "state": "看过" },
      { "ep": "02", "name": "別に魔法じゃなくたって…", "date": "2023-09-29", "state": "看过" },
      { "ep": "03", "name": "蒼月草", "date": "2023-10-06", "state": "看过" },
      { "ep": "04", "name": "魂の眠る地", "date": "2023-10-13", "state": "看到一半" },
      { "ep": "05", "name": "死者の幻影", "date": "2023-10-20" },
      { "ep": "06", "name": "村の英雄", "date": "2023-10-27" }
    ],
    "note": "共 28 话；state 为空表示尚未加载该书状态。表头可点排序（本地排序，不改动数据）。"
  }
}''',
"timeline": r'''{
  "id": 17,
  "version": 1,
  "kind": "timeline",
  "timeline": {
    "title": "最近动态",
    "entries": [
      { "time": "10-28 21:04", "actor": "sai", "text": "把「葬送的芙莉莲」的评分改为 8 分。" },
      { "time": "10-28 20:51", "actor": "sai", "text": "将观看进度更新到第 12 话。" },
      { "time": "10-27 09:12", "actor": "sai", "text": "收藏了「药屋少女的呢喃」，状态：在看。" },
      { "time": "10-26 23:40", "actor": "sai", "text": "创建目录「2023 年秋番清单」。" },
      { "time": "10-25 18:02", "actor": "系统", "text": "完成一次条目编辑：补充放送星期。" }
    ]
  }
}''',
"tags": r'''{
  "id": 18,
  "version": 1,
  "kind": "tags",
  "tags": {
    "tags": [
      { "name": "奇幻", "count": 12844 },
      { "name": "治愈", "count": 9021 },
      { "name": "公路片", "count": 3310 },
      { "name": "漫画改", "count": 8120 },
      { "name": "TV", "count": 6402 },
      { "name": "2023年10月", "count": 2140 },
      { "name": "冒险", "count": 5533, "selected": true },
      { "name": "魔法", "count": 1876 }
    ]
  }
}''',
"gallery": r'''{
  "id": 19,
  "version": 1,
  "kind": "gallery",
  "gallery": {
    "title": "主要角色",
    "items": [
      {
        "id": 31924,
        "name": "フリーレン",
        "image": "https://lain.bgm.tv/pic/crt/l/4c/6e/31924_crt_x.jpg",
        "subtitle": "CV：種﨑敦美",
        "url": "https://bgm.tv/character/31924"
      },
      {
        "id": 31925,
        "name": "フェルン",
        "image": "https://lain.bgm.tv/pic/crt/l/9a/19/31925_crt_x.jpg",
        "subtitle": "CV：市ノ瀬加那",
        "url": "https://bgm.tv/character/31925"
      },
      {
        "id": 31926,
        "name": "シュタルク",
        "subtitle": "CV：小林千晃",
        "url": "https://bgm.tv/character/31926"
      },
      { "id": 31927, "name": "ヒンメル", "subtitle": "CV：岡本信彦" },
      { "id": 31928, "name": "ハイター", "subtitle": "CV：東地宏樹" },
      { "id": 31929, "name": "アイゼン", "subtitle": "CV：上田燿司" }
    ]
  }
}''',
"compare": r'''{
  "id": 20,
  "version": 2,
  "kind": "compare",
  "compare": {
    "title": "已提交并回读核对 · 葬送的芙莉莲",
    "note": "提交后由宿主独立回读；未变字段保留展示，表示已核对。",
    "rows": [
      { "label": "收藏状态", "before": "在看", "after": "看过", "changed": true },
      { "label": "我的评分", "before": "未评分", "after": "8 分", "changed": true },
      { "label": "看到", "before": "第 12 话", "after": "第 12 话", "changed": false },
      { "label": "短评", "before": "（空）", "after": "（空）", "changed": false },
      { "label": "私密", "before": "公开", "after": "公开", "changed": false },
      { "label": "标签", "before": "奇幻", "after": "奇幻、治愈", "changed": true }
    ]
  }
}''',
"quote": r'''{
  "id": 21,
  "version": 1,
  "kind": "quote",
  "quote": {
    "title": "get_subject_details 原始输出（片段）",
    "mono": true,
    "text": "{\n  \"schemaVersion\": 1,\n  \"kind\": \"subjectDetails\",\n  \"data\": {\n    \"id\": 400602,\n    \"name\": \"葬送のフリーレン\",\n    \"score\": 8.45,\n    \"rank\": 43,\n    \"tags\": [\"奇幻\", \"治愈\", \"公路片\"]\n  },\n  \"complete\": true\n}"
  }
}''',
"callout": r'''{
  "id": 22,
  "version": 4,
  "kind": "callout",
  "callout": {
    "tone": "success",
    "text": "已提交评分 8 分，并独立回读确认。",
    "detail": "回读时间 2024-10-28 21:04；如需撤销，可以再说一次原来的分值。"
  }
}''',
"links": r'''{
  "id": 23,
  "version": 1,
  "kind": "links",
  "links": {
    "title": "相关资料",
    "links": [
      { "label": "条目页 · 葬送的芙莉莲", "url": "https://bgm.tv/subject/400602", "hint": "bgm.tv" },
      { "label": "原作漫画条目", "url": "https://bgm.tv/subject/305429", "hint": "关联：原作" },
      { "label": "讨论版 · 第 12 话", "url": "https://bgm.tv/subject/topic/26174", "hint": "讨论帖" },
      { "label": "动画官网", "url": "https://frieren-anime.jp/", "hint": "外部链接" }
    ]
  }
}''',
}

# ---------------------------------------------------------------- 渲染复刻
RENDER = {}

RENDER["subjects-grid"] = r'''<section class="contentBlock contentSubjects" aria-label="搜索结果 · 动画">
  <h3 class="contentBlockTitle">搜索结果 · 动画</h3>
  <ul class="contentSubjectGrid">
    <li class="contentSubjectGridItem">
      <a class="contentSubjectCard" href="https://bgm.tv/subject/400602" target="_blank" rel="noreferrer">
        <div class="contentSubjectCover"><img src="data:image/gif;base64,R0lGODlhAQABAIAAAMzMzAAAACH5BAAAAAAALAAAAAABAAEAAAICRAEAOw==" alt="葬送的芙莉莲 的封面" loading="lazy" /></div>
        <p class="contentSubjectName">葬送のフリーレン</p>
        <p class="contentSubjectFacts"><span class="contentKindBadge" title="动画">动</span>动画<span class="contentSubjectScore">8.5</span></p>
      </a>
    </li>
    <li class="contentSubjectGridItem">
      <a class="contentSubjectCard" href="https://bgm.tv/subject/459283" target="_blank" rel="noreferrer">
        <div class="contentSubjectCover" data-empty="true"></div>
        <p class="contentSubjectName">葬送のフリーレン ～●●の魔法～</p>
        <p class="contentSubjectFacts"><span class="contentKindBadge" title="动画">动</span>动画<span class="contentSubjectScore">7.2</span></p>
      </a>
    </li>
    <li class="contentSubjectGridItem">
      <a class="contentSubjectCard" href="https://bgm.tv/subject/305429" target="_blank" rel="noreferrer">
        <div class="contentSubjectCover" data-empty="true"></div>
        <p class="contentSubjectName">葬送のフリーレン</p>
        <p class="contentSubjectFacts"><span class="contentKindBadge" title="书籍">书</span>书籍<span class="contentSubjectScore">8.0</span></p>
      </a>
    </li>
  </ul>
  <p class="contentMore" role="note">本帧展示 3 条，共 42 条，还有 39 条未展示。</p>
  <p class="contentHint">结果由 search_subjects 返回，按相关度排序；这里只展示第一页。</p>
</section>'''

RENDER["subjects-list"] = r'''<section class="contentBlock contentSubjects" aria-label="我的动画收藏 · 看过（前 3 条）">
  <h3 class="contentBlockTitle">我的动画收藏 · 看过（前 3 条）</h3>
  <ul class="contentSubjectList">
    <li class="contentSubjectRow">
      <a class="contentSubjectRowLink" href="https://bgm.tv/subject/400602" target="_blank" rel="noreferrer">
        <span class="contentSubjectRowTitle">葬送のフリーレン<span class="contentSubjectRowCn">葬送的芙莉莲</span></span>
        <span class="contentSubjectRowMeta">动画 · 2023-09-29 · 36463 人评分</span>
        <span class="contentSubjectRowScore">8.5</span>
      </a>
    </li>
    <li class="contentSubjectRow">
      <a class="contentSubjectRowLink" href="https://bgm.tv/subject/351870" target="_blank" rel="noreferrer">
        <span class="contentSubjectRowTitle">薬屋のひとりごと<span class="contentSubjectRowCn">药屋少女的呢喃</span></span>
        <span class="contentSubjectRowMeta">动画 · 2023-10-22</span>
        <span class="contentSubjectRowScore">8.0</span>
      </a>
    </li>
    <li class="contentSubjectRow">
      <div class="contentSubjectRowLink">
        <span class="contentSubjectRowTitle">ダンジョン飯<span class="contentSubjectRowCn">迷宫饭</span></span>
        <span class="contentSubjectRowMeta">动画 · 2024-01-05</span>
      </div>
    </li>
  </ul>
</section>'''

RENDER["stats-histogram"] = r'''<section class="contentBlock contentStats" aria-label="我的动画收藏 · 评分分布">
  <h3 class="contentBlockTitle">我的动画收藏 · 评分分布</h3>
  <p class="contentStatHeadline"><span class="contentStatHeadlineValue">7.67</span><span class="contentStatHeadlineLabel">平均分 · 268 部已评分</span></p>
  <ul class="contentStatHistogram" aria-label="分布柱状图">
    <li class="contentStatColumn" data-tone="default"><span class="contentStatColumnValue">35</span><span class="contentStatColumnTrack"><span class="contentStatColumnBar" style="height: 31.00%"></span></span><span class="contentStatColumnLabel">10</span></li>
    <li class="contentStatColumn" data-tone="default"><span class="contentStatColumnValue">96</span><span class="contentStatColumnTrack"><span class="contentStatColumnBar" style="height: 84.00%"></span></span><span class="contentStatColumnLabel">9</span></li>
    <li class="contentStatColumn" data-tone="default"><span class="contentStatColumnValue">114</span><span class="contentStatColumnTrack"><span class="contentStatColumnBar" style="height: 100.00%"></span></span><span class="contentStatColumnLabel">8</span></li>
    <li class="contentStatColumn" data-tone="default"><span class="contentStatColumnValue">92</span><span class="contentStatColumnTrack"><span class="contentStatColumnBar" style="height: 81.00%"></span></span><span class="contentStatColumnLabel">7</span></li>
    <li class="contentStatColumn" data-tone="default"><span class="contentStatColumnValue">48</span><span class="contentStatColumnTrack"><span class="contentStatColumnBar" style="height: 42.00%"></span></span><span class="contentStatColumnLabel">6</span></li>
    <li class="contentStatColumn" data-tone="default"><span class="contentStatColumnValue">21</span><span class="contentStatColumnTrack"><span class="contentStatColumnBar" style="height: 18.00%"></span></span><span class="contentStatColumnLabel">5</span></li>
    <li class="contentStatColumn" data-tone="default"><span class="contentStatColumnValue">9</span><span class="contentStatColumnTrack"><span class="contentStatColumnBar" style="height: 8.00%"></span></span><span class="contentStatColumnLabel">4</span></li>
    <li class="contentStatColumn" data-tone="default"><span class="contentStatColumnValue">3</span><span class="contentStatColumnTrack"><span class="contentStatColumnBar" style="height: 3.00%"></span></span><span class="contentStatColumnLabel">3</span></li>
    <li class="contentStatColumn" data-tone="default"><span class="contentStatColumnValue">1</span><span class="contentStatColumnTrack"><span class="contentStatColumnBar" style="height: 1.00%"></span></span><span class="contentStatColumnLabel">2</span></li>
    <li class="contentStatColumn" data-tone="muted"><span class="contentStatColumnValue">0</span><span class="contentStatColumnTrack"><span class="contentStatColumnBar" style="height: 0.00%"></span></span><span class="contentStatColumnLabel">1</span></li>
  </ul>
  <p class="contentNote">1 分 … 10 分；柱高按各档人数相对最大档计算。</p>
</section>'''

RENDER["stats-bars"] = r'''<section class="contentBlock contentStats" aria-label="收藏状态分布">
  <h3 class="contentBlockTitle">收藏状态分布</h3>
  <ul class="contentStatBars">
    <li class="contentStatBarRow" data-tone="primary"><span class="contentStatLabel">看过</span><span class="contentStatTrack"><span class="contentStatBar" style="width: 100.00%"></span></span><span class="contentStatValue">269<span class="contentStatHint">部</span></span></li>
    <li class="contentStatBarRow" data-tone="default"><span class="contentStatLabel">在看</span><span class="contentStatTrack"><span class="contentStatBar" style="width: 42.00%"></span></span><span class="contentStatValue">113<span class="contentStatHint">部</span></span></li>
    <li class="contentStatBarRow" data-tone="default"><span class="contentStatLabel">想看</span><span class="contentStatTrack"><span class="contentStatBar" style="width: 61.00%"></span></span><span class="contentStatValue">164<span class="contentStatHint">部</span></span></li>
    <li class="contentStatBarRow" data-tone="default"><span class="contentStatLabel">搁置</span><span class="contentStatTrack"><span class="contentStatBar" style="width: 12.00%"></span></span><span class="contentStatValue">32<span class="contentStatHint">部</span></span></li>
    <li class="contentStatBarRow" data-tone="muted"><span class="contentStatLabel">抛弃</span><span class="contentStatTrack"><span class="contentStatBar" style="width: 6.00%"></span></span><span class="contentStatValue">16<span class="contentStatHint">部</span></span></li>
  </ul>
  <p class="contentNote">横条长度按 ratio 计算；ratio 缺失时只显示数字。</p>
</section>'''

RENDER["stats-list"] = r'''<section class="contentBlock contentStats" aria-label="总览">
  <h3 class="contentBlockTitle">总览</h3>
  <p class="contentStatHeadline"><span class="contentStatHeadlineValue">594</span><span class="contentStatHeadlineLabel">条动画收藏</span></p>
  <dl class="contentStatList">
    <div class="contentStatListRow" data-tone="default"><dt class="contentStatLabel">已评分</dt><dd class="contentStatListValue"><span class="contentStatValue">268</span></dd></div>
    <div class="contentStatListRow" data-tone="default"><dt class="contentStatLabel">未评分</dt><dd class="contentStatListValue"><span class="contentStatValue">1</span></dd></div>
    <div class="contentStatListRow" data-tone="primary"><dt class="contentStatLabel">平均分</dt><dd class="contentStatListValue"><span class="contentStatValue">7.67</span></dd></div>
    <div class="contentStatListRow" data-tone="muted"><dt class="contentStatLabel">私密收藏</dt><dd class="contentStatListValue"><span class="contentStatValue">0</span></dd></div>
  </dl>
</section>'''

RENDER["progress"] = r'''<section class="contentBlock contentProgress" aria-label="葬送的芙莉莲 · 观看进度">
  <h3 class="contentBlockTitle">葬送的芙莉莲 · 观看进度</h3>
  <p class="contentProgressHead"><span class="contentProgressValue">12 / 28 话</span><span class="contentProgressPercent">43%</span></p>
  <div class="contentProgressTrack" role="progressbar" aria-valuemin="0" aria-valuemax="28" aria-valuenow="12" aria-label="话进度"><span class="contentProgressBar" style="width: 42.86%"></span></div>
  <ul class="contentEpGrid" aria-label="章节状态">
    <li class="contentEpCell" data-state="done" title="01 · 已看"><span class="contentEpLabel">01</span><span class="contentEpState">已看</span></li>
    <li class="contentEpCell" data-state="done" title="02 · 已看"><span class="contentEpLabel">02</span><span class="contentEpState">已看</span></li>
    <li class="contentEpCell" data-state="done" title="03 · 已看"><span class="contentEpLabel">03</span><span class="contentEpState">已看</span></li>
    <li class="contentEpCell" data-state="done" title="04 · 已看"><span class="contentEpLabel">04</span><span class="contentEpState">已看</span></li>
    <li class="contentEpCell" data-state="done" title="05 · 已看"><span class="contentEpLabel">05</span><span class="contentEpState">已看</span></li>
    <li class="contentEpCell" data-state="done" title="06 · 已看"><span class="contentEpLabel">06</span><span class="contentEpState">已看</span></li>
    <li class="contentEpCell" data-state="done" title="07 · 已看"><span class="contentEpLabel">07</span><span class="contentEpState">已看</span></li>
    <li class="contentEpCell" data-state="done" title="08 · 已看"><span class="contentEpLabel">08</span><span class="contentEpState">已看</span></li>
    <li class="contentEpCell" data-state="done" title="09 · 已看"><span class="contentEpLabel">09</span><span class="contentEpState">已看</span></li>
    <li class="contentEpCell" data-state="done" title="10 · 已看"><span class="contentEpLabel">10</span><span class="contentEpState">已看</span></li>
    <li class="contentEpCell" data-state="done" title="11 · 已看"><span class="contentEpLabel">11</span><span class="contentEpState">已看</span></li>
    <li class="contentEpCell" data-state="current" title="12 · 当前"><span class="contentEpLabel">12</span><span class="contentEpState">当前</span></li>
    <li class="contentEpCell" data-state="todo" title="13 · 未看"><span class="contentEpLabel">13</span><span class="contentEpState">未看</span></li>
    <li class="contentEpCell" data-state="todo" title="14 · 未看"><span class="contentEpLabel">14</span><span class="contentEpState">未看</span></li>
    <li class="contentEpCell" data-state="todo" title="15 · 未看"><span class="contentEpLabel">15</span><span class="contentEpState">未看</span></li>
    <li class="contentEpCell" data-state="todo" title="16 · 未看"><span class="contentEpLabel">16</span><span class="contentEpState">未看</span></li>
  </ul>
  <p class="contentNote">状态来自 get_user_episode_collection；本页 12 话，还有 16 话未加载。</p>
</section>'''

RENDER["infobox"] = r'''<section class="contentBlock contentInfoBox" aria-label="条目信息">
  <h3 class="contentBlockTitle">条目信息</h3>
  <dl class="contentInfoList">
    <div class="contentInfoRow" data-tone="default"><dt class="contentInfoLabel">中文名</dt><dd class="contentInfoValue">葬送的芙莉莲</dd></div>
    <div class="contentInfoRow" data-tone="default"><dt class="contentInfoLabel">别名</dt><dd class="contentInfoValue">葬送のフリーレン / Frieren: Beyond Journey's End</dd></div>
    <div class="contentInfoRow" data-tone="default"><dt class="contentInfoLabel">话数</dt><dd class="contentInfoValue">28</dd></div>
    <div class="contentInfoRow" data-tone="default"><dt class="contentInfoLabel">放送开始</dt><dd class="contentInfoValue">2023 年 9 月 29 日</dd></div>
    <div class="contentInfoRow" data-tone="default"><dt class="contentInfoLabel">放送星期</dt><dd class="contentInfoValue">星期五</dd></div>
    <div class="contentInfoRow" data-tone="default"><dt class="contentInfoLabel">原作</dt><dd class="contentInfoValue">山田鐘人 / アベツカサ</dd></div>
    <div class="contentInfoRow" data-tone="default"><dt class="contentInfoLabel">动画制作</dt><dd class="contentInfoValue">マッドハウス</dd></div>
    <div class="contentInfoRow" data-tone="default"><dt class="contentInfoLabel">官方网站</dt><dd class="contentInfoValue">https://frieren-anime.jp/</dd></div>
    <div class="contentInfoRow" data-tone="muted"><dt class="contentInfoLabel">播放平台</dt><dd class="contentInfoValue">暂无</dd></div>
  </dl>
</section>'''

RENDER["table"] = r'''<section class="contentBlock contentTableBlock" aria-label="章节列表 · 葬送的芙莉莲">
  <h3 class="contentBlockTitle">章节列表 · 葬送的芙莉莲</h3>
  <div class="contentTableScroll">
    <table class="contentTable">
      <caption class="contentTableCaption">章节列表 · 葬送的芙莉莲</caption>
      <thead>
        <tr>
          <th scope="col" class="contentTableCell" data-align="left" aria-sort="none"><button type="button" class="contentTableSort">话数<span class="contentTableSortMark" aria-hidden="true">↕</span></button></th>
          <th scope="col" class="contentTableCell" data-align="left" aria-sort="none"><button type="button" class="contentTableSort">标题<span class="contentTableSortMark" aria-hidden="true">↕</span></button></th>
          <th scope="col" class="contentTableCell" data-align="right" aria-sort="ascending"><button type="button" class="contentTableSort">放送日期<span class="contentTableSortMark" aria-hidden="true">▲</span></button></th>
          <th scope="col" class="contentTableCell" data-align="left" aria-sort="none"><button type="button" class="contentTableSort">我的状态<span class="contentTableSortMark" aria-hidden="true">↕</span></button></th>
        </tr>
      </thead>
      <tbody>
        <tr><td class="contentTableCell" data-align="left">01</td><td class="contentTableCell" data-align="left">冒険の終わり</td><td class="contentTableCell" data-align="right">2023-09-29</td><td class="contentTableCell" data-align="left">看过</td></tr>
        <tr><td class="contentTableCell" data-align="left">02</td><td class="contentTableCell" data-align="left">別に魔法じゃなくたって…</td><td class="contentTableCell" data-align="right">2023-09-29</td><td class="contentTableCell" data-align="left">看过</td></tr>
        <tr><td class="contentTableCell" data-align="left">03</td><td class="contentTableCell" data-align="left">蒼月草</td><td class="contentTableCell" data-align="right">2023-10-06</td><td class="contentTableCell" data-align="left">看过</td></tr>
        <tr><td class="contentTableCell" data-align="left">04</td><td class="contentTableCell" data-align="left">魂の眠る地</td><td class="contentTableCell" data-align="right">2023-10-13</td><td class="contentTableCell" data-align="left">看到一半</td></tr>
        <tr><td class="contentTableCell" data-align="left">05</td><td class="contentTableCell" data-align="left">死者の幻影</td><td class="contentTableCell" data-align="right">2023-10-20</td><td class="contentTableCell" data-align="left"></td></tr>
        <tr><td class="contentTableCell" data-align="left">06</td><td class="contentTableCell" data-align="left">村の英雄</td><td class="contentTableCell" data-align="right">2023-10-27</td><td class="contentTableCell" data-align="left"></td></tr>
      </tbody>
    </table>
  </div>
  <p class="contentNote">共 28 话；state 为空表示尚未加载该书状态。表头可点排序（本地排序，不改动数据）。</p>
</section>'''

RENDER["timeline"] = r'''<section class="contentBlock contentTimeline" aria-label="最近动态">
  <h3 class="contentBlockTitle">最近动态</h3>
  <ol class="contentTimelineList">
    <li class="contentTimelineRow"><time class="contentTimelineTime">10-28 21:04</time><p class="contentTimelineText"><span class="contentTimelineActor">sai</span>把「葬送的芙莉莲」的评分改为 8 分。</p></li>
    <li class="contentTimelineRow"><time class="contentTimelineTime">10-28 20:51</time><p class="contentTimelineText"><span class="contentTimelineActor">sai</span>将观看进度更新到第 12 话。</p></li>
    <li class="contentTimelineRow"><time class="contentTimelineTime">10-27 09:12</time><p class="contentTimelineText"><span class="contentTimelineActor">sai</span>收藏了「药屋少女的呢喃」，状态：在看。</p></li>
    <li class="contentTimelineRow"><time class="contentTimelineTime">10-26 23:40</time><p class="contentTimelineText"><span class="contentTimelineActor">sai</span>创建目录「2023 年秋番清单」。</p></li>
    <li class="contentTimelineRow"><time class="contentTimelineTime">10-25 18:02</time><p class="contentTimelineText"><span class="contentTimelineActor">系统</span>完成一次条目编辑：补充放送星期。</p></li>
  </ol>
</section>'''

RENDER["tags"] = r'''<section class="contentBlock contentTags" aria-label="标签">
  <ul class="contentTagCloud">
    <li class="contentTagCloudItem"><span class="contentTag" data-selected="false">奇幻<span class="contentTagCount">12844</span></span></li>
    <li class="contentTagCloudItem"><span class="contentTag" data-selected="false">治愈<span class="contentTagCount">9021</span></span></li>
    <li class="contentTagCloudItem"><span class="contentTag" data-selected="false">公路片<span class="contentTagCount">3310</span></span></li>
    <li class="contentTagCloudItem"><span class="contentTag" data-selected="false">漫画改<span class="contentTagCount">8120</span></span></li>
    <li class="contentTagCloudItem"><span class="contentTag" data-selected="false">TV<span class="contentTagCount">6402</span></span></li>
    <li class="contentTagCloudItem"><span class="contentTag" data-selected="false">2023年10月<span class="contentTagCount">2140</span></span></li>
    <li class="contentTagCloudItem"><span class="contentTag" data-selected="true">冒险<span class="contentTagCount">5533</span></span></li>
    <li class="contentTagCloudItem"><span class="contentTag" data-selected="false">魔法<span class="contentTagCount">1876</span></span></li>
  </ul>
</section>'''

RENDER["gallery"] = r'''<figure class="contentBlock contentGallery" aria-label="主要角色">
  <figcaption class="contentBlockTitle">主要角色</figcaption>
  <ul class="contentGalleryTrack" tabindex="0">
    <li class="contentGalleryItem"><a class="contentGalleryCard" href="https://bgm.tv/character/31924" target="_blank" rel="noreferrer"><span class="contentGalleryCover"><img src="data:image/gif;base64,R0lGODlhAQABAIAAAMzMzAAAACH5BAAAAAAALAAAAAABAAEAAAICRAEAOw==" alt="フリーレン 的封面" loading="lazy" /></span><span class="contentGalleryName">フリーレン</span><span class="contentGallerySubtitle">CV：種﨑敦美</span></a></li>
    <li class="contentGalleryItem"><a class="contentGalleryCard" href="https://bgm.tv/character/31925" target="_blank" rel="noreferrer"><span class="contentGalleryCover"><img src="data:image/gif;base64,R0lGODlhAQABAIAAAMzMzAAAACH5BAAAAAAALAAAAAABAAEAAAICRAEAOw==" alt="フェルン 的封面" loading="lazy" /></span><span class="contentGalleryName">フェルン</span><span class="contentGallerySubtitle">CV：市ノ瀬加那</span></a></li>
    <li class="contentGalleryItem"><a class="contentGalleryCard" href="https://bgm.tv/character/31926" target="_blank" rel="noreferrer"><span class="contentGalleryCover" data-empty="true"></span><span class="contentGalleryName">シュタルク</span><span class="contentGallerySubtitle">CV：小林千晃</span></a></li>
    <li class="contentGalleryItem"><a class="contentGalleryCard" href="https://bgm.tv/character/31927" target="_blank" rel="noreferrer"><span class="contentGalleryCover" data-empty="true"></span><span class="contentGalleryName">ヒンメル</span><span class="contentGallerySubtitle">CV：岡本信彦</span></a></li>
    <li class="contentGalleryItem"><a class="contentGalleryCard" href="https://bgm.tv/character/31928" target="_blank" rel="noreferrer"><span class="contentGalleryCover" data-empty="true"></span><span class="contentGalleryName">ハイター</span><span class="contentGallerySubtitle">CV：東地宏樹</span></a></li>
    <li class="contentGalleryItem"><a class="contentGalleryCard" href="https://bgm.tv/character/31929" target="_blank" rel="noreferrer"><span class="contentGalleryCover" data-empty="true"></span><span class="contentGalleryName">アイゼン</span><span class="contentGallerySubtitle">CV：上田燿司</span></a></li>
  </ul>
</figure>'''

RENDER["compare"] = r'''<section class="contentBlock contentCompare" aria-label="已提交并回读核对 · 葬送的芙莉莲">
  <h3 class="contentBlockTitle">已提交并回读核对 · 葬送的芙莉莲</h3>
  <div class="contentTableScroll">
    <table class="contentTable contentCompareTable">
      <thead>
        <tr><th scope="col" class="contentTableCell">字段</th><th scope="col" class="contentTableCell">修改前</th><th scope="col" class="contentTableCell">修改后</th></tr>
      </thead>
      <tbody>
        <tr data-changed="true"><th scope="row" class="contentTableCell contentCompareLabel">收藏状态</th><td class="contentTableCell contentCompareBefore"><del>在看</del></td><td class="contentTableCell contentCompareAfter"><ins>看过</ins></td></tr>
        <tr data-changed="true"><th scope="row" class="contentTableCell contentCompareLabel">我的评分</th><td class="contentTableCell contentCompareBefore"><del>未评分</del></td><td class="contentTableCell contentCompareAfter"><ins>8 分</ins></td></tr>
        <tr data-changed="false"><th scope="row" class="contentTableCell contentCompareLabel">看到</th><td class="contentTableCell contentCompareBefore">第 12 话</td><td class="contentTableCell contentCompareAfter"><ins>第 12 话</ins></td></tr>
        <tr data-changed="false"><th scope="row" class="contentTableCell contentCompareLabel">短评</th><td class="contentTableCell contentCompareBefore">（空）</td><td class="contentTableCell contentCompareAfter"><ins>（空）</ins></td></tr>
        <tr data-changed="false"><th scope="row" class="contentTableCell contentCompareLabel">私密</th><td class="contentTableCell contentCompareBefore">公开</td><td class="contentTableCell contentCompareAfter"><ins>公开</ins></td></tr>
        <tr data-changed="true"><th scope="row" class="contentTableCell contentCompareLabel">标签</th><td class="contentTableCell contentCompareBefore"><del>奇幻</del></td><td class="contentTableCell contentCompareAfter"><ins>奇幻、治愈</ins></td></tr>
      </tbody>
    </table>
  </div>
  <p class="contentNote">提交后由宿主独立回读；未变字段保留展示，表示已核对。</p>
</section>'''

RENDER["quote"] = r'''<figure class="contentBlock contentQuote" aria-label="get_subject_details 原始输出（片段）">
  <figcaption class="contentQuoteTitle">get_subject_details 原始输出（片段）</figcaption>
  <pre class="contentQuoteBody contentQuoteMono">{
  "schemaVersion": 1,
  "kind": "subjectDetails",
  "data": {
    "id": 400602,
    "name": "葬送のフリーレン",
    "score": 8.45,
    "rank": 43,
    "tags": ["奇幻", "治愈", "公路片"]
  },
  "complete": true
}</pre>
</figure>
<figure class="contentBlock contentQuote" aria-label="目录简介原文">
  <figcaption class="contentQuoteTitle">目录简介原文</figcaption>
  <div class="contentQuoteBody">这一季只收治愈系与公路片。收片标准：能让人在深夜安静看完，第二天还想再想一遍。</div>
</figure>'''

RENDER["callout"] = r'''<div class="contentBlock contentCallout" data-tone="progress" role="status">
  <span class="contentCalloutMark" aria-hidden="true">·</span>
  <span class="contentCalloutText">正在提交评分 8 分…</span>
  <span class="contentCalloutTone">进行中</span>
</div>
<div class="contentBlock contentCallout" data-tone="success" role="status">
  <span class="contentCalloutMark" aria-hidden="true">✓</span>
  <span class="contentCalloutText">已提交评分 8 分，并独立回读确认。</span>
  <span class="contentCalloutTone">成功</span>
</div>
<div class="contentBlock contentCallout" data-tone="warning" role="status">
  <span class="contentCalloutMark" aria-hidden="true">△</span>
  <span class="contentCalloutText">已提交，但回读结果与预期不一致，请核对。</span>
  <span class="contentCalloutTone">注意</span>
  <p class="contentCalloutDetail">期望 rating=8，回读得到 rating=7；可能是站点缓存，稍后可再核对一次。</p>
</div>
<div class="contentBlock contentCallout" data-tone="error" role="status">
  <span class="contentCalloutMark" aria-hidden="true">×</span>
  <span class="contentCalloutText">提交失败：连接 bgm.tv 超时。</span>
  <span class="contentCalloutTone">失败</span>
  <p class="contentCalloutDetail">错误码 NETWORK_TIMEOUT · 未发生写入，可以安全重试。</p>
</div>'''

RENDER["links"] = r'''<section class="contentBlock contentLinks" aria-label="相关资料">
  <h3 class="contentBlockTitle">相关资料</h3>
  <ul class="contentLinkList">
    <li class="contentLinkRow"><a class="contentLink" href="https://bgm.tv/subject/400602" target="_blank" rel="noreferrer"><span class="contentLinkLabel">条目页 · 葬送的芙莉莲</span><span class="contentLinkHint">bgm.tv</span></a></li>
    <li class="contentLinkRow"><a class="contentLink" href="https://bgm.tv/subject/305429" target="_blank" rel="noreferrer"><span class="contentLinkLabel">原作漫画条目</span><span class="contentLinkHint">关联：原作</span></a></li>
    <li class="contentLinkRow"><a class="contentLink" href="https://bgm.tv/subject/topic/26174" target="_blank" rel="noreferrer"><span class="contentLinkLabel">讨论版 · 第 12 话</span><span class="contentLinkHint">讨论帖</span></a></li>
    <li class="contentLinkRow"><a class="contentLink" href="https://frieren-anime.jp/" target="_blank" rel="noreferrer"><span class="contentLinkLabel">动画官网</span><span class="contentLinkHint">外部链接</span></a></li>
  </ul>
</section>'''

# 渲染复刻在页面里的出现顺序（用于 restore 反推模板）
RENDER_ORDER = [
    "subjects-grid", "subjects-list", "subjects-grid", "subjects-list",
    "stats-histogram", "stats-bars", "stats-list",
    "stats-histogram", "stats-bars", "stats-list",
    "progress", "progress",
    "infobox", "infobox",
    "table", "table",
    "timeline", "timeline",
    "tags", "tags",
    "gallery", "gallery",
    "compare", "compare",
    "quote", "quote",
    "callout", "callout",
    "links", "links",
]

TYPE_BLOCKS = {
    "SubjectKind": (53, 53),
    "SubjectCardView": (55, 79),
    "SubjectCollectionView": (81, 89),
    "StatEntryView": (91, 99),
    "StatsView": (101, 110),
    "ProgressView": (112, 122),
    "InfoBoxView": (124, 129),
    "TableView": (131, 137),
    "TimelineView": (139, 143),
    "TagCloudView": (145, 148),
    "GalleryView": (150, 154),
    "CompareView": (156, 161),
    "QuoteView": (163, 169),
    "CalloutView": (171, 176),
    "LinkListView": (178, 182),
}

JSON_ORDER = ["subjects", "stats", "progress", "infobox", "table", "timeline",
              "tags", "gallery", "compare", "quote", "callout", "links"]


# ---------------------------------------------------------------- restore
def restore():
    """由已生成的 HTML 反推模板：把注入内容换回占位符。"""
    text = read(OUT)
    # 先还原 content.css 占位符（样式块里是 CSS 注释形式的占位符）
    css = read(CSS).rstrip()
    if css not in text:
        raise SystemExit("找不到内联的 content.css，无法反推")
    text = text.replace(css, "/*BGM:content-css*/", 1)

    # 渲染复刻：按出现顺序消费
    cursor = 0
    for key in RENDER_ORDER:
        marker_name = "render:" + key
        block = RENDER[key]
        pos = text.find(block, cursor)
        if pos < 0:
            raise SystemExit("找不到渲染复刻: " + marker_name)
        text = text[:pos] + "<!--BGM:%s-->" % marker_name + text[pos + len(block):]
        cursor = pos + len("<!--BGM:%s-->" % marker_name)

    # 示例 JSON
    for name in JSON_ORDER:
        rendered = '<pre class="code">%s</pre>' % highlight(JSON_SAMPLES[name])
        if rendered not in text:
            raise SystemExit("找不到示例 JSON: " + name)
        text = text.replace(rendered, "<!--BGM:json:%s-->" % name)

    # 类型块
    lines = read(PROTOCOL).split("\n")
    for name, (start, end) in TYPE_BLOCKS.items():
        rendered = type_block(lines, start, end)
        if rendered not in text:
            raise SystemExit("找不到类型块: " + name)
        text = text.replace(rendered, "<!--BGM:types:%s-->" % name)

    write(TEMPLATE, text)
    print("已写出模板 %s（%d 字节）" % (TEMPLATE, len(text.encode("utf-8"))))


# ---------------------------------------------------------------- build
def build():
    template = read(TEMPLATE)

    def replace_token(text, token, value):
        marker = "<!--BGM:%s-->" % token
        if marker not in text:
            marker = "/*BGM:%s*/" % token
            if marker not in text:
                raise SystemExit("模板缺少占位符: " + token)
        return text.replace(marker, value)

    lines = read(PROTOCOL).split("\n")
    for name, (start, end) in TYPE_BLOCKS.items():
        template = replace_token(template, "types:" + name, type_block(lines, start, end))
    for name in JSON_ORDER:
        template = replace_token(template, "json:" + name,
                                 '<pre class="code">%s</pre>' % highlight(JSON_SAMPLES[name]))
    for key in RENDER:
        template = replace_token(template, "render:" + key, RENDER[key])
    template = replace_token(template, "content-css", read(CSS).rstrip())

    leftover = re.findall(r"/\*BGM:[^*]*\*/|<!--BGM:[^>]*-->", template)
    if leftover:
        raise SystemExit("仍有未替换的占位符: %s" % sorted(set(leftover)))
    write(OUT, template)
    print("已生成 %s（%d 字节）" % (OUT, len(template.encode("utf-8"))))


if __name__ == "__main__":
    action = sys.argv[1] if len(sys.argv) > 1 else "build"
    if action == "restore":
        restore()
    elif action == "build":
        build()
    else:
        raise SystemExit("用法: build_component_library.py restore|build")
