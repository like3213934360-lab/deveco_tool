#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const skillRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const indexPath = path.join(skillRoot, 'references', 'component-practice-index.json');

function usage() {
  console.log(`ArkUI 组件实践检索

Usage:
  node scripts/search-practices.mjs <关键词或组件名> [--limit=10] [--json]

Examples:
  node scripts/search-practices.mjs 堆叠
  node scripts/search-practices.mjs Swiper --limit=5
  node scripts/search-practices.mjs "List Refresh" --limit=5
  node scripts/search-practices.mjs "Grid 拖拽"
  node scripts/search-practices.mjs "Scroll 嵌套"
  node scripts/search-practices.mjs "Image SVG"
  node scripts/search-practices.mjs "Video 全屏"
  node scripts/search-practices.mjs "TextInput 软键盘"
  node scripts/search-practices.mjs Checkbox
  node scripts/search-practices.mjs Navigation --json`);
}

function parseArgs(argv) {
  const queryParts = [];
  let limit = 10;
  let asJson = false;

  for (const arg of argv) {
    if (arg === '--help' || arg === '-h') {
      return { help: true };
    }
    if (arg === '--json') {
      asJson = true;
      continue;
    }
    if (arg.startsWith('--limit=')) {
      const value = Number(arg.slice('--limit='.length));
      if (Number.isFinite(value) && value > 0) limit = Math.min(Math.floor(value), 50);
      continue;
    }
    queryParts.push(arg);
  }

  return { query: queryParts.join(' ').trim(), limit, asJson };
}

function addTerms(set, terms) {
  for (const term of terms) {
    const value = String(term || '').trim();
    if (value) set.add(value);
  }
}

function expandQuery(query) {
  const terms = new Set();
  addTerms(terms, [query]);
  addTerms(terms, query.split(/[\s,，、|/]+/));

  const scenarios = [
    [/堆叠|层叠|露出|卡片轮播|覆盖|遮罩/i, ['Stack', 'Swiper', '堆叠', '层叠', 'offset', 'zIndex', '露出下一张']],
    [/轮播|Swiper|指示器|自动播放|禁止切换|滑动误触/i, ['Swiper', '轮播', '指示器', '滑动切换', '点击事件']],
    [/列表|长列表|下拉|上拉|加载更多|刷新|LazyForEach|ListItem/i, ['List', 'ListItem', 'LazyForEach', 'Refresh', 'onScrollIndex', '加载更多']],
    [/网格|九宫格|宫格|合并|行列|Grid|GridItem|拖拽网格/i, ['Grid', 'GridItem', 'columnsTemplate', 'rowsTemplate', '合并单元格', '拖拽']],
    [/滚动|滑动冲突|嵌套滑动|Scroll|滚动位置|可滚动/i, ['Scroll', '嵌套滑动', '滑动冲突', '滚动位置']],
    [/页签|Tab|Tabs|TabContent|TabBar|预加载|生命周期/i, ['Tabs', 'TabContent', 'TabBar', '生命周期', '预加载']],
    [/导航|路由|跳转|返回|标题栏|白屏|Navigation|NavDestination|NavPathStack/i, ['Navigation', 'NavDestination', 'NavPathStack', '页面跳转', '返回参数']],
    [/输入|键盘|软键盘|焦点|光标|placeholder|失焦|TextInput|TextArea/i, ['TextInput', 'TextArea', 'Search', '焦点', '软键盘', '光标']],
    [/图片|Image|SVG|裁剪|圆角|objectFit/i, ['Image', 'SVG', 'objectFit', '裁剪', '本地图片']],
    [/视频|Video|全屏|播放|黑屏|控制栏/i, ['Video', '全屏', '播放进度', '预览黑屏', '控制栏']],
    [/文本|文字|(^|[\s,，、|/])Text($|[\s,，、|/])|Span|换行|省略|溢出/i, ['Text', 'Span', '换行', '省略', '溢出']],
    [/横向|水平|Row/i, ['Row', '横向布局', '水平排列']],
    [/纵向|垂直|Column/i, ['Column', '纵向布局', '垂直排列']],
    [/Checkbox|CheckboxGroup|Radio|Toggle|Button|复选|多选|反选|全选|单选|开关|按钮/i, ['Checkbox', 'CheckboxGroup', 'Radio', 'Toggle', 'Button', '选择控件']],
    [/Slider|Progress|DataPanel|Rating|Badge|滑块|进度|评分|角标|红点/i, ['Slider', 'Progress', 'DataPanel', 'Rating', 'Badge', '反馈控件']],
    [/Picker|Select|Menu|DatePicker|TimePicker|TextPicker|PatternLock|选择器|下拉|菜单|日期|时间|手势密码/i, ['Select', 'Menu', 'DatePicker', 'TimePicker', 'TextPicker', 'PatternLock']],
    [/Flex|RelativeContainer|ColumnSplit|弹性布局|相对布局|分栏|换行/i, ['Flex', 'RelativeContainer', 'ColumnSplit', '布局容器']],
    [/XComponent|Native|Surface|原生渲染|纹理|OpenGL/i, ['XComponent', 'Native', 'Surface', '原生渲染']],
    [/Circle|Polygon|Polyline|Shape|圆形|多边形|折线|绘制/i, ['Circle', 'Polygon', 'Polyline', 'Shape', '绘制']],
  ];

  for (const [pattern, extraTerms] of scenarios) {
    if (pattern.test(query)) addTerms(terms, extraTerms);
  }

  return [...terms].filter(Boolean);
}

function normalize(value) {
  return String(value || '').toLowerCase();
}

function scoreEntry(entry, query, terms) {
  const title = normalize(entry.title);
  const components = entry.components || [];
  const componentText = normalize(components.join('|'));
  const keywordText = normalize((entry.keywords || []).join('|'));
  const reference = normalize(entry.recommendedReference);
  const pathText = normalize(entry.path);
  const raw = normalize(query);
  const originalTerms = query.split(/[\s,，、|/]+/).map(normalize).filter(Boolean);
  let score = 0;

  if (raw && title.includes(raw)) score += 14;
  for (const term of originalTerms) {
    if (title.includes(term)) score += 12;
  }
  if (originalTerms.length > 1 && originalTerms.every(term => title.includes(term))) {
    score += 20;
  }

  for (const term of terms) {
    const t = normalize(term);
    if (!t) continue;
    if (title.includes(t)) score += 8;
    if (components.map(normalize).includes(t)) score += 7;
    else if (componentText.includes(t)) score += 4;
    if (keywordText.includes(t)) score += 4;
    if (reference.includes(t)) score += 2;
    if (pathText.includes(t)) score += 1;
  }

  if (/堆叠|层叠|露出|卡片轮播/.test(query)) {
    if (components.includes('Stack')) score += 20;
    if (components.includes('Swiper')) score += 8;
    if (entry.recommendedReference === 'references/stack-patterns.md') score += 8;
    if (/Stack组件实现Swiper堆叠/.test(entry.title)) score += 20;
  }

  if (/导航|路由|跳转|返回|标题栏|白屏|Navigation/i.test(query)) {
    if (components.includes('Navigation')) score += 12;
    if (components.includes('NavDestination')) score += 10;
  }

  if (/输入|键盘|软键盘|焦点|光标|TextInput|TextArea/i.test(query)) {
    if (components.includes('TextInput')) score += 12;
    if (components.includes('TextArea')) score += 10;
    if (components.includes('Search')) score += 6;
  }

  if (/列表|List|Grid|Scroll|Refresh|滚动|网格/i.test(query)) {
    for (const c of ['List', 'Grid', 'Scroll', 'Refresh', 'GridItem', 'ListItem']) {
      if (components.includes(c)) score += 8;
    }
  }

  const boosts = [
    [/轮播|Swiper|指示器|自动播放/i, ['Swiper']],
    [/Checkbox|Radio|Toggle|Button|复选|多选|反选|全选|单选|开关|按钮/i, ['Checkbox', 'CheckboxGroup', 'Radio', 'Toggle', 'Button', 'SaveButton', 'DownloadFileButton']],
    [/Slider|Progress|DataPanel|Rating|Badge|滑块|进度|评分|角标|红点/i, ['Slider', 'Progress', 'DataPanel', 'Rating', 'Badge']],
    [/Picker|Select|Menu|DatePicker|TimePicker|TextPicker|PatternLock|选择器|下拉|菜单|日期|时间/i, ['Select', 'Menu', 'DatePicker', 'TimePicker', 'TextPicker', 'PatternLock']],
    [/Flex|RelativeContainer|ColumnSplit|弹性布局|相对布局|分栏/i, ['Flex', 'RelativeContainer', 'ColumnSplit']],
    [/XComponent|Native|Surface|原生渲染|纹理|OpenGL/i, ['XComponent']],
    [/Circle|Polygon|Polyline|Shape|圆形|多边形|折线|绘制/i, ['Circle', 'Polygon', 'Polyline']],
  ];

  for (const [pattern, names] of boosts) {
    if (pattern.test(query)) {
      for (const c of names) {
        if (components.includes(c)) score += 10;
      }
    }
  }

  return score;
}

function formatResult(entry, index) {
  return `${index + 1}. ${entry.title}
   组件: ${entry.components.join(', ') || '-'} | 分类: ${entry.articleClass} | 场景: ${entry.scenario || '-'}
   Reference: ${entry.recommendedReference}
   链接: ${entry.url}
   本地原料(可选): ${entry.sourcePaths.markdown}`;
}

/**
 * 从 .md 参考文档中提取结构化摘要
 * 识别的章节标题模式：状态模型/状态管理、事件处理/常用骨架、常见坑/常见问题、实践要点/推荐模式
 */
function extractSummary(mdContent) {
  const summary = {
    stateManagement: [],
    eventHandlers: [],
    commonPitfalls: [],
    bestPatterns: [],
  };

  // 按小标题分割内容
  const sections = mdContent.split(/^## /m).filter(Boolean);

  for (const section of sections) {
    const title = section.split('\n')[0].trim();
    const body = section.slice(section.indexOf('\n') + 1);

    // 提取无序列表项（- xxx 或 * xxx）
    const bullets = [...body.matchAll(/^[\s]*[-*]\s+(.+)$/gm)].map(m => m[1].trim());

    // 提取代码块中的状态声明（@State xxx: Type = ...）
    const stateDecls = [...body.matchAll(/@(State|Prop|Link|Local|Provide|Consume)\s+(\w+)\s*:\s*(\w+)/g)]
      .map(m => `@${m[1]} ${m[2]}: ${m[3]}`);

    // 按标题匹配分类
    if (/状态模型|状态管理|状态声明/i.test(title)) {
      summary.stateManagement.push(...stateDecls, ...bullets);
    } else if (/事件处理|常用骨架|事件绑定|交互逻辑/i.test(title)) {
      summary.eventHandlers.push(...bullets);
    } else if (/常见坑|常见问题|陷阱|注意事项|避坑/i.test(title)) {
      summary.commonPitfalls.push(...bullets);
    } else if (/实践要点|推荐模式|推荐结构|组件选择|回答用户/i.test(title)) {
      summary.bestPatterns.push(...bullets);
    }
  }

  // 去重并限制每类最多 8 条
  for (const key of Object.keys(summary)) {
    summary[key] = [...new Set(summary[key])].slice(0, 8);
  }

  return summary;
}

/**
 * 将检索结果按组件类型聚合为 byComponent 映射
 */
function buildByComponent(results, skillRoot) {
  const byComponent = {};

  for (const entry of results) {
    const components = entry.components || [];
    const refPath = entry.recommendedReference;

    for (const comp of components) {
      if (!byComponent[comp]) {
        byComponent[comp] = {
          practiceFile: refPath,
          relevanceScore: (entry.score || 0) / 100,
          matchedTerms: [],
          summary: {
            stateManagement: [],
            eventHandlers: [],
            commonPitfalls: [],
            bestPatterns: [],
          },
        };
      }

      // 记录关联的实践文档（取最高分的那篇）
      if ((entry.score || 0) > (byComponent[comp].relevanceScore * 100)) {
        byComponent[comp].practiceFile = refPath;
        byComponent[comp].relevanceScore = (entry.score || 0) / 100;
      }

      // 合并匹配关键词
      if (entry.keywords) {
        byComponent[comp].matchedTerms = [...new Set([...byComponent[comp].matchedTerms, ...entry.keywords])].slice(0, 10);
      }
    }

    // 尝试读取 .md 文件提取摘要（仅对 practiceFile 读取一次）
    if (refPath && byComponent[Object.keys(byComponent).find(k => byComponent[k].practiceFile === refPath) || '']) {
      const targetComp = Object.keys(byComponent).find(k => byComponent[k].practiceFile === refPath);
      if (targetComp && byComponent[targetComp].summary.stateManagement.length === 0) {
        try {
          const mdFullPath = path.join(skillRoot, refPath);
          if (fs.existsSync(mdFullPath)) {
            const mdContent = fs.readFileSync(mdFullPath, 'utf8');
            const extracted = extractSummary(mdContent);
            // 将摘要写入所有关联此 practiceFile 的组件
            for (const comp of components) {
              if (byComponent[comp] && byComponent[comp].practiceFile === refPath) {
                byComponent[comp].summary = extracted;
              }
            }
          }
        } catch {
          // 摘要提取失败，保持空对象
        }
      }
    }
  }

  return byComponent;
}

const options = parseArgs(process.argv.slice(2));
if (options.help || !options.query) {
  usage();
  process.exit(options.help ? 0 : 1);
}

const index = JSON.parse(fs.readFileSync(indexPath, 'utf8'));
const terms = expandQuery(options.query);
const results = index.entries
  .map(entry => ({ entry, score: scoreEntry(entry, options.query, terms) }))
  .filter(item => item.score > 0)
  .sort((a, b) => b.score - a.score || a.entry.title.localeCompare(b.entry.title, 'zh-Hans-CN'))
  .slice(0, options.limit)
  .map(item => ({ score: item.score, ...item.entry }));

if (options.asJson) {
  // 构建 byComponent 映射（结构化摘要）
  const byComponent = buildByComponent(results, skillRoot);

  // 兜底：所有实践文档的完整列表（向后兼容）
  const allPractices = [...new Set(results.map(r => r.recommendedReference).filter(Boolean))];

  console.log(JSON.stringify({
    query: options.query,
    terms,
    totalMatches: results.length,
    byComponent,
    allPractices,
    timestamp: new Date().toISOString(),
    results,
  }, null, 2));
  process.exit(0);
}

console.log(`ArkUI 组件实践检索: ${options.query}`);
console.log(`扩展关键词: ${terms.join(', ')}`);
console.log(`命中展示: ${results.length} / ${index.articleCount}`);

if (!results.length) {
  console.log('没有命中。可尝试组件名或场景词，例如 Stack、Swiper、List、Grid、Tabs、Navigation、TextInput、Image、Video、Checkbox、Slider、TextPicker、XComponent、堆叠、软键盘。');
  process.exit(0);
}

console.log('');
console.log(results.map(formatResult).join('\n\n'));
