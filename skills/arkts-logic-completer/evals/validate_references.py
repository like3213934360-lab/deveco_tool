#!/usr/bin/env python3
"""
静态校验脚本：检查 arkts-logic-completer 的 Reference 文件结构、
交叉引用一致性和代码示例中的 ArkTS 合规性。

用法：python validate_references.py

── 编辑 Reference 时请先读 TODO.md 里的"Reference 写作硬约束" ──
精简版要点：
  1. API 必须可溯源——原文没有就不要发明，模型会直接照抄；
  2. 第 9 节速查只做第 5 节的压缩，禁止新增行；
  3. 语义冲突时以官方示例为准，引用示例行号作为依据；
  4. 任何改动 0 错 0 警；校验告警先改文档，不要轻易放宽规则；
  5. 关键词兜底词禁用 `interface` / `@State` / `import` 等高频词。
"""

import os
import re
import sys
import json
from pathlib import Path
from typing import NamedTuple

SKILL_DIR = Path(__file__).resolve().parent.parent
REFS_DIR = SKILL_DIR / "references"
SKILL_MD = SKILL_DIR / "SKILL.md"
REPO_ROOT = SKILL_DIR.parent.parent
README_MD = REPO_ROOT / "README.md"
TODO_MD = SKILL_DIR / "TODO.md"
EVALS_JSON = SKILL_DIR / "evals" / "evals.json"
ARKTS_COMPAT_MD = REPO_ROOT / "ARKTS_COMPAT_ISSUES.md"

# ArkTS 五条硬红线的主题关键词:每条规则必须命中其中一个"强关键词",
# 视为该处文件包含了这条规则(允许两处文件用不同措辞)。
# 这里刻意避开 `interface` / `@State` 这类在任意 Reference 里都会频繁出现的
# 兜底词 —— 否则即便整段规则被误删,关键词也会"到处都命中",校验形同虚设。
ARKTS_RULE_THEMES: list[tuple[str, list[str]]] = [
    ("对象展开",     ["对象展开", "arkts-no-spread", r"\{\s*\.\.\."]),
    ("struct getter", ["get 访问器", "getter", r"\bget\s+\w+\s*\("]),
    ("箭头函数类型",  ["箭头函数", "显式类型", "类型标注"]),
    ("对象字面量",    ["对象字面量", "arkts-no-untyped-obj-literals",
                      "类型化对象字面量", "typed object literal"]),
    ("@State 联合",   ["联合字面量", "联合字符串", "union literal",
                      "arkts-no-state-enum", r"@State[^\n]{0,80}?'[^']+'\s*\|"]),
]

REQUIRED_SECTIONS = [
    "## 1. 功能定位",
    "## 2. 典型场景",
    "## 3. 状态声明",
    "## 4. 事件与交互逻辑",
    "## 5. 数据结构",
    "## 6. 联动说明",
    "## 7. 完整代码示例",
    "## 8. 反面示例",
    "## 9. API 速查",
]

# ArkTS 禁止语法的正则（用于正例代码块检测，排除注释和 ❌ 行）
ARKTS_FORBIDDEN = [
    # { ...identifier 才是真正的对象展开；{ ... } 是占位省略号，不算
    (r'\{\s*\.\.\.[a-zA-Z_]', "对象展开运算符 { ...obj }"),
    (r'\bget\s+\w+\s*\(', "struct getter（get xxx()）"),
    (r"@State\s+\w+\s*:\s*'[^']+'\s*\|", "@State 联合字面量类型"),
]


class Issue(NamedTuple):
    file: str
    level: str  # ERROR / WARN
    message: str


issues: list[Issue] = []


def add(file: str, level: str, msg: str):
    issues.append(Issue(file, level, msg))


# ── 1. Reference 文件模板合规 ──────────────────────────────
def check_template_compliance():
    for md in sorted(REFS_DIR.glob("*.md")):
        content = md.read_text(encoding="utf-8")
        name = md.name

        for section in REQUIRED_SECTIONS:
            if section not in content:
                add(name, "ERROR", f"缺少标准章节：{section}")

        bad_markers = content.count("❌")
        if bad_markers < 2:
            add(name, "WARN", f"反面示例中 ❌ 标记只有 {bad_markers} 个，建议至少 2 个")


# ── 2. SKILL.md 索引 ↔ 实际文件对齐 ──────────────────────
def check_index_alignment():
    skill_content = SKILL_MD.read_text(encoding="utf-8")
    actual_files = {f.stem for f in REFS_DIR.glob("*.md")}

    # 从 SKILL.md 的 markdown 链接中提取 references/XXX.md
    linked = set()
    for m in re.finditer(r'\[references/(\w+)\.md\]', skill_content):
        linked.add(m.group(1))

    missing_in_skill = actual_files - linked
    missing_on_disk = linked - actual_files

    for name in sorted(missing_in_skill):
        add("SKILL.md", "ERROR", f"文件 {name}.md 存在但未出现在索引表中")
    for name in sorted(missing_on_disk):
        add("SKILL.md", "ERROR", f"索引表引用了 {name}.md 但文件不存在")


# ── 3. 数量一致性（README / SKILL / TODO 声称的数字） ──────
def check_count_consistency():
    actual_count = len(list(REFS_DIR.glob("*.md")))

    for path, label in [(SKILL_MD, "SKILL.md"), (README_MD, "README.md"), (TODO_MD, "TODO.md")]:
        if not path.exists():
            add(label, "WARN", f"文件不存在，跳过数量校验")
            continue
        content = path.read_text(encoding="utf-8")
        # 匹配 "38 个组件" / "38 个高频组件" / "38 个 Reference" 等紧凑声明
        for m in re.finditer(r'(\d+)\s*个\s*(?:高频\s*)?(?:组件|Reference|component)', content):
            claimed = int(m.group(1))
            if claimed != actual_count:
                add(label, "ERROR",
                    f"声称 {claimed} 个组件，实际 {actual_count} 个 → 行内容：{m.group(0)[:60]}")


# ── 4. 正例代码中的 ArkTS 合规检查 ──────────────────────────
def check_arkts_compliance():
    for md in sorted(REFS_DIR.glob("*.md")):
        content = md.read_text(encoding="utf-8")
        name = md.name

        in_code_block = False
        in_bad_example = False
        for i, line in enumerate(content.split("\n"), 1):
            if line.strip().startswith("```"):
                in_code_block = not in_code_block
                continue

            if not in_code_block:
                # §8 反面示例区域跨越多个代码块，只能由 H2 标题退出。
                # 注意：`### ❌ xxx` 是 H3 小标题，仍在反例区内，不应退出。
                if line.startswith("## ") and "反面示例" not in line and "## 8." not in line:
                    in_bad_example = False
                if "## 8." in line or "反面示例" in line:
                    in_bad_example = True
                continue

            # 跳过反面示例区域和 ❌ 注释行
            if in_bad_example:
                continue
            if "❌" in line or line.strip().startswith("//"):
                continue

            for pattern, desc in ARKTS_FORBIDDEN:
                if re.search(pattern, line):
                    add(name, "WARN", f"第 {i} 行正例代码疑似包含禁止语法 [{desc}]：{line.strip()[:80]}")


# ── 5. TODO.md 分类数字加总 ──────────────────────────────
def check_todo_category_sum():
    if not TODO_MD.exists():
        return
    content = TODO_MD.read_text(encoding="utf-8")
    # 匹配 "基础交互 9 / 文本输入 5 / ... / 其他 3 [/ HDS 组件 2]" 这类模式
    # HDS 组件分类为可选(向下兼容老版本没有 HDS 的写法)
    m = re.search(
        r'基础交互\s*(\d+).*?文本输入\s*(\d+).*?数据展示\s*(\d+).*?选择器\s*(\d+)'
        r'.*?导航布局\s*(\d+).*?弹窗浮层\s*(\d+).*?其他\s*(\d+)'
        r'(?:.*?HDS\s*组件\s*(\d+))?',
        content,
    )
    if m:
        nums = [int(m.group(i)) for i in range(1, 8)]
        if m.group(8):
            nums.append(int(m.group(8)))
        total = sum(nums)
        actual_count = len(list(REFS_DIR.glob("*.md")))
        if total != actual_count:
            add("TODO.md", "ERROR",
                f"分类加总 {'+'.join(map(str, nums))}={total}，实际文件 {actual_count} 个")


# ── 6. 完整代码示例必须包含 @Entry 代码块 ─────────────────
def check_entry_example():
    """每份 Reference 的 `## 7. 完整代码示例` 段落必须至少包含一个 @Entry struct。

    防止 Reference 偷懒只写片段、没给可直接运行的完整示例。
    """
    for md in sorted(REFS_DIR.glob("*.md")):
        content = md.read_text(encoding="utf-8")
        name = md.name

        # 截取 "## 7. 完整代码示例" ~ 下一个 H2 之间
        m = re.search(r"## 7\.\s*完整代码示例\b(.*?)(?=\n##\s|\Z)", content, re.DOTALL)
        if not m:
            continue  # 缺章节本身由 check_template_compliance 负责
        section = m.group(1)
        if "@Entry" not in section:
            add(name, "WARN", "完整代码示例中缺少 @Entry struct，建议给出可直接运行的入口组件")


# ── 7. API 速查表至少 3 行数据 ─────────────────────────
def check_api_table_size():
    """`## 9. API 速查` 里的表格数据行 ≥ 3 行，避免草率表格。"""
    for md in sorted(REFS_DIR.glob("*.md")):
        content = md.read_text(encoding="utf-8")
        name = md.name

        m = re.search(r"## 9\.\s*API 速查\b(.*?)(?=\n##\s|\Z)", content, re.DOTALL)
        if not m:
            continue
        section = m.group(1)

        # 匹配 markdown 表格数据行:以 | 开头、不是分隔行 (---|---) 或表头行
        data_rows = 0
        seen_separator = False
        for line in section.split("\n"):
            stripped = line.strip()
            if not stripped.startswith("|"):
                continue
            if re.match(r"^\|\s*[-:]+\s*(\|\s*[-:]+\s*)+\|?\s*$", stripped):
                seen_separator = True
                continue
            if seen_separator:
                data_rows += 1

        if data_rows < 3:
            add(name, "WARN", f"API 速查表只有 {data_rows} 行数据，建议 ≥ 3 行")


# ── 8. 交叉引用:文中指向的其他 Reference 必须存在 ────────
def check_cross_refs():
    """文档中以 [Xxx](Xxx.md) 形式引用到同目录其他 Reference 时,目标必须存在。"""
    actual = {f.name for f in REFS_DIR.glob("*.md")}
    for md in sorted(REFS_DIR.glob("*.md")):
        content = md.read_text(encoding="utf-8")
        name = md.name
        # 相对路径的 md 链接:不带 ./ 或 ../ 前缀,纯文件名
        for m in re.finditer(r"\]\(([^)/#\s]+\.md)(?:#[^)]+)?\)", content):
            target = m.group(1)
            if target == name:
                continue
            if target not in actual:
                add(name, "WARN", f"交叉引用 [{target}] 指向的文件在 references/ 下不存在")


# ── 9. ArkTS 5 条规则在权威/内联两处同源文件中都存在 ─────────────
def check_arkts_rules_sync():
    """ArkTS 语法限制应在两处保持一致:

    - repo-root/ARKTS_COMPAT_ISSUES.md            权威详细版
    - arkts-logic-completer/SKILL.md              Skill 内联精简版

    检查原则:两处都必须提到全部 5 条规则主题(用关键词匹配,允许措辞不同)。
    任一文件漏条,报 ERROR;文件不存在时报 WARN 并跳过。
    """
    targets = [
        ("ARKTS_COMPAT_ISSUES.md",         ARKTS_COMPAT_MD),
        ("arkts-logic-completer/SKILL.md", SKILL_MD),
    ]

    texts: dict[str, str] = {}
    for label, path in targets:
        if not path.exists():
            add(label, "WARN", "ArkTS 规则同源文件不存在,一致性检查跳过")
            continue
        texts[label] = path.read_text(encoding="utf-8")

    if len(texts) < 2:
        return  # 少于 2 处没法对比

    for rule_name, keywords in ARKTS_RULE_THEMES:
        patterns = [re.compile(kw) for kw in keywords]
        for label, content in texts.items():
            if not any(p.search(content) for p in patterns):
                add(label, "ERROR",
                    f"ArkTS 规则『{rule_name}』缺失(未命中任一关键词:{' / '.join(keywords)})")


# 出现在 SKILL.md 索引表里、但本质是 ArkTS 语法原语/枚举/类型的词,
# 不需要独立 Reference
ARKTS_PRIMITIVES: set[str] = {
    "ForEach", "LazyForEach",           # 列表循环
    "ArkTS", "TypeScript",              # 语言
    "AppStorage", "LocalStorage",       # V1 状态容器(非 UI 组件)
    "AppStorageV2", "PersistenceV2",    # V2 状态容器(非 UI 组件)
    "LengthMetrics",                    # 类型
    "Record",                           # TypeScript 内置类型
    "IMonitor",                         # V2 状态管理回调参数类型
    "NavPathStack",                     # Navigation 的路由栈类,收编到 Navigation 下方
    "FormErrors",                       # 表单校验示例中常出现的 interface 名
}

# 父组件收编的子组件/样式类 —— 出现在 eval 里时应落到父组件 Reference。
# 只在"父 Reference 已经存在"时才收编,否则无法触发真正的缺失告警。
#
# 注意:Tabs.md 目前尚未落地,对应 `TabContent` / `BottomTabBarStyle` /
# `SubTabBarStyle` 暂不收编。一旦 Tabs.md 补上、SKILL.md 索引里新增
# `` `Tabs` ``,再把它们挪回这里。
CHILD_TO_PARENT: dict[str, str] = {
    "ListItem":          "List",
    "ListItemGroup":     "List",
    "MenuItem":          "Menu",
    "MenuItemGroup":     "Menu",
    "SwiperIndicator":   "Swiper",
}


# ── 10. evals.json 考到的组件都能在 references/ 解析到 ───
def check_evals_coverage():
    """evals.json 里提到的组件,都必须能解析到 references/ 下某份 Reference。

    只对"SKILL.md 组件索引表里用反引号明确列出的组件"判 ERROR,这样能避免
    把 ForEach / LongPress 等语法/枚举误判成组件。子组件(ListItem / MenuItem 等)
    自动回落到父组件 Reference。
    """
    if not EVALS_JSON.exists():
        add("evals.json", "WARN", "文件不存在,覆盖率检查跳过")
        return

    try:
        data = json.loads(EVALS_JSON.read_text(encoding="utf-8"))
    except json.JSONDecodeError as e:
        add("evals.json", "ERROR", f"JSON 解析失败:{e}")
        return

    if not SKILL_MD.exists():
        add("evals.json", "WARN", "SKILL.md 不存在,覆盖率检查跳过")
        return

    skill_content = SKILL_MD.read_text(encoding="utf-8")
    reference_names = {f.stem for f in REFS_DIR.glob("*.md")}

    # 只有在 SKILL.md 的组件索引表里用反引号标出、且不是 ArkTS 原语的才算组件
    indexed_components = set(re.findall(r"`([A-Z][a-zA-Z]+)`", skill_content))
    indexed_components -= ARKTS_PRIMITIVES

    # 覆盖三类名字:
    #   1) 单词根(Swiper / Toggle / List)
    #   2) 标准驼峰(TextInput / TabContent / HdsNavigation)
    #   3) 带全大写后缀或中段(MultiWindowEntryInAPP / IoT)
    # `[A-Z]+(?=[A-Z][a-z]|\b)` 段专门吃连续大写,后面只能跟"新驼峰段"或词尾,
    # 避免把普通常量拆错。
    component_pattern = re.compile(
        r"\b([A-Z][a-z]+(?:[A-Z][a-z]*|[A-Z]+(?=[A-Z][a-z]|\b))*)\b"
    )

    for ev in data.get("evals", []):
        eid = ev.get("id", "?")
        parts: list[str] = [ev.get("prompt", ""), ev.get("expected_output", "")]
        for a in ev.get("assertions", []):
            parts.append(a.get("text", ""))
        text = "\n".join(parts)

        # 抽出所有 PascalCase 词,再按"子 -> 父"收编
        mentioned: set[str] = set()
        for m in component_pattern.finditer(text):
            word = m.group(1)
            mentioned.add(CHILD_TO_PARENT.get(word, word))

        # 对这次用例里确实提到的组件,逐个验证
        for name in sorted(mentioned):
            if name not in indexed_components:
                continue  # 不在 SKILL.md 索引里,视为非组件(枚举/原语/样式类)
            if name in reference_names:
                continue
            add("evals.json", "ERROR",
                f"用例 {eid} 涉及组件 `{name}` 但 references/{name}.md 不存在")


# ── 11. README 目录树 ↔ 实际文件对齐 ──────────────────────
def check_readme_tree():
    if not README_MD.exists():
        return
    content = README_MD.read_text(encoding="utf-8")
    actual_files = {f.name for f in REFS_DIR.glob("*.md")}

    tree_files = set()
    in_refs_block = False
    # 当前是否在 references/ 的某个子目录里面(如 patterns/)。
    # 记录子目录所在行的缩进长度:若后续行缩进更深 → 仍在子目录;缩进同等或更浅 → 退出子目录。
    # 这样即便 patterns/ 之后再在 references/ 根目录里加文件,也不会被静默漏检。
    subdir_indent: int | None = None

    def _indent_of(s: str) -> int:
        """返回 tree 行里 `├`/`└` 之前的前缀字符数,用于比较深度;无则 -1。"""
        mi = re.match(r'^(.*?)[├└]', s)
        return len(mi.group(1)) if mi else -1

    for line in content.split("\n"):
        if "references/" in line and "├" not in line and "│" not in line:
            continue
        if re.search(r'references/?$', line):
            in_refs_block = True
            subdir_indent = None
            continue
        if not in_refs_block:
            continue

        indent = _indent_of(line)

        # 如果当前处于某个子目录块里,检查是否退出。
        if subdir_indent is not None:
            if indent > subdir_indent:
                # 缩进更深 → 子目录内的文件,跳过(patterns/ 下的 .md 不参与根对齐)
                continue
            # 缩进同级或更浅 → 退出子目录,继续后面的正常处理
            subdir_indent = None

        # 检测是否退出整个 references/ 块(同级的 evals/ / SKILL.md / TODO.md)
        if re.search(r'[├└].*?(?:evals|TODO|SKILL)', line):
            in_refs_block = False
            continue

        # 子目录开始(如 patterns/):记录缩进,后续判断退出
        if re.search(r'[├└].*?[A-Za-z0-9_-]+/\s*(?:#.*)?$', line):
            subdir_indent = indent
            continue

        # 普通根级 .md
        m = re.search(r'[├└│].*?([\w-]+\.md)', line)
        if m:
            tree_files.add(m.group(1))

    missing_in_tree = actual_files - tree_files
    extra_in_tree = tree_files - actual_files

    for name in sorted(missing_in_tree):
        add("README.md", "WARN", f"文件 {name} 存在但未在 README 目录树中列出")
    for name in sorted(extra_in_tree):
        add("README.md", "ERROR", f"README 目录树列出了 {name} 但文件不存在")


# ── 运行 ──────────────────────────────────────────────────
def main():
    print("=" * 60)
    print("arkts-logic-completer 静态校验")
    print("=" * 60)

    actual_count = len(list(REFS_DIR.glob("*.md")))
    print(f"\nReference 文件数量：{actual_count}")
    print(f"SKILL.md 路径：{SKILL_MD}")
    print()

    check_template_compliance()
    check_index_alignment()
    check_count_consistency()
    check_arkts_compliance()
    check_entry_example()
    check_api_table_size()
    check_cross_refs()
    check_arkts_rules_sync()
    check_evals_coverage()
    check_todo_category_sum()
    check_readme_tree()

    errors = [i for i in issues if i.level == "ERROR"]
    warns = [i for i in issues if i.level == "WARN"]

    if not issues:
        print("✅ 全部通过，未发现问题！\n")
        return 0

    if errors:
        print(f"❌ 发现 {len(errors)} 个错误：\n")
        for iss in errors:
            print(f"  ERROR  [{iss.file}] {iss.message}")

    if warns:
        print(f"\n⚠️  发现 {len(warns)} 个警告：\n")
        for iss in warns:
            print(f"  WARN   [{iss.file}] {iss.message}")

    print(f"\n总计：{len(errors)} 错误，{len(warns)} 警告")
    return 1 if errors else 0


if __name__ == "__main__":
    sys.exit(main())
