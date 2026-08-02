# ArkUI 组件实践索引

## 当前语料来源

当前已整理华为开发者“行业实践与常见问题”中的 ArkUI 组件相关文章：

- 组件相关文章：405 篇
- 原子组件文章：72 篇
- 其他组件文章：333 篇
- 本地语料目录：`/Users/beijixing/Documents/New project/downloads/arkui-component-articles`
- 索引表：`/Users/beijixing/Documents/New project/downloads/arkui-component-articles/manifest.csv`
- 轻量分发索引：`references/component-practice-index.json`
- 文章覆盖地图：`references/article-coverage-map.md`

## 原子组件分类

原子组件只包括：

- `Text`
- `Row`
- `Column`
- `Image`
- `Video`

合集：

- `downloads/arkui-component-articles/arkui-component-articles-basic-full.md`
- 单篇：`downloads/arkui-component-articles/markdown/basic/`

## 细分场景覆盖

405 篇文章不会作为全文打包进 skill，而是映射到以下细分 reference：

| Reference | 场景 | 文章数 |
|---|---|---:|
| `references/list-lazy-refresh-patterns.md` | List/LazyForEach/Refresh 列表刷新 | 54 |
| `references/navigation-routing-patterns.md` | Navigation/NavDestination 路由 | 46 |
| `references/swiper-carousel-patterns.md` | Swiper 轮播滑动 | 40 |
| `references/text-rich-display-patterns.md` | Text/Span/RichText 文本展示 | 40 |
| `references/input-focus-keyboard-patterns.md` | Input/Focus/Keyboard 输入焦点键盘 | 39 |
| `references/image-resource-fit-patterns.md` | Image 资源加载适配 | 34 |
| `references/tabs-patterns.md` | Tabs/TabContent 页签 | 32 |
| `references/grid-drag-layout-patterns.md` | Grid/GridItem 拖拽网格 | 22 |
| `references/slider-progress-feedback-patterns.md` | Slider/Progress 反馈与数值控件 | 20 |
| `references/scroll-nested-gesture-patterns.md` | Scroll/Nested Gesture 嵌套滚动手势 | 18 |
| `references/video-playback-fullscreen-patterns.md` | Video 播放全屏 | 14 |
| `references/selection-controls-patterns.md` | Selection/Button 选择与按钮控件 | 12 |
| `references/layout-containers-patterns.md` | Flex/RelativeContainer 布局容器 | 11 |
| `references/picker-select-menu-patterns.md` | Picker/Select/Menu 选择器菜单 | 9 |
| `references/stack-patterns.md` | Stack 层叠堆叠 | 6 |
| `references/drawing-shape-patterns.md` | Shape 绘制组件 | 4 |
| `references/xcomponent-native-patterns.md` | XComponent 原生渲染桥接 | 4 |

如果要回答“某篇文章归到哪类”，读 `article-coverage-map.md`；如果要按关键词查，运行 `scripts/search-practices.mjs`。

## 其他组件分类

其他组件包括容器、布局、导航、复杂交互、输入、列表网格、刷新、页签等，例如：

- `List`
- `Grid`
- `Scroll`
- `Flex`
- `Stack`
- `Swiper`
- `Tabs`
- `Navigation`
- `NavDestination`
- `TextInput`
- `TextArea`
- `Refresh`
- `XComponent`

合集：

- `downloads/arkui-component-articles/arkui-component-articles-other-full.md`
- 单篇：`downloads/arkui-component-articles/markdown/other/`

## 组件命中数

| 组件 | 文章数 | 分类 |
|---|---:|---|
| List | 45 | other |
| Swiper | 43 | other |
| Navigation | 36 | other |
| Text | 35 | basic |
| Tabs | 32 | other |
| TextInput | 30 | other |
| Image | 28 | basic |
| Scroll | 19 | other |
| Grid | 17 | other |
| Video | 13 | basic |
| Slider | 11 | other |
| Flex | 9 | other |
| ListItem | 9 | other |
| Span | 9 | other |
| TextArea | 9 | other |
| Progress | 8 | other |
| TabContent | 7 | other |
| NavDestination | 6 | other |
| Refresh | 6 | other |
| GridItem | 5 | other |
| Stack | 5 | other |
| Checkbox | 4 | other |
| XComponent | 4 | other |
| Button | 3 | other |
| Row | 3 | basic |
| Column | 3 | basic |
| Select | 3 | other |
| Toggle | 3 | other |
| DataPanel / DatePicker / Menu / Radio / Search / TextPicker 等 | 1-2 | other |

## 检索建议

当用户没有准确说出组件名时，用场景词检索：

- 堆叠、层叠、卡片轮播：查 `Stack`，普通轮播查 `Swiper`。
- 普通轮播、指示器、自动播放、滑动点击冲突：查 `Swiper`。
- 长列表、上拉加载、下拉刷新、ListItem：查 `List`、`Refresh`。
- 网格、宫格、拖拽、行列数、合并单元格：查 `Grid`、`GridItem`。
- 嵌套滑动、滚动冲突、滚动位置恢复：查 `Scroll`。
- 页签、预加载、TabContent、TabBar：查 `Tabs`。
- 页面跳转、返回、标题栏、白屏：查 `Navigation`、`NavDestination`。
- 键盘、焦点、输入限制、placeholder：查 `TextInput`、`TextArea`。
- 文本省略、换行、富文本、图文混排：查 `Text`、`Span`、`RichText`。
- 图片加载、SVG、裁剪、圆角、点击区域：查 `Image`。
- 视频全屏、播放进度、预览黑屏、中断：查 `Video`。
- 全选、反选、单选、开关、按钮态：查 `Checkbox`、`Radio`、`Toggle`、`Button`。
- 滑块、进度、评分、红点角标：查 `Slider`、`Progress`、`Rating`、`Badge`。
- 选择器、菜单、日期时间选择：查 `Select`、`Menu`、`DatePicker`、`TextPicker`。
- 原生渲染、Surface、纹理：查 `XComponent`。
- 圆形、多边形、折线：查 `Circle`、`Polygon`、`Polyline`。

## 使用方式

分发版 skill 内置轻量 JSON 索引：

- `references/component-practice-index.json`：405 篇文章的标题、组件、关键词、分类、官方链接和推荐 reference。
- `scripts/search-practices.mjs`：用 Node.js 内置模块搜索索引，不需要下载原文库。

示例：

```bash
node scripts/search-practices.mjs 堆叠
node scripts/search-practices.mjs Swiper --limit=5
node scripts/search-practices.mjs "List Refresh" --limit=5
node scripts/search-practices.mjs "Grid 拖拽"
node scripts/search-practices.mjs "Scroll 嵌套"
node scripts/search-practices.mjs "Image SVG"
node scripts/search-practices.mjs "Video 全屏"
node scripts/search-practices.mjs "TextInput 软键盘"
node scripts/search-practices.mjs Checkbox
node scripts/search-practices.mjs Navigation --json
```

如果本机保留了原始 405 篇 Markdown，可以继续用 `rg` 检索本地 Markdown：

```bash
rg -n "堆叠|Stack|Swiper" "/Users/beijixing/Documents/New project/downloads/arkui-component-articles/markdown"
```

读取相关文章后，不要照搬整篇文章；应抽取：

- 触发场景
- 推荐组件组合
- 状态设计
- 关键 API
- 代码骨架
- 常见坑
