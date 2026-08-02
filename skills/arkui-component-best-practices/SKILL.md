---
name: arkui-component-best-practices
description: Use when writing, reviewing, or debugging ArkTS/ArkUI component code, especially ArkUI 组件最佳实践, Stack/Swiper/List/Grid/Scroll/Tabs/Navigation/Text/Image/Video/TextInput/Slider/Checkbox/Picker/XComponent, layout, interaction, animation, state rendering, gesture, scroll, focus, and real HarmonyOS component pitfalls.
---

# ArkUI 组件最佳实践

## 目标

在写 ArkTS/ArkUI 组件代码时，先识别用户要解决的真实场景，再复用已有组件实践。不要只按组件 API 猜代码；遇到布局、交互、动画、滚动、焦点、层叠等问题时，先查本 skill 的 references。

## 使用流程

1. 先判断用户是在“实现效果”还是“修复组件问题”。
2. 从描述里提取场景词、组件名、交互词。
3. 优先按下表读取一张最相关的 reference；不确定时运行 `node scripts/search-practices.mjs <关键词>` 查轻量索引。
4. 写代码前确认：状态所有权、组件层级、事件来源、布局尺寸、异常边界。
5. 输出时给 ArkTS 代码，并点明为什么选择这些组件组合和哪些坑要避开。

## 场景词到实践

| 用户说法 | 优先查阅 | 推荐方向 |
|---|---|---|
| 堆叠、层叠、卡片堆叠、露出下一张、Stack 越界/层级 | `references/stack-patterns.md` | `Stack + offset + zIndex + gesture + animateTo` |
| Swiper、轮播、指示器、自动播放、滑动误触 | `references/swiper-carousel-patterns.md` | `Swiper + controller + currentIndex + 自定义 indicator` |
| List、LazyForEach、Refresh、ListItem、长列表、下拉刷新、上拉加载 | `references/list-lazy-refresh-patterns.md` | 数据源、key、刷新态、加载态分开 |
| Grid、GridItem、九宫格、合并单元格、拖拽网格 | `references/grid-drag-layout-patterns.md` | 网格模型、列数、item 比例、拖拽提交 |
| Scroll、嵌套滑动、滑动冲突、滚动位置恢复 | `references/scroll-nested-gesture-patterns.md` | 先确定滚动主语和横纵手势归属 |
| Tabs、TabContent、TabBar、页签切换、预加载、生命周期 | `references/tabs-patterns.md` | `currentIndex` 单一状态源 |
| Navigation、NavDestination、NavPathStack、路由、返回参数、标题栏、白屏 | `references/navigation-routing-patterns.md` | 路由栈、参数、返回值结构化 |
| Text、Span、RichText、TextTimer、换行、省略、溢出、图文混排 | `references/text-rich-display-patterns.md` | 父容器宽度、行数、溢出策略 |
| Image、SVG、本地/网络图片、objectFit、裁剪、圆角、颜色处理 | `references/image-resource-fit-patterns.md` | 资源来源、展示框、失败态、适配策略 |
| Video、播放进度、控制栏、全屏、横竖屏、预览黑屏 | `references/video-playback-fullscreen-patterns.md` | 播放态、进度、全屏态、生命周期 |
| TextInput、TextArea、Search、焦点、软键盘、光标、输入限制 | `references/input-focus-keyboard-patterns.md` | 输入值、焦点状态、键盘行为分开管理 |
| Checkbox、Radio、Toggle、Button、全选、反选、单选、开关 | `references/selection-controls-patterns.md` | 选择集合、单选值、布尔开关、禁用/加载态 |
| Slider、Progress、DataPanel、Rating、Badge、滑块、进度、角标 | `references/slider-progress-feedback-patterns.md` | 数值范围、拖动中状态、提交态、展示态 |
| Select、Menu、DatePicker、TimePicker、TextPicker、PatternLock | `references/picker-select-menu-patterns.md` | 选中值、弹层开关、草稿值、确认/取消 |
| Flex、RelativeContainer、ColumnSplit、弹性布局、相对布局、分栏 | `references/layout-containers-patterns.md` | 主轴/换行、锚点依赖、分栏边界 |
| XComponent、Native、Surface、原生渲染、纹理 | `references/xcomponent-native-patterns.md` | ArkTS 与 Native 生命周期和资源边界 |
| Circle、Polygon、Polyline、Shape、绘制图形 | `references/drawing-shape-patterns.md` | 容器尺寸、坐标系、fill/stroke、点击区域 |
| 沉浸光感、HDS 材质、HDS 导航标题栏、HDS 底部页签、systemMaterialEffect | `references/hds-immersive-material-patterns.md` | 优先系统自适应；自定义前查询设备材质能力并降级 |
| 只知道关键词或文章标题 | `references/component-practice-index.md` + `references/article-coverage-map.md` | 用脚本查官方链接、推荐 reference 和 405 篇覆盖 |

## 写代码原则

- 用状态驱动 UI：`@State` / `@Link` / `@Prop` 要明确数据所有权。
- 复杂视觉效果优先封装成独立 `@Component`，外部只传状态和数据源。
- 动画只包裹必要状态变化，优先使用 `this.getUIContext().animateTo()`。
- 层叠布局要显式控制 `offset`、`zIndex`、尺寸、对齐方式。
- 手势要明确方向：横向用 `PanDirection.Horizontal`，纵向用 `PanDirection.Vertical`。
- 多组件组合时说明为什么不用单个组件直接实现。

## 不要这样做

- 不要把“堆叠轮播”简单写成普通 `Swiper`；普通 `Swiper` 不负责卡片层叠和露出下一张。
- 不要只给代码，不解释关键状态和层级关系。
- 不要把工程、签名、AGC、上架、证书问题混入 ArkUI 组件最佳实践。
- 不要一次加载全部参考资料；只读取当前场景需要的 reference。
- 不要把 405 篇原文当作 skill 上下文整体加载；需要溯源时查索引里的官方链接。

## 轻量检索

在 skill 目录内可运行：

```bash
node scripts/search-practices.mjs 堆叠
node scripts/search-practices.mjs Swiper --limit=5
node scripts/search-practices.mjs "Grid 拖拽"
node scripts/search-practices.mjs "Video 全屏"
node scripts/search-practices.mjs "TextInput 软键盘"
node scripts/search-practices.mjs Checkbox
node scripts/search-practices.mjs Navigation --limit=5
```

脚本只查 `references/component-practice-index.json`，返回标题、组件、分类、二级场景、推荐 reference 和官方链接。它不依赖本机存在 405 篇原文。需要看 405 篇如何覆盖到场景时，读 `references/article-coverage-map.md`。

## References

- `references/stack-patterns.md`：Stack 层叠、卡片堆叠、Swiper 堆叠动画。
- `references/swiper-carousel-patterns.md`：Swiper 轮播、指示器、自动播放、滑动点击冲突。
- `references/list-lazy-refresh-patterns.md`：List、LazyForEach、Refresh、ListItem、加载更多。
- `references/grid-drag-layout-patterns.md`：Grid、GridItem、宫格、合并单元格、拖拽。
- `references/scroll-nested-gesture-patterns.md`：Scroll、嵌套滑动、滚动手势冲突。
- `references/tabs-patterns.md`：Tabs、TabContent、TabBar、页签预加载和生命周期。
- `references/navigation-routing-patterns.md`：Navigation、NavDestination、NavPathStack、路由传参与返回。
- `references/text-rich-display-patterns.md`：Text、Span、RichText、TextTimer、文本溢出。
- `references/image-resource-fit-patterns.md`：Image、SVG、本地/网络资源、objectFit、裁剪。
- `references/video-playback-fullscreen-patterns.md`：Video、播放进度、控制栏、全屏横竖屏。
- `references/input-focus-keyboard-patterns.md`：输入、焦点、软键盘、光标与校验。
- `references/selection-controls-patterns.md`：Checkbox、Radio、Toggle、Button、全选反选。
- `references/slider-progress-feedback-patterns.md`：Slider、Progress、DataPanel、Rating、Badge。
- `references/picker-select-menu-patterns.md`：Select、Menu、DatePicker、TimePicker、TextPicker、PatternLock。
- `references/layout-containers-patterns.md`：Flex、RelativeContainer、ColumnSplit。
- `references/xcomponent-native-patterns.md`：XComponent 原生渲染桥接。
- `references/drawing-shape-patterns.md`：Circle、Polygon、Polyline 绘制组件。
- `references/hds-immersive-material-patterns.md`：HDS 导航标题栏、底部页签的沉浸光感材质。
- `references/misc-components-patterns.md`：低频组件兜底处理方式。
- `references/list-grid-scroll-patterns.md`、`references/tabs-navigation-patterns.md`、`references/text-image-video-patterns.md`：旧的大类概览入口，具体问题优先读上面的细分文件。
- `references/component-practice-index.md`：索引说明、分类统计和检索建议。
- `references/component-practice-index.json`：405 篇文章的轻量可检索元数据。
- `references/article-coverage-map.md`：405 篇文章按二级场景分组的覆盖地图。
