# ArkUI 组件文章覆盖地图

这张表用于证明 405 篇组件实践文章没有被压缩成少数大桶：每篇文章都被映射到一个细分场景 reference。分发版 skill 不包含原文全文；需要溯源时打开官方链接。

- 文章总数：405
- 细分场景数：17
- 数据来源：`references/component-practice-index.json`

## 场景计数

| Reference | 场景 | 文章数 |
|---|---|---:|
| `references/stack-patterns.md` | Stack 层叠堆叠 | 6 |
| `references/swiper-carousel-patterns.md` | Swiper 轮播滑动 | 40 |
| `references/list-lazy-refresh-patterns.md` | List/LazyForEach/Refresh 列表刷新 | 54 |
| `references/grid-drag-layout-patterns.md` | Grid/GridItem 拖拽网格 | 22 |
| `references/scroll-nested-gesture-patterns.md` | Scroll/Nested Gesture 嵌套滚动手势 | 18 |
| `references/tabs-patterns.md` | Tabs/TabContent 页签 | 32 |
| `references/navigation-routing-patterns.md` | Navigation/NavDestination 路由 | 46 |
| `references/text-rich-display-patterns.md` | Text/Span/RichText 文本展示 | 40 |
| `references/image-resource-fit-patterns.md` | Image 资源加载适配 | 34 |
| `references/video-playback-fullscreen-patterns.md` | Video 播放全屏 | 14 |
| `references/input-focus-keyboard-patterns.md` | Input/Focus/Keyboard 输入焦点键盘 | 39 |
| `references/selection-controls-patterns.md` | Selection/Button 选择与按钮控件 | 12 |
| `references/slider-progress-feedback-patterns.md` | Slider/Progress 反馈与数值控件 | 20 |
| `references/picker-select-menu-patterns.md` | Picker/Select/Menu 选择器菜单 | 9 |
| `references/layout-containers-patterns.md` | Flex/RelativeContainer 布局容器 | 11 |
| `references/xcomponent-native-patterns.md` | XComponent 原生渲染桥接 | 4 |
| `references/drawing-shape-patterns.md` | Shape 绘制组件 | 4 |

## Stack 层叠堆叠（6 篇）

Reference: `references/stack-patterns.md`

| # | 组件 | 标题 | 官方链接 |
|---:|---|---|---|
| 1 | TextInput, Text | 实现Text组件和TextInput组件可以切换的堆叠布局 | [link](https://developer.huawei.com/consumer/cn/doc/architecture-guides/convenient-life-v1_2-ts_178-0000002537359721) |
| 2 | Swiper, Stack | Stack组件实现Swiper堆叠动画效果 | [link](https://developer.huawei.com/consumer/cn/doc/architecture-guides/news-v1_2-ts_52-0000002371749641) |
| 3 | Stack | 如何调整Stack容器内子组件的位置 | [link](https://developer.huawei.com/consumer/cn/doc/architecture-guides/news-v1_2-ts_73-0000002373652194) |
| 4 | Stack | Stack组件中子组件超出边界显示问题 | [link](https://developer.huawei.com/consumer/cn/doc/architecture-guides/insurance-v1_2-ts_275-0000002412416734) |
| 5 | Stack, Text | Text组件如何分布在Stack组件的四个角 | [link](https://developer.huawei.com/consumer/cn/doc/architecture-guides/purchase-v1_2-ts_37-0000002379680884) |
| 6 | Stack | 如何解决Stack组件下子组件高度与层级问题 | [link](https://developer.huawei.com/consumer/cn/doc/architecture-guides/purchase-v1_2-ts_27-0000002359973952) |

## Swiper 轮播滑动（40 篇）

Reference: `references/swiper-carousel-patterns.md`

| # | 组件 | 标题 | 官方链接 |
|---:|---|---|---|
| 1 | Swiper | 在Swiper上添加滑动手势监听 | [link](https://developer.huawei.com/consumer/cn/doc/architecture-guides/convenient-life-v1_2-ts_87-0000002412417545) |
| 2 | Swiper | 如何解决Swiper组件未显示页面无法截图的问题 | [link](https://developer.huawei.com/consumer/cn/doc/architecture-guides/convenient-life-v1_2-ts_148-0000002410829810) |
| 3 | Swiper | 如何保持Swiper中图片居中效果 | [link](https://developer.huawei.com/consumer/cn/doc/architecture-guides/traffic-v1_1-ts_36-0000002379840716) |
| 4 | Swiper | 滑动Swiper组件时如何不触发子组件的点击事件 | [link](https://developer.huawei.com/consumer/cn/doc/architecture-guides/traffic-v1_1-ts_59-0000002386164712) |
| 5 | Swiper | Swiper如何实现3D立方体旋转切换动画效果 | [link](https://developer.huawei.com/consumer/cn/doc/architecture-guides/common-v1_26-ts_151-0000002411895729) |
| 6 | Swiper | Swiper组件如何实现子组件高度自适应 | [link](https://developer.huawei.com/consumer/cn/doc/architecture-guides/common-v1_26-ts_257-0000002410837702) |
| 7 | Swiper | 使用Swiper实现图片的一镜到底转场效果 | [link](https://developer.huawei.com/consumer/cn/doc/architecture-guides/common-v1_26-ts_c179-0000002524954672) |
| 8 | Swiper | 如何动态设置Swiper组件的nextMargin属性 | [link](https://developer.huawei.com/consumer/cn/doc/architecture-guides/common-v1_26-ts_143-0000002376306704) |
| 9 | Swiper | 如何实现Swiper部分区域响应左右滑动事件 | [link](https://developer.huawei.com/consumer/cn/doc/architecture-guides/common-v1_26-ts_222-0000002396256746) |
| 10 | Swiper | 通过Swiper实现可滑动的四宫格会议界面 | [link](https://developer.huawei.com/consumer/cn/doc/architecture-guides/swiper_conference_page-0000002538460457) |
| 11 | Swiper, Image | Swiper嵌套Image显示图片失败 | [link](https://developer.huawei.com/consumer/cn/doc/architecture-guides/tools-v1_2-ts_91-0000002359946214) |
| 12 | Swiper | Swiper滑动控制视频暂停播放 | [link](https://developer.huawei.com/consumer/cn/doc/architecture-guides/tools-v1_2-ts_232-0000002383944206) |
| 13 | Swiper | Swiper组件导航点颜色重叠问题 | [link](https://developer.huawei.com/consumer/cn/doc/architecture-guides/tools-v1_2-ts_376-0000002516869430) |
| 14 | Swiper | 如何使用Swiper实现四宫格会议页面 | [link](https://developer.huawei.com/consumer/cn/doc/architecture-guides/tools-v1_2-ts_259-0000002392197034) |
| 15 | Swiper | Swiper如何实现弧形旋转切换动画效果 | [link](https://developer.huawei.com/consumer/cn/doc/architecture-guides/photo-v1_2-ts_c43-0000002557365087) |
| 16 | Swiper | Swiper在末尾实现添加按钮 | [link](https://developer.huawei.com/consumer/cn/doc/architecture-guides/educate-v1_1-ts_83-0000002410602305) |
| 17 | Swiper | Swiper如何显示指定index页面 | [link](https://developer.huawei.com/consumer/cn/doc/architecture-guides/educate-v1_1-ts_36-0000002339445012) |
| 18 | Scroll, Swiper | Swiper嵌套Scroll组件滑动问题 | [link](https://developer.huawei.com/consumer/cn/doc/architecture-guides/educate-v1_1-ts_57-0000002367457262) |
| 19 | Swiper | Swiper组件实现试卷打分功能 | [link](https://developer.huawei.com/consumer/cn/doc/architecture-guides/educate-v1_1-ts_45-0000002359679316) |
| 20 | Swiper | Swiper组件被遮挡，导致点击事件不生效 | [link](https://developer.huawei.com/consumer/cn/doc/architecture-guides/educate-v1_1-ts_141-0000002397399014) |
| 21 | Swiper | 如何取消Swiper指示器的默认边距 | [link](https://developer.huawei.com/consumer/cn/doc/architecture-guides/educate-v1_1-ts_16-0000002326967601) |
| 22 | Swiper | 如何实现Swiper控制最边缘时的弹性距离 | [link](https://developer.huawei.com/consumer/cn/doc/architecture-guides/educate-v1_1-ts_3-0000002263474578) |
| 23 | Swiper | 如何监听Swiper滑动索引位置 | [link](https://developer.huawei.com/consumer/cn/doc/architecture-guides/educate-v1_1-ts_93-0000002379677064) |
| 24 | Swiper | 如何解决Swiper的prevMargin/nextMargin属性不生效问题 | [link](https://developer.huawei.com/consumer/cn/doc/architecture-guides/educate-v1_1-ts_33-0000002337898832) |
| 25 | Swiper | 模拟实现Swiper | [link](https://developer.huawei.com/consumer/cn/doc/architecture-guides/educate-v1_1-ts_144-0000002442830469) |
| 26 | Swiper | Swiper去除滚动动画实现GIF效果 | [link](https://developer.huawei.com/consumer/cn/doc/architecture-guides/news-v1_2-ts_53-0000002373444977) |
| 27 | Swiper | Swiper如何实现惯性滚动效果 | [link](https://developer.huawei.com/consumer/cn/doc/architecture-guides/news-v1_2-ts_115-0000002443595325) |
| 28 | Swiper | Swiper组件在删除数据时如何实现切换到前一个元素而非第一个 | [link](https://developer.huawei.com/consumer/cn/doc/architecture-guides/news-v1_2-ts_54-0000002339406962) |
| 29 | Swiper | Swiper组件左右滑动加载更多数据 | [link](https://developer.huawei.com/consumer/cn/doc/architecture-guides/news-v1_2-ts_107-0000002430839933) |
| 30 | Swiper | 停止滑动后Swiper的子组件获取的坐标发生骤变怎么解决 | [link](https://developer.huawei.com/consumer/cn/doc/architecture-guides/news-v1_2-ts_114-0000002442830481) |
| 31 | Swiper | 如何通过Swiper实现可见式卡片轮播效果 | [link](https://developer.huawei.com/consumer/cn/doc/architecture-guides/news-v1_2-ts_68-0000002401139041) |
| 32 | Swiper | 如何控制Swiper组件只能向一个方向滑动 | [link](https://developer.huawei.com/consumer/cn/doc/architecture-guides/shaking_to_dialog_1-ts_10-0000002300192982) |
| 33 | Swiper | Swiper轮播组件单页如何显示非整数条的数据 | [link](https://developer.huawei.com/consumer/cn/doc/architecture-guides/insurance-v1_2-ts_247-0000002397400246) |
| 34 | Swiper | 如何实现双层Swiper组件嵌套联动 | [link](https://developer.huawei.com/consumer/cn/doc/architecture-guides/insurance-v1_2-ts_143-0000002376300872) |
| 35 | Swiper | 如何解决Swiper过早渲染导致渲染失败的问题 | [link](https://developer.huawei.com/consumer/cn/doc/architecture-guides/insurance-v1_2-ts_184-0000002383938694) |
| 36 | Swiper | 屏蔽Swiper组件切换效果 | [link](https://developer.huawei.com/consumer/cn/doc/architecture-guides/insurance-v1_2-ts_138-0000002375612348) |
| 37 | Swiper | Swiper组件禁止手动滑动 | [link](https://developer.huawei.com/consumer/cn/doc/architecture-guides/socialcontact-v1_2-ts_88-0000002552379695) |
| 38 | Swiper | Swiper如何设置数字指示器的背景色 | [link](https://developer.huawei.com/consumer/cn/doc/architecture-guides/purchase-v1_2-ts_30-0000002373205372) |
| 39 | Swiper | 手势拖拽时和Swiper组件滑动发生冲突如何解决 | [link](https://developer.huawei.com/consumer/cn/doc/architecture-guides/purchase-v1_2-ts_11-0000002263888778) |
| 40 | Swiper | 如何解决Swiper组件在滑动过程中onGestureSwipe回调被触发多次的问题 | [link](https://developer.huawei.com/consumer/cn/doc/architecture-guides/architecture-v1-3_2-ts_64-0000002392272730) |

## List/LazyForEach/Refresh 列表刷新（54 篇）

Reference: `references/list-lazy-refresh-patterns.md`

| # | 组件 | 标题 | 官方链接 |
|---:|---|---|---|
| 1 | List | LazyForEach渲染的List列表上滑触发刷新动画 | [link](https://developer.huawei.com/consumer/cn/doc/architecture-guides/convenient-life-v1_2-ts_42-0000002359512876) |
| 2 | List | List如何实现滑动翻页效果 | [link](https://developer.huawei.com/consumer/cn/doc/architecture-guides/convenient-life-v1_2-ts_106-0000002383612532) |
| 3 | List | List展示不全 | [link](https://developer.huawei.com/consumer/cn/doc/architecture-guides/convenient-life-v1_2-ts_26-0000002319565638) |
| 4 | List | List组件通过拖拽改变排序 | [link](https://developer.huawei.com/consumer/cn/doc/architecture-guides/convenient-life-v1_2-ts_105-0000002383772408) |
| 5 | List | 如何实现Tab与List联动 | [link](https://developer.huawei.com/consumer/cn/doc/architecture-guides/convenient-life-v1_2-ts_140-0000002442710537) |
| 6 | List | 实现List下拉刷新和上拉加载更多 | [link](https://developer.huawei.com/consumer/cn/doc/architecture-guides/convenient-life-v1_2-ts_216-0000002523762368) |
| 7 | List | 拖拽List组件内的子组件时，如何解决被拖拽的子组件位置会向两边偏移的问题 | [link](https://developer.huawei.com/consumer/cn/doc/architecture-guides/convenient-life-v1_2-ts_16-0000002297797489) |
| 8 | ListItem | 设置ListItem子组件的文字水平居中 | [link](https://developer.huawei.com/consumer/cn/doc/architecture-guides/convenient-life-v1_2-ts_78-0000002374745902) |
| 9 | List | 通过监听List滑动位置实现唤起组件的功能 | [link](https://developer.huawei.com/consumer/cn/doc/architecture-guides/convenient-life-v1_2-ts_103-0000002417371837) |
| 10 | ListItem, Refresh, List | 如何实现Refresh组件下滑动展开和收起List某个ListItem的功能 | [link](https://developer.huawei.com/consumer/cn/doc/architecture-guides/traffic-v1_1-ts_77-0000002443576201) |
| 11 | List | 如何实现沉浸式效果与List列表滑动联动 | [link](https://developer.huawei.com/consumer/cn/doc/architecture-guides/traffic-v1_1-ts_15-0000002393204225) |
| 12 | List | 实现List头部插入数据时显示的项不变 | [link](https://developer.huawei.com/consumer/cn/doc/architecture-guides/traffic-v1_1-ts_6-0000002353524401) |
| 13 | List | bindSheet如何实现与List联动 | [link](https://developer.huawei.com/consumer/cn/doc/architecture-guides/common-v1_26-ts_c128-0000002521356718) |
| 14 | List | PC中List如何通过上下键循环走焦 | [link](https://developer.huawei.com/consumer/cn/doc/architecture-guides/common-v1_26-ts_487-0000002547350943) |
| 15 | List | 如何使用List组件实现流畅的无限下拉滑动效果 | [link](https://developer.huawei.com/consumer/cn/doc/architecture-guides/common-v1_26-ts_246-0000002442710581) |
| 16 | List | 如何实现List组件所有分组上滑吸顶效果及触底提示 | [link](https://developer.huawei.com/consumer/cn/doc/architecture-guides/common-v1_26-ts_279-0000002532461849) |
| 17 | List | 如何解决List组件部分分割线不显示的问题 | [link](https://developer.huawei.com/consumer/cn/doc/architecture-guides/common-v1_26-ts_241-0000002407543486) |
| 18 | List | 如何通过List组件实现可自动循环滚动的列表 | [link](https://developer.huawei.com/consumer/cn/doc/architecture-guides/health-v1_2-ts_11-0000002409311198) |
| 19 | Refresh | Refresh下拉刷新偏移量控制问题 | [link](https://developer.huawei.com/consumer/cn/doc/architecture-guides/health-v1_2-ts_3-0000002409740497) |
| 20 | ListItemGroup | 如何监听ListItemGroup的Header吸顶状态 | [link](https://developer.huawei.com/consumer/cn/doc/architecture-guides/health-v1_2-ts_16-0000002445421321) |
| 21 | ListItemGroup | ListItemGroup如何使用三元运算符 | [link](https://developer.huawei.com/consumer/cn/doc/architecture-guides/tools-v1_2-ts_155-0000002407336521) |
| 22 | ListItem | ListItem如何实现左滑删除功能 | [link](https://developer.huawei.com/consumer/cn/doc/architecture-guides/tools-v1_2-ts_89-0000002359786330) |
| 23 | List | List实现树视图 | [link](https://developer.huawei.com/consumer/cn/doc/architecture-guides/tools-v1_2-ts_241-0000002419347909) |
| 24 | List | List嵌套Canvas滑动抖动问题 | [link](https://developer.huawei.com/consumer/cn/doc/architecture-guides/tools-v1_2-ts_225-0000002416801601) |
| 25 | List | 如何实现List联动滑动，子项点击弹出自定义气泡 | [link](https://developer.huawei.com/consumer/cn/doc/architecture-guides/tools-v1_2-ts_360-0000002510223880) |
| 26 | Refresh | 如何解决Refresh每次下拉重复触发刷新回调的问题 | [link](https://developer.huawei.com/consumer/cn/doc/architecture-guides/tools-v1_2-ts_93-0000002359786338) |
| 27 | List | List列表子组件按照顺序动画展示 | [link](https://developer.huawei.com/consumer/cn/doc/architecture-guides/audio-v1_2-ts_70-0000002445501417) |
| 28 | List | 如何实现List组件在多列模式下特殊列表项的独立布局 | [link](https://developer.huawei.com/consumer/cn/doc/architecture-guides/audio-v1_2-ts_63-0000002410674214) |
| 29 | ListItem, List | List如何实时获取可见的ListItem索引值 | [link](https://developer.huawei.com/consumer/cn/doc/architecture-guides/educate-v1_1-ts_4-0000002298448769) |
| 30 | List | List组件中加载多个Web组件只显示最后一个页面怎么解决 | [link](https://developer.huawei.com/consumer/cn/doc/architecture-guides/educate-v1_1-ts_1-0000002263417628) |
| 31 | List | List组件替换元素位置导致UI显示异常 | [link](https://developer.huawei.com/consumer/cn/doc/architecture-guides/educate-v1_1-ts_81-0000002376135396) |
| 32 | List | 如何在List使用懒加载时动态修改最后一条数据样式 | [link](https://developer.huawei.com/consumer/cn/doc/architecture-guides/educate-v1_1-ts_134-0000002396250616) |
| 33 | ListItem, List | ForEach渲染的List使用组件截图只能截取第一个ListItem | [link](https://developer.huawei.com/consumer/cn/doc/architecture-guides/news-v1_2-ts_97-0000002386164720) |
| 34 | List | List嵌套LazyForEach滚动条大小会变化 | [link](https://developer.huawei.com/consumer/cn/doc/architecture-guides/news-v1_2-ts_98-0000002392273650) |
| 35 | ListItem | 如何实现ListItem点击后居中显示的效果 | [link](https://developer.huawei.com/consumer/cn/doc/architecture-guides/news-v1_2-ts_67-0000002367619274) |
| 36 | ListItem | 如何实现同一行的ListItem文本高度不一致按最大高度展示 | [link](https://developer.huawei.com/consumer/cn/doc/architecture-guides/news-v1_2-ts_31-0000002263564718) |
| 37 | Refresh | 如何通过Refresh组件实现下拉刷新动画 | [link](https://developer.huawei.com/consumer/cn/doc/architecture-guides/news-v1_2-ts_39-0000002326967605) |
| 38 | ListItem | 获取ListItem组件的高度问题 | [link](https://developer.huawei.com/consumer/cn/doc/architecture-guides/news-v1_2-ts_81-0000002413320285) |
| 39 | List | List下拉刷新时如何保证更新后的页面停留在原始位置上 | [link](https://developer.huawei.com/consumer/cn/doc/architecture-guides/insurance-v1_2-ts_227-0000002394041938) |
| 40 | List | List组件实现自定义时间选择器 | [link](https://developer.huawei.com/consumer/cn/doc/architecture-guides/insurance-v1_2-ts_107-0000002367617794) |
| 41 | List | List组件的item如何实现渐入渐出显示效果 | [link](https://developer.huawei.com/consumer/cn/doc/architecture-guides/insurance-v1_2-ts_23-0000002340169225) |
| 42 | List | Tab嵌套List的页面滚动问题 | [link](https://developer.huawei.com/consumer/cn/doc/architecture-guides/insurance-v1_2-ts_145-0000002376842854) |
| 43 | List | 如何实现List下滑指定距离才展开的效果 | [link](https://developer.huawei.com/consumer/cn/doc/architecture-guides/insurance-v1_2-ts_182-0000002383482218) |
| 44 | List | 如何实现List滑动时数据更新不渲染到组件上 | [link](https://developer.huawei.com/consumer/cn/doc/architecture-guides/insurance-v1_2-ts_254-0000002407536350) |
| 45 | Refresh | 如何解决Refresh组件阻尼状态下动画显示异常的问题 | [link](https://developer.huawei.com/consumer/cn/doc/architecture-guides/insurance-v1_2-ts_25-0000002343528657) |
| 46 | ListItemGroup | 如何解决在ListItemGroup中设置onMove属性失效的问题 | [link](https://developer.huawei.com/consumer/cn/doc/architecture-guides/insurance-v1_2-ts_259-0000002409311194) |
| 47 | List | 如何使用List组件实现聊天列表功能 | [link](https://developer.huawei.com/consumer/cn/doc/architecture-guides/socialcontact-v1_2-ts_14-0000002312221513) |
| 48 | List | 如何准确统计List中Item的曝光 | [link](https://developer.huawei.com/consumer/cn/doc/architecture-guides/socialcontact-v1_2-ts_67-0000002409796238) |
| 49 | List | 如何解决LazyForEach刷新数据时List无法滑动问题 | [link](https://developer.huawei.com/consumer/cn/doc/architecture-guides/socialcontact-v1_2-ts_64-0000002397402138) |
| 50 | List | List组件分组滚动效果实现 | [link](https://developer.huawei.com/consumer/cn/doc/architecture-guides/office-v1_2-ts_67-0000002409151346) |
| 51 | List | List自适应高度 | [link](https://developer.huawei.com/consumer/cn/doc/architecture-guides/office-v1_2-ts_49-0000002413894893) |
| 52 | RelativeContainer | 如何通过RelativeContainer实现列表的统一格式布局 | [link](https://developer.huawei.com/consumer/cn/doc/architecture-guides/office-v1_2-ts_7-0000002309701918) |
| 53 | ListItem | 关于ListItem中swipeAction使用问题合集 | [link](https://developer.huawei.com/consumer/cn/doc/architecture-guides/purchase-v1_2-ts_23-0000002337911500) |
| 54 | List | List组件滑动时如何控制滑动幅度和滑动范围 | [link](https://developer.huawei.com/consumer/cn/doc/architecture-guides/architecture-v1-3_2-ts_44-0000002378256326) |

## Grid/GridItem 拖拽网格（22 篇）

Reference: `references/grid-drag-layout-patterns.md`

| # | 组件 | 标题 | 官方链接 |
|---:|---|---|---|
| 1 | Grid | 如何使用Grid单元格实现合并布局 | [link](https://developer.huawei.com/consumer/cn/doc/architecture-guides/convenient-life-v1_2-ts_22-0000002306136340) |
| 2 | Grid | 如何在动态修改Grid布局的行列数时Grid高度自适应 | [link](https://developer.huawei.com/consumer/cn/doc/architecture-guides/convenient-life-v1_2-ts_206-0000002520443856) |
| 3 | Grid | 如何实现图标长按震动拖动并动态添加到另外一个Grid | [link](https://developer.huawei.com/consumer/cn/doc/architecture-guides/convenient-life-v1_2-ts_c129-0000002555109529) |
| 4 | Grid | 如何解决Grid组件拖拽到边缘时无法继续拖动的问题 | [link](https://developer.huawei.com/consumer/cn/doc/architecture-guides/convenient-life-v1_2-ts_4-0000002297910513) |
| 5 | WaterFlow | WaterFlow组件切换列数时卡顿 | [link](https://developer.huawei.com/consumer/cn/doc/architecture-guides/common-v1_26-ts_383-0000002505457516) |
| 6 | Grid | Grid内组件用stateStyles实现按压效果有延迟 | [link](https://developer.huawei.com/consumer/cn/doc/architecture-guides/common-v1_26-ts_240-0000002441262773) |
| 7 | Grid | Grid组件如何通过拖拽拉伸放大item子组件 | [link](https://developer.huawei.com/consumer/cn/doc/architecture-guides/common-v1_26-ts_247-0000002443416281) |
| 8 | GridRow | GridRow布局如何设置滚动 | [link](https://developer.huawei.com/consumer/cn/doc/architecture-guides/tools-v1_2-ts_138-0000002401142149) |
| 9 | GridItem, Grid | Grid如何展开与收起二级子GridItem | [link](https://developer.huawei.com/consumer/cn/doc/architecture-guides/tools-v1_2-ts_63-0000002330849538) |
| 10 | Grid | 如何使Grid组件的可拖拽子项居中显示 | [link](https://developer.huawei.com/consumer/cn/doc/architecture-guides/tools-v1_2-ts_291-0000002397402142) |
| 11 | Grid | 如何实现横向翻页效果的Grid | [link](https://developer.huawei.com/consumer/cn/doc/architecture-guides/tools-v1_2-ts_144-0000002406924481) |
| 12 | Flex, Grid | Grid与Flex布局实现多级标签并行筛选 | [link](https://developer.huawei.com/consumer/cn/doc/architecture-guides/hiararchicle_filtering-0000002287162465) |
| 13 | Grid | 如何解决Grid组件中设置onGetIrregularSizeByIndex属性失效问题 | [link](https://developer.huawei.com/consumer/cn/doc/architecture-guides/audio-v1_2-ts_30-0000002383780114) |
| 14 | Grid | Grid组件自动滚屏 | [link](https://developer.huawei.com/consumer/cn/doc/architecture-guides/educate-v1_1-ts_c106-0000002524834160) |
| 15 | Grid | 如何解决Grid组件在编辑模式打开后拖拽子组件异常问题 | [link](https://developer.huawei.com/consumer/cn/doc/architecture-guides/news-v1_2-ts_2-0000002263667788) |
| 16 | WaterFlow | WaterFlow实现横向布局展示和滑动，并实现内容循环展示 | [link](https://developer.huawei.com/consumer/cn/doc/architecture-guides/shaking_to_dialog_1-ts_55-0000002419480077) |
| 17 | Grid | Grid如何实现根据屏幕宽度自适应列数 | [link](https://developer.huawei.com/consumer/cn/doc/architecture-guides/insurance-v1_2-ts_246-0000002397240358) |
| 18 | GridItem, Grid | 多个Grid组件间GridItem相互拖拽时出现异常如何解决 | [link](https://developer.huawei.com/consumer/cn/doc/architecture-guides/insurance-v1_2-ts_49-0000002358993641) |
| 19 | Grid, List | List嵌套Grid实现内容分类展示效果 | [link](https://developer.huawei.com/consumer/cn/doc/architecture-guides/architecture-v1-3_2-ts_49-0000002415227241) |
| 20 | PatternLock | 如何使用小九宫格展示PatternLock控件的解锁轨迹 | [link](https://developer.huawei.com/consumer/cn/doc/architecture-guides/architecture-v1-3_2-ts_46-0000002413894889) |
| 21 | GridItem | 如何实现点击GridItem获取选中内容 | [link](https://developer.huawei.com/consumer/cn/doc/architecture-guides/architecture-v1-3_2-ts_83-0000002397399010) |
| 22 | GridItem, Grid | 实现Grid组件中特定GridItem的点击效果 | [link](https://developer.huawei.com/consumer/cn/doc/architecture-guides/architecture-v1-3_2-ts_39-0000002408349945) |

## Scroll/Nested Gesture 嵌套滚动手势（18 篇）

Reference: `references/scroll-nested-gesture-patterns.md`

| # | 组件 | 标题 | 官方链接 |
|---:|---|---|---|
| 1 | Scroll | 如何改变Scroll组件在分屏后的滚动方式 | [link](https://developer.huawei.com/consumer/cn/doc/architecture-guides/traffic-v1_1-ts_7-0000002324867580) |
| 2 | Scroll, List | List组件滚动优先级如何高于Scroll组件 | [link](https://developer.huawei.com/consumer/cn/doc/architecture-guides/common-v1_26-ts_164-0000002413894901) |
| 3 | ColumnSplit, Scroll | 如何解决Scroll嵌套的ColumnSplit无法滑动的问题 | [link](https://developer.huawei.com/consumer/cn/doc/architecture-guides/common-v1_26-ts_192-0000002418069445) |
| 4 | Scroll, List | 使用Scroll嵌套List实现可滚动表格 | [link](https://developer.huawei.com/consumer/cn/doc/architecture-guides/health-v1_2-ts_1-0000002298397176) |
| 5 | Scroll | 如何解决Scroll组件设置高度限制后，无法顶部对齐的问题 | [link](https://developer.huawei.com/consumer/cn/doc/architecture-guides/tools-v1_2-ts_137-0000002367462474) |
| 6 | Scroll, Slider | 如何解决在单次拖动内无法同时实现Scroll组件滚动和Slider进度条变化的问题 | [link](https://developer.huawei.com/consumer/cn/doc/architecture-guides/audio-v1_2-ts_2-0000002263237474) |
| 7 | Scroll | Scroll滚动到顶/底部后，下/上拖执行自定义方法 | [link](https://developer.huawei.com/consumer/cn/doc/architecture-guides/photo-v1_2-ts_21-0000002367627282) |
| 8 | RelativeContainer, Scroll | Scroll容器嵌套RelativeContainer组件时无法滚动 | [link](https://developer.huawei.com/consumer/cn/doc/architecture-guides/educate-v1_1-ts_24-0000002309546822) |
| 9 | Scroll | Scroll内Web嵌套其他组件时滑动优先级设置 | [link](https://developer.huawei.com/consumer/cn/doc/architecture-guides/news-v1_2-ts_118-0000002409796226) |
| 10 | Scroll | Scroll组件如何自动滚动到指定位置 | [link](https://developer.huawei.com/consumer/cn/doc/architecture-guides/news-v1_2-ts_123-0000002410834090) |
| 11 | Scroll | 如何解决Scroll组件嵌套Web组件滑动冲突问题 | [link](https://developer.huawei.com/consumer/cn/doc/architecture-guides/news-v1_2-ts_21-0000002298561861) |
| 12 | Scroll, List | Scroll嵌套List滚动回顶部的动画实现 | [link](https://developer.huawei.com/consumer/cn/doc/architecture-guides/insurance-v1_2-ts_110-0000002406762709) |
| 13 | Scroll | Scroll滚动回弹获取偏移位置不准确 | [link](https://developer.huawei.com/consumer/cn/doc/architecture-guides/insurance-v1_2-ts_142-0000002375612352) |
| 14 | Scroll | 如何解决Scroll组件嵌套Web组件后无法跟随页面整体滚动的问题 | [link](https://developer.huawei.com/consumer/cn/doc/architecture-guides/insurance-v1_2-ts_11-0000002263515144) |
| 15 | Scroll | 如何解决Scroll组件无法设置某个元素一直固定在首位的问题 | [link](https://developer.huawei.com/consumer/cn/doc/architecture-guides/insurance-v1_2-ts_5-0000002298075129) |
| 16 | Scroll | Scroll嵌套RichEditor时滚动冲突问题 | [link](https://developer.huawei.com/consumer/cn/doc/architecture-guides/socialcontact-v1_2-ts_16-0000002332516357) |
| 17 | Scroll | 如何解决Scroll嵌套地图组件时的滚动冲突问题 | [link](https://developer.huawei.com/consumer/cn/doc/architecture-guides/purchase-v1_2-ts_16-0000002334451561) |
| 18 | Scroll | 监听Scroll滑动距离实现相关效果 | [link](https://developer.huawei.com/consumer/cn/doc/architecture-guides/architecture-v1-3_2-ts_79-0000002430718757) |

## Tabs/TabContent 页签（32 篇）

Reference: `references/tabs-patterns.md`

| # | 组件 | 标题 | 官方链接 |
|---:|---|---|---|
| 1 | TabContent | TabContent预加载问题 | [link](https://developer.huawei.com/consumer/cn/doc/architecture-guides/convenient-life-v1_2-ts_43-0000002393192877) |
| 2 | Tabs | Tabs索引持久化储存的问题 | [link](https://developer.huawei.com/consumer/cn/doc/architecture-guides/convenient-life-v1_2-ts_66-0000002373911420) |
| 3 | Tabs | 如何解决Tabs和滚动组件的嵌套滑动问题 | [link](https://developer.huawei.com/consumer/cn/doc/architecture-guides/convenient-life-v1_2-ts_7-0000002263474574) |
| 4 | Tabs | SegmentButton页签与显示的Tabs页不匹配 | [link](https://developer.huawei.com/consumer/cn/doc/architecture-guides/common-v1_26-ts_c65-0000002445597145) |
| 5 | TabContent, Tabs | Tabs切换TabContent时出现布局变动问题 | [link](https://developer.huawei.com/consumer/cn/doc/architecture-guides/common-v1_26-ts_137-0000002375937182) |
| 6 | Tabs | Tabs及其子组件生命周期触发问题 | [link](https://developer.huawei.com/consumer/cn/doc/architecture-guides/common-v1_26-ts_615-0000002562223443) |
| 7 | Tabs | Tabs如何实现TabBar中TabItem不均匀分布 | [link](https://developer.huawei.com/consumer/cn/doc/architecture-guides/common-v1_26-ts_260-0000002410677822) |
| 8 | TabContent, Tabs | Tabs组件如何根据数据源动态更改TabContent数量 | [link](https://developer.huawei.com/consumer/cn/doc/architecture-guides/common-v1_26-ts_451-0000002544755465) |
| 9 | Tabs | Tabs页签动态收缩异常 | [link](https://developer.huawei.com/consumer/cn/doc/architecture-guides/common-v1_26-ts_249-0000002409960466) |
| 10 | Tabs | Tabs预加载的实现方式及常见问题 | [link](https://developer.huawei.com/consumer/cn/doc/architecture-guides/common-v1_26-ts_533-0000002518367246) |
| 11 | Tabs | 如何实现自定义Tabs模拟浏览器页签增加删除能力 | [link](https://developer.huawei.com/consumer/cn/doc/architecture-guides/common-v1_26-ts_149-0000002378096470) |
| 12 | Tabs | 如何监听Tabs切换 | [link](https://developer.huawei.com/consumer/cn/doc/architecture-guides/common-v1_26-ts_598-0000002556633827) |
| 13 | Tabs | 如何解决Tabs页签切换时的常见问题 | [link](https://developer.huawei.com/consumer/cn/doc/architecture-guides/common-v1_26-ts_c202-0000002558960807) |
| 14 | Tabs | 如何设置Tabs沉浸式 | [link](https://developer.huawei.com/consumer/cn/doc/architecture-guides/common-v1_26-ts_416-0000002507991650) |
| 15 | Tabs | 自定义Tabs样式，TabBar底部指示器如何对齐 | [link](https://developer.huawei.com/consumer/cn/doc/architecture-guides/common-v1_26-ts_97-0000002358873457) |
| 16 | Tabs | Tabs如何根据TabBar数量更改页签栏排布 | [link](https://developer.huawei.com/consumer/cn/doc/architecture-guides/tools-v1_2-ts_12-0000002263888750) |
| 17 | Tabs | Tabs使用overlay实现在页签栏添加自定义组件 | [link](https://developer.huawei.com/consumer/cn/doc/architecture-guides/audio-v1_2-ts_67-0000002411742288) |
| 18 | Tabs | priorityGesture监听点击事件导致Tabs页面卡顿的问题 | [link](https://developer.huawei.com/consumer/cn/doc/architecture-guides/educate-v1_1-ts_68-0000002406761813) |
| 19 | Tabs | Tabs中实现自定义组件间的样式复用与数据隔离 | [link](https://developer.huawei.com/consumer/cn/doc/architecture-guides/educate-v1_1-ts_147-0000002410829822) |
| 20 | Tabs | Tabs和同方向滑动的子组件的滑动动作隔离 | [link](https://developer.huawei.com/consumer/cn/doc/architecture-guides/educate-v1_1-ts_143-0000002441090153) |
| 21 | Tabs | 如何实现Tabs自定义页签的下划线与文字内容宽度一致 | [link](https://developer.huawei.com/consumer/cn/doc/architecture-guides/educate-v1_1-ts_76-0000002409374281) |
| 22 | Tabs | 返回Tabs主页面时，未返回到对应Tabs标题的位置 | [link](https://developer.huawei.com/consumer/cn/doc/architecture-guides/educate-v1_1-ts_c41-0000002411305749) |
| 23 | Tabs | Tabs组件嵌套Web，无法左右滑动 | [link](https://developer.huawei.com/consumer/cn/doc/architecture-guides/news-v1_2-ts_86-0000002415317277) |
| 24 | Tabs | 多级Tabs嵌套滑动 | [link](https://developer.huawei.com/consumer/cn/doc/architecture-guides/news-v1_2-ts_75-0000002408214089) |
| 25 | TabContent | 如何只展示对应的TabContent的内容页 | [link](https://developer.huawei.com/consumer/cn/doc/architecture-guides/news-v1_2-ts_124-0000002444153365) |
| 26 | TabContent | TabContent切换后onWillShow，onWillHide回调次数异常 | [link](https://developer.huawei.com/consumer/cn/doc/architecture-guides/insurance-v1_2-ts_155-0000002412417553) |
| 27 | Tabs | Tabs子组件切换时触发数据刷新 | [link](https://developer.huawei.com/consumer/cn/doc/architecture-guides/insurance-v1_2-ts_265-0000002444149121) |
| 28 | Tabs | Tabs组件如何实现预加载 | [link](https://developer.huawei.com/consumer/cn/doc/architecture-guides/insurance-v1_2-ts_163-0000002413443277) |
| 29 | TabContent, Tabs | 多级Tabs感知当前屏幕显示的TabContent | [link](https://developer.huawei.com/consumer/cn/doc/architecture-guides/socialcontact-v1_2-ts_69-0000002444153381) |
| 30 | Tabs | Tabs组件实现的侧边栏，如何实现自顶到底的效果 | [link](https://developer.huawei.com/consumer/cn/doc/architecture-guides/purchase-v1_2-ts_3-0000002298448753) |
| 31 | Tabs | Tabs切换时进行弹窗拦截 | [link](https://developer.huawei.com/consumer/cn/doc/architecture-guides/architecture-v1-3_2-ts_40-0000002409291745) |
| 32 | Tabs | 如何实现Tabs组件隐藏部分Tab页面 | [link](https://developer.huawei.com/consumer/cn/doc/architecture-guides/architecture-v1-3_2-ts_47-0000002380255494) |

## Navigation/NavDestination 路由（46 篇）

Reference: `references/navigation-routing-patterns.md`

| # | 组件 | 标题 | 官方链接 |
|---:|---|---|---|
| 1 | Navigation, Tabs | Tabs页面Navigation路由跳转的实现方式 | [link](https://developer.huawei.com/consumer/cn/doc/architecture-guides/convenient-life-v1_2-ts_89-0000002413436273) |
| 2 | NavDestination | 如何实现在NavDestination子页面中动态调整公共组件的样式 | [link](https://developer.huawei.com/consumer/cn/doc/architecture-guides/convenient-life-v1_2-ts_141-0000002409151342) |
| 3 | Navigation | Navigation路由导航更新全局变量时机 | [link](https://developer.huawei.com/consumer/cn/doc/architecture-guides/traffic-v1_1-ts_75-0000002409311190) |
| 4 | Navigation | Navigation路由页面应用接续 | [link](https://developer.huawei.com/consumer/cn/doc/architecture-guides/navigation_continue-0000002522501268) |
| 5 | NavDestination, TabContent, Tabs | NavDestination嵌套使用Tabs，TabContent页面如何跳转至目标页面 | [link](https://developer.huawei.com/consumer/cn/doc/architecture-guides/common-v1_26-ts_277-0000002447836661) |
| 6 | Navigation | Navigation传参返回参数形式差异的问题 | [link](https://developer.huawei.com/consumer/cn/doc/architecture-guides/common-v1_26-ts_91-0000002292968004) |
| 7 | Navigation | Navigation加载启动页方案 | [link](https://developer.huawei.com/consumer/cn/doc/architecture-guides/common-v1_26-ts_c211-0000002561336385) |
| 8 | Navigation | Navigation如何实现从0至1渐变出现的跳转动画 | [link](https://developer.huawei.com/consumer/cn/doc/architecture-guides/common-v1_26-ts_552-0000002551603845) |
| 9 | Navigation | Navigation组件管理两个界面都加载本地H5进行交互跳转，如何进行页面刷新 | [link](https://developer.huawei.com/consumer/cn/doc/architecture-guides/insurance-v1_2-ts_234-0000002429776361) |
| 10 | Navigation | Navigation自定义标题栏不生效问题如何修改 | [link](https://developer.huawei.com/consumer/cn/doc/architecture-guides/common-v1_26-ts_8-0000002263888794) |
| 11 | Navigation | Tab组件内Navigation跳转，TabBar导航栏隐藏失败如何解决 | [link](https://developer.huawei.com/consumer/cn/doc/architecture-guides/common-v1_26-ts_12-0000002263515132) |
| 12 | Navigation | 元服务中Navigation替换AtomicServiceNavigation | [link](https://developer.huawei.com/consumer/cn/doc/architecture-guides/common-v1_26-ts_388-0000002538038307) |
| 13 | Navigation | 如何解决Navigation路由调用pop后onPop回调代码不执行的问题 | [link](https://developer.huawei.com/consumer/cn/doc/architecture-guides/common-v1_26-ts_34-0000002263888774) |
| 14 | Navigation | 如何解决Navigation跳转页面白屏问题 | [link](https://developer.huawei.com/consumer/cn/doc/architecture-guides/common-v1_26-ts_531-0000002549847087) |
| 15 | NavDestination, Span | 怎么解决自定义Span组件在NavDestination下无法显示问题 | [link](https://developer.huawei.com/consumer/cn/doc/architecture-guides/common-v1_26-ts_75-0000002263618218) |
| 16 | Navigation | Navigation中如何关闭removeByName删除页面时的默认动画 | [link](https://developer.huawei.com/consumer/cn/doc/architecture-guides/tools-v1_2-ts_287-0000002396991094) |
| 17 | Navigation | Navigation如何携带参数返回首页 | [link](https://developer.huawei.com/consumer/cn/doc/architecture-guides/tools-v1_2-ts_48-0000002353524397) |
| 18 | Navigation | 在子窗口中使用Navigation进行多页面跳转 | [link](https://developer.huawei.com/consumer/cn/doc/architecture-guides/tools-v1_2-ts_388-0000002568187617) |
| 19 | Navigation | 如何实现Web组件在Navigation页面中返回上一页 | [link](https://developer.huawei.com/consumer/cn/doc/architecture-guides/tools-v1_2-ts_263-0000002393180604) |
| 20 | Navigation | 如何混用Navigation和router实现路由导航 | [link](https://developer.huawei.com/consumer/cn/doc/architecture-guides/tools-v1_2-ts_54-0000002362098969) |
| 21 | NavDestination, Navigation | 自定义router到Navigation中NavDestination子页面的转场动画 | [link](https://developer.huawei.com/consumer/cn/doc/architecture-guides/tools-v1_2-ts_317-0000002444273321) |
| 22 | Navigation | Navigation实现闪屏页 | [link](https://developer.huawei.com/consumer/cn/doc/architecture-guides/splash_page-0000002303412054) |
| 23 | Radio | 使用HMRouter跳转后Radio无法保持选中状态 | [link](https://developer.huawei.com/consumer/cn/doc/architecture-guides/photo-v1_2-ts_35-0000002409958730) |
| 24 | Navigation | Navigation在分栏模式下，如何给右侧空白部分设置默认页面 | [link](https://developer.huawei.com/consumer/cn/doc/architecture-guides/educate-v1_1-ts_71-0000002373804518) |
| 25 | Navigation | Navigation在分栏模式下页面有大量留白 | [link](https://developer.huawei.com/consumer/cn/doc/architecture-guides/educate-v1_1-ts_c56-0000002385171678) |
| 26 | Navigation | 组件外层加了Navigation后，该组件的高度不能达到整个屏幕高度 | [link](https://developer.huawei.com/consumer/cn/doc/architecture-guides/educate-v1_1-ts_65-0000002406921681) |
| 27 | Navigation | 如何监听Navigation路由的页面切换事件 | [link](https://developer.huawei.com/consumer/cn/doc/architecture-guides/news-v1_2-ts_60-0000002393419837) |
| 28 | Swiper | 通过滑动Swiper进行router路由跳转时页面闪烁如何解决 | [link](https://developer.huawei.com/consumer/cn/doc/architecture-guides/news-v1_2-ts_87-0000002415689069) |
| 29 | Navigation | 关于在Navigation的子页面使用bindSheet导致侧滑无响应的问题定位 | [link](https://developer.huawei.com/consumer/cn/doc/architecture-guides/tourist-v1_2-ts_5-0000002392272434) |
| 30 | Navigation | Navigation导航模式根页面onPageShow生命周期触发问题 | [link](https://developer.huawei.com/consumer/cn/doc/architecture-guides/shaking_to_dialog_1-ts_40-0000002378698296) |
| 31 | Navigation | 实现Navigation首页和子页面互相跳转时的显隐监听 | [link](https://developer.huawei.com/consumer/cn/doc/architecture-guides/shaking_to_dialog_1-ts_11-0000002340361193) |
| 32 | Navigation | Navigation如何获取页面名称 | [link](https://developer.huawei.com/consumer/cn/doc/architecture-guides/insurance-v1_2-ts_45-0000002325074898) |
| 33 | Navigation | Navigation跨包跳转报错hap path error | [link](https://developer.huawei.com/consumer/cn/doc/architecture-guides/insurance-v1_2-ts_187-0000002417497949) |
| 34 | Navigation | 如何在目标页面判断路由来源于Navigation还是Router | [link](https://developer.huawei.com/consumer/cn/doc/architecture-guides/insurance-v1_2-ts_207-0000002420087517) |
| 35 | Navigation | 如何实现Navigation的单栏与分栏模式动态切换的效果 | [link](https://developer.huawei.com/consumer/cn/doc/architecture-guides/insurance-v1_2-ts_116-0000002406922585) |
| 36 | Navigation | 如何解决CustomDialog内嵌套Navigation导致弹窗无法底部对齐的问题 | [link](https://developer.huawei.com/consumer/cn/doc/architecture-guides/insurance-v1_2-ts_c101-0000002524731738) |
| 37 | NavDestination | 如何解决NavDestination切换页面后浏览位置无法保存问题 | [link](https://developer.huawei.com/consumer/cn/doc/architecture-guides/insurance-v1_2-ts_50-0000002358873469) |
| 38 | Navigation | 如何通过无感监听实现Navigation根页面的埋点监听 | [link](https://developer.huawei.com/consumer/cn/doc/architecture-guides/insurance-v1_2-ts_253-0000002441255669) |
| 39 | Tabs | 跳转其他页面返回时，如何设置Tabs的默认显示页面 | [link](https://developer.huawei.com/consumer/cn/doc/architecture-guides/socialcontact-v1_2-ts_27-0000002382158853) |
| 40 | Navigation | Navigation自定义toolBar实现多次点击常亮效果时显示异常 | [link](https://developer.huawei.com/consumer/cn/doc/architecture-guides/office-v1_2-ts_18-0000002378034345) |
| 41 | Refresh | 基于Refresh实现下拉跳转到指定页面 | [link](https://developer.huawei.com/consumer/cn/doc/architecture-guides/pull_to_jump-0000002282295284) |
| 42 | Navigation | Navigation使用replacePath跳转后，如何携带数据返回到栈内上一个页面 | [link](https://developer.huawei.com/consumer/cn/doc/architecture-guides/purchase-v1_2-ts_22-0000002337820188) |
| 43 | TextArea | 如何解决动态修改TextArea数量时光标跳转的问题 | [link](https://developer.huawei.com/consumer/cn/doc/architecture-guides/purchase-v1_2-ts_17-0000002325074906) |
| 44 | Navigation | 活体检测完成返回指定Navigation路由页面功能实现 | [link](https://developer.huawei.com/consumer/cn/doc/architecture-guides/purchase-v1_2-ts_52-0000002443438057) |
| 45 | NavDestination | 如何解决NavDestination页面做首页时跳转动画异常问题 | [link](https://developer.huawei.com/consumer/cn/doc/architecture-guides/architecture-v1-3_2-ts_38-0000002374590490) |
| 46 | Navigation | 实现热启动跳转至指定Navigation组件页面 | [link](https://developer.huawei.com/consumer/cn/doc/architecture-guides/architecture-v1-3_2-ts_94-0000002412256838) |

## Text/Span/RichText 文本展示（40 篇）

Reference: `references/text-rich-display-patterns.md`

| # | 组件 | 标题 | 官方链接 |
|---:|---|---|---|
| 1 | Text | Text组件如何实现文字垂直方向显示效果 | [link](https://developer.huawei.com/consumer/cn/doc/architecture-guides/convenient-life-v1_2-ts_33-0000002337898788) |
| 2 | RichText | 如何解决RichText设置backgroundColor无效的问题 | [link](https://developer.huawei.com/consumer/cn/doc/architecture-guides/convenient-life-v1_2-ts_6-0000002297797493) |
| 3 | Text | 实现Text文本无限长不换行 | [link](https://developer.huawei.com/consumer/cn/doc/architecture-guides/convenient-life-v1_2-ts_67-0000002366496954) |
| 4 | Text | 基于Text和弹窗实现人机验证 | [link](https://developer.huawei.com/consumer/cn/doc/architecture-guides/text_order_verification-0000002347027492) |
| 5 | Flex, Text | Flex布局Text自动换行时显示不全 | [link](https://developer.huawei.com/consumer/cn/doc/architecture-guides/tools-v1_2-ts_292-0000002430841825) |
| 6 | Span, Text | Text组件下Span布局属性和触摸事件无效 | [link](https://developer.huawei.com/consumer/cn/doc/architecture-guides/common-v1_26-ts_92-0000002299731174) |
| 7 | Text | Text组件实现长按全选内容并弹出自定义菜单 | [link](https://developer.huawei.com/consumer/cn/doc/architecture-guides/common-v1_26-ts_c238-0000002535733194) |
| 8 | Text | Text组件计算文本行数 | [link](https://developer.huawei.com/consumer/cn/doc/architecture-guides/architecture-v1-3_2-ts_66-0000002425876717) |
| 9 | Span | 基于属性字符串实现Span的边框效果 | [link](https://developer.huawei.com/consumer/cn/doc/architecture-guides/common-v1_26-ts_c163-0000002523513412) |
| 10 | Text | 如何实现Text字号自适应缩放与省略 | [link](https://developer.huawei.com/consumer/cn/doc/architecture-guides/common-v1_26-ts_272-0000002411746876) |
| 11 | Text | 实现Text设置lineHeight属性后文本垂直居中显示 | [link](https://developer.huawei.com/consumer/cn/doc/architecture-guides/common-v1_26-ts_571-0000002522215336) |
| 12 | Text, Row | Row组件内Text内容溢出 | [link](https://developer.huawei.com/consumer/cn/doc/architecture-guides/tools-v1_2-ts_16-0000002283777122) |
| 13 | TextTimer | TextTimer组件使用计时功能时的常见场景 | [link](https://developer.huawei.com/consumer/cn/doc/architecture-guides/insurance-v1_2-ts_43-0000002358684541) |
| 14 | Text | Text组件如何在设定范围内实现宽高自适应 | [link](https://developer.huawei.com/consumer/cn/doc/architecture-guides/tools-v1_2-ts_166-0000002374782336) |
| 15 | Text | Text绑定自定义菜单 | [link](https://developer.huawei.com/consumer/cn/doc/architecture-guides/tools-v1_2-ts_273-0000002395700278) |
| 16 | Text | 实现Text长按和点击弹出不同的菜单 | [link](https://developer.huawei.com/consumer/cn/doc/architecture-guides/tools-v1_2-ts_356-0000002506158546) |
| 17 | Text | 解决Text文本超出父容器高度的问题 | [link](https://developer.huawei.com/consumer/cn/doc/architecture-guides/tools-v1_2-ts_257-0000002425796885) |
| 18 | Span, Text | Text组件嵌套多个Span组件的布局效果示例 | [link](https://developer.huawei.com/consumer/cn/doc/architecture-guides/audio-v1_2-ts_56-0000002442830489) |
| 19 | Text | 如何设置Text组件的缩进避让 | [link](https://developer.huawei.com/consumer/cn/doc/architecture-guides/audio-v1_2-ts_11-0000002371789809) |
| 20 | Text | Text组件显示转义字符异常 | [link](https://developer.huawei.com/consumer/cn/doc/architecture-guides/educate-v1_1-ts_107-0000002383310070) |
| 21 | Text | Text组件滚动虚化样式实现 | [link](https://developer.huawei.com/consumer/cn/doc/architecture-guides/educate-v1_1-ts_12-0000002312334553) |
| 22 | Text | Text组件设置装饰线透明色不生效 | [link](https://developer.huawei.com/consumer/cn/doc/architecture-guides/educate-v1_1-ts_129-0000002427191201) |
| 23 | Text | 如何实现Text短文本居中，长文本居左 | [link](https://developer.huawei.com/consumer/cn/doc/architecture-guides/educate-v1_1-ts_66-0000002373202124) |
| 24 | Span | 如何获取Span的位置信息 | [link](https://developer.huawei.com/consumer/cn/doc/architecture-guides/educate-v1_1-ts_150-0000002445775885) |
| 25 | ImageSpan | ImageSpan使用场景 | [link](https://developer.huawei.com/consumer/cn/doc/architecture-guides/news-v1_2-ts_66-0000002401059169) |
| 26 | TextTimer | TextTimer展示纯秒数时间格式设置 | [link](https://developer.huawei.com/consumer/cn/doc/architecture-guides/news-v1_2-ts_133-0000002414196522) |
| 27 | Text | Text组件如何渲染包含em标签的html字符串 | [link](https://developer.huawei.com/consumer/cn/doc/architecture-guides/news-v1_2-ts_95-0000002417985505) |
| 28 | Text | 使用Repeat加载Text组件，内容渲染顺序出错如何解决 | [link](https://developer.huawei.com/consumer/cn/doc/architecture-guides/news-v1_2-ts_140-0000002518526128) |
| 29 | Text | 如何解决Text组件含有多种字符时两端对齐间距大小不一致问题 | [link](https://developer.huawei.com/consumer/cn/doc/architecture-guides/news-v1_2-ts_22-0000002263564722) |
| 30 | Text | Text组件如何给文本添加下划线 | [link](https://developer.huawei.com/consumer/cn/doc/architecture-guides/shaking_to_dialog_1-ts_39-0000002412297721) |
| 31 | Text | Text组件如何获取关键字相对组件的坐标进行绘制下划线 | [link](https://developer.huawei.com/consumer/cn/doc/architecture-guides/shaking_to_dialog_1-ts_44-0000002414671869) |
| 32 | RichText | RichText组件字体大小设置失败 | [link](https://developer.huawei.com/consumer/cn/doc/architecture-guides/insurance-v1_2-ts_162-0000002413440129) |
| 33 | Span, Text | Text嵌套Span组件maxFontSize失效 | [link](https://developer.huawei.com/consumer/cn/doc/architecture-guides/insurance-v1_2-ts_159-0000002379840720) |
| 34 | Text | Text组件字符超过特定长度时，超出部分如何隐藏与显示 | [link](https://developer.huawei.com/consumer/cn/doc/architecture-guides/insurance-v1_2-ts_3-0000002298075133) |
| 35 | Span | 关于Span减少字体大小无法自适应缩放的问题 | [link](https://developer.huawei.com/consumer/cn/doc/architecture-guides/insurance-v1_2-ts_165-0000002413854729) |
| 36 | Text | 判断Text组件中的内容是否换行 | [link](https://developer.huawei.com/consumer/cn/doc/architecture-guides/insurance-v1_2-ts_160-0000002379680868) |
| 37 | Span | 如何给Span组件设置渐变背景色 | [link](https://developer.huawei.com/consumer/cn/doc/architecture-guides/insurance-v1_2-ts_141-0000002409371849) |
| 38 | Text | 设置Text字体颜色后，手机运行项目，字体仍显示为黑色 | [link](https://developer.huawei.com/consumer/cn/doc/architecture-guides/insurance-v1_2-ts_158-0000002413440125) |
| 39 | Span | Span组件响应组件外点击事件 | [link](https://developer.huawei.com/consumer/cn/doc/architecture-guides/office-v1_2-ts_58-0000002426543541) |
| 40 | Text | 识别Text组件中文本内容里的链接功能 | [link](https://developer.huawei.com/consumer/cn/doc/architecture-guides/architecture-v1-3_2-ts_78-0000002397239094) |

## Image 资源加载适配（34 篇）

Reference: `references/image-resource-fit-patterns.md`

| # | 组件 | 标题 | 官方链接 |
|---:|---|---|---|
| 1 | GridItem | GridItem包含图片时，拖拽图片无法交换位置 | [link](https://developer.huawei.com/consumer/cn/doc/architecture-guides/convenient-life-v1_2-ts_205-0000002520355700) |
| 2 | Image | Image组件加载SVG图片异常 | [link](https://developer.huawei.com/consumer/cn/doc/architecture-guides/convenient-life-v1_2-ts_69-0000002406920941) |
| 3 | Image | Image组件按照宽度进行填充加载时高度裁剪问题 | [link](https://developer.huawei.com/consumer/cn/doc/architecture-guides/convenient-life-v1_2-ts_104-0000002417331669) |
| 4 | Image | 使用Image组件加载图片，发现图片变为了正方形 | [link](https://developer.huawei.com/consumer/cn/doc/architecture-guides/convenient-life-v1_2-ts_90-0000002379836924) |
| 5 | Image | 如何根据API版本动态增加Image组件的属性 | [link](https://developer.huawei.com/consumer/cn/doc/architecture-guides/convenient-life-v1_2-ts_144-0000002409948110) |
| 6 | Image | 长按Image组件拖动，如何避免唤醒小艺 | [link](https://developer.huawei.com/consumer/cn/doc/architecture-guides/convenient-life-v1_2-ts_18-0000002273250318) |
| 7 | Rating | Rating组件自定义图片资源 | [link](https://developer.huawei.com/consumer/cn/doc/architecture-guides/traffic-v1_1-ts_71-0000002430630725) |
| 8 | Image | 通过colorFilter和颜色矩阵修改Image的颜色 | [link](https://developer.huawei.com/consumer/cn/doc/architecture-guides/traffic-v1_1-ts_24-0000002367617758) |
| 9 | Image | Image加载本地图片 | [link](https://developer.huawei.com/consumer/cn/doc/architecture-guides/common-v1_26-ts_100-0000002342462960) |
| 10 | Image | Image组件加载含有特殊字符的图片失败如何解决 | [link](https://developer.huawei.com/consumer/cn/doc/architecture-guides/common-v1_26-ts_6-0000002298448789) |
| 11 | ImageSpan | RichEditor获取ImageSpan中图片信息 | [link](https://developer.huawei.com/consumer/cn/doc/architecture-guides/common-v1_26-ts_232-0000002430630729) |
| 12 | Image | 图文混排时Image组件交互事件无响应如何解决 | [link](https://developer.huawei.com/consumer/cn/doc/architecture-guides/common-v1_26-ts_68-0000002263888798) |
| 13 | Image | 如何解决给Image组件设置resizable在不同设备上显示不一致问题 | [link](https://developer.huawei.com/consumer/cn/doc/architecture-guides/common-v1_26-ts_168-0000002381162490) |
| 14 | Image | Image组件根据不同状态设置不同资源 | [link](https://developer.huawei.com/consumer/cn/doc/architecture-guides/tools-v1_2-ts_235-0000002384427938) |
| 15 | Slider | 如何实现Slider滑动切换图片的效果 | [link](https://developer.huawei.com/consumer/cn/doc/architecture-guides/tools-v1_2-ts_278-0000002396416602) |
| 16 | Image | 如何控制Image组件的点击响应区域 | [link](https://developer.huawei.com/consumer/cn/doc/architecture-guides/tools-v1_2-ts_124-0000002571202955) |
| 17 | Image | 怎么解决Image组件加载图片被旋转90度的问题 | [link](https://developer.huawei.com/consumer/cn/doc/architecture-guides/tools-v1_2-ts_14-0000002298448741) |
| 18 | Image | 自定义相机双路预览通过Image组件显示ImageReceiver接收的预览流图像异常 | [link](https://developer.huawei.com/consumer/cn/doc/architecture-guides/audio-v1_2-ts_80-0000002541133679) |
| 19 | Image | Image加载沙箱图片 | [link](https://developer.huawei.com/consumer/cn/doc/architecture-guides/architecture-v1-3_2-ts_12-0000002524862676) |
| 20 | Image | Image动态设置圆角大小 | [link](https://developer.huawei.com/consumer/cn/doc/architecture-guides/photo-v1_2-ts_28-0000002383163006) |
| 21 | Image | Image组件宽高等比例放大后图片出现锯齿如何解决 | [link](https://developer.huawei.com/consumer/cn/doc/architecture-guides/photo-v1_2-ts_2-0000002298893313) |
| 22 | SaveButton | SaveButton保存图片，媒体库没有实时刷新的问题如何定位 | [link](https://developer.huawei.com/consumer/cn/doc/architecture-guides/photo-v1_2-ts_3-0000002263515160) |
| 23 | Image | 如何解决Image组件切换网络图片失败后占位图未显示的问题 | [link](https://developer.huawei.com/consumer/cn/doc/architecture-guides/photo-v1_2-ts_c42-0000002554528697) |
| 24 | Image | 实现Image组件的渐变模糊效果 | [link](https://developer.huawei.com/consumer/cn/doc/architecture-guides/photo-v1_2-ts_c45-0000002527659338) |
| 25 | Column | Column宽高自适应背景图片大小 | [link](https://developer.huawei.com/consumer/cn/doc/architecture-guides/educate-v1_1-ts_69-0000002406921685) |
| 26 | Image | Image组件加载SVG图片异常的常见问题 | [link](https://developer.huawei.com/consumer/cn/doc/architecture-guides/news-v1_2-ts_142-0000002521155116) |
| 27 | Image | Image组件加载在线图片报错 | [link](https://developer.huawei.com/consumer/cn/doc/architecture-guides/news-v1_2-ts_55-0000002418166952) |
| 28 | Image | 网络图片用Image组件加载变成横屏显示如何解决 | [link](https://developer.huawei.com/consumer/cn/doc/architecture-guides/news-v1_2-ts_34-0000002263237494) |
| 29 | Image | Image组件设置aspectRatio后宽度无法充满 | [link](https://developer.huawei.com/consumer/cn/doc/architecture-guides/shaking_to_dialog_1-ts_33-0000002407413921) |
| 30 | Image | Image加载失败时显示不同图片 | [link](https://developer.huawei.com/consumer/cn/doc/architecture-guides/insurance-v1_2-ts_133-0000002374610218) |
| 31 | Image | Image如何显示gif动图 | [link](https://developer.huawei.com/consumer/cn/doc/architecture-guides/purchase-v1_2-ts_41-0000002417987641) |
| 32 | Image | 如何扩大Image组件的点击区域 | [link](https://developer.huawei.com/consumer/cn/doc/architecture-guides/purchase-v1_2-ts_38-0000002380365630) |
| 33 | Text | 如何解决Text组件无法根据内容自动拉伸背景图片的问题 | [link](https://developer.huawei.com/consumer/cn/doc/architecture-guides/purchase-v1_2-ts_8-0000002298448773) |
| 34 | Image, Text | Image动态适配Text的宽高 | [link](https://developer.huawei.com/consumer/cn/doc/architecture-guides/architecture-v1-3_2-ts_85-0000002441090145) |

## Video 播放全屏（14 篇）

Reference: `references/video-playback-fullscreen-patterns.md`

| # | 组件 | 标题 | 官方链接 |
|---:|---|---|---|
| 1 | Video | Video组件是否可以设置User-Agent | [link](https://developer.huawei.com/consumer/cn/doc/architecture-guides/convenient-life-v1_2-ts_179-0000002505714968) |
| 2 | Video | 如何实现Video组件画面尺寸跟随半模态页面bindSheet的尺寸同步变化 | [link](https://developer.huawei.com/consumer/cn/doc/architecture-guides/traffic-v1_1-ts_46-0000002383313818) |
| 3 | Video | 如何实现自定义Video组件的控制栏功能 | [link](https://developer.huawei.com/consumer/cn/doc/architecture-guides/tools-v1_2-ts_206-0000002414512013) |
| 4 | Video | Video播放系统图库视频 | [link](https://developer.huawei.com/consumer/cn/doc/architecture-guides/audio-v1_2-ts_81-0000002509253676) |
| 5 | Video | Video组件如何获取视频的时长和播放进度 | [link](https://developer.huawei.com/consumer/cn/doc/architecture-guides/audio-v1_2-ts_107-0000002521459074) |
| 6 | Video | Video组件实现横竖屏切换和全屏播放 | [link](https://developer.huawei.com/consumer/cn/doc/architecture-guides/audio-v1_2-ts_97-0000002550257823) |
| 7 | Video | Video组件自动播放控制的常见场景 | [link](https://developer.huawei.com/consumer/cn/doc/architecture-guides/audio-v1_2-ts_c124-0000002555435635) |
| 8 | Video | 如何解决Video组件播放前出现预览黑屏的问题 | [link](https://developer.huawei.com/consumer/cn/doc/architecture-guides/audio-v1_2-ts_7-0000002298352337) |
| 9 | Video | 应用前后台切换时，如何解决Video组件播放发生中断的问题 | [link](https://developer.huawei.com/consumer/cn/doc/architecture-guides/audio-v1_2-ts_9-0000002297910537) |
| 10 | List | 如何解决AVPlayer在List组件中无法实现全屏播放问题 | [link](https://developer.huawei.com/consumer/cn/doc/architecture-guides/news-v1_2-ts_16-0000002298124705) |
| 11 | Video | 如何解决Video组件全屏播放时，自定义控制器显示异常的问题 | [link](https://developer.huawei.com/consumer/cn/doc/architecture-guides/news-v1_2-ts_91-0000002417122333) |
| 12 | Video | Video初始化阶段闪屏 | [link](https://developer.huawei.com/consumer/cn/doc/architecture-guides/insurance-v1_2-ts_221-0000002393180596) |
| 13 | Video | Video播放网络视频异常的常见问题 | [link](https://developer.huawei.com/consumer/cn/doc/architecture-guides/socialcontact-v1_2-ts_56-0000002392863684) |
| 14 | Video | setCurrentTime方法指定Video组件开始播放位置偶现其它帧闪烁的问题 | [link](https://developer.huawei.com/consumer/cn/doc/architecture-guides/architecture-v1-3_2-ts_48-0000002415307425) |

## Input/Focus/Keyboard 输入焦点键盘（39 篇）

Reference: `references/input-focus-keyboard-patterns.md`

| # | 组件 | 标题 | 官方链接 |
|---:|---|---|---|
| 1 | TextInput | 如何使两个TextInput组件有序输入内容 | [link](https://developer.huawei.com/consumer/cn/doc/architecture-guides/convenient-life-v1_2-ts_135-0000002430838693) |
| 2 | TextInput | 如何监听自定义子组件中TextInput输入内容的变化 | [link](https://developer.huawei.com/consumer/cn/doc/architecture-guides/convenient-life-v1_2-ts_182-0000002539847323) |
| 3 | TextInput | 如何解决TextInput文本内容超出父组件的问题 | [link](https://developer.huawei.com/consumer/cn/doc/architecture-guides/convenient-life-v1_2-ts_218-0000002525991678) |
| 4 | TextInput, Select | 如何解决点击Select下拉菜单会导致TextInput失焦的问题 | [link](https://developer.huawei.com/consumer/cn/doc/architecture-guides/convenient-life-v1_2-ts_219-0000002526529090) |
| 5 | TextInput | TextInput组件如何实现文本默认选中效果 | [link](https://developer.huawei.com/consumer/cn/doc/architecture-guides/traffic-v1_1-ts_43-0000002382314672) |
| 6 | TextInput | TextInput修改数据后光标位置重置 | [link](https://developer.huawei.com/consumer/cn/doc/architecture-guides/common-v1_26-ts_198-0000002385908612) |
| 7 | TextInput | TextInput如何动态设置下划线颜色 | [link](https://developer.huawei.com/consumer/cn/doc/architecture-guides/common-v1_26-ts_c160-0000002554513317) |
| 8 | TextInput | TextInput组件如何使用showError展示错误文本 | [link](https://developer.huawei.com/consumer/cn/doc/architecture-guides/common-v1_26-ts_c178-0000002556153689) |
| 9 | TextInput | TextInput组件实现验证码输入框 | [link](https://developer.huawei.com/consumer/cn/doc/architecture-guides/common-v1_26-ts_c152-0000002522354164) |
| 10 | TextInput | TextInput限制输入 | [link](https://developer.huawei.com/consumer/cn/doc/architecture-guides/common-v1_26-ts_82-0000002273289716) |
| 11 | Button, Text | 如何解决Button嵌套Text组件后requestFocus无法获取焦点的问题 | [link](https://developer.huawei.com/consumer/cn/doc/architecture-guides/common-v1_26-ts_184-0000002417386361) |
| 12 | TextInput | 如何解决TextInput组件密码模式下图标不能修改的问题 | [link](https://developer.huawei.com/consumer/cn/doc/architecture-guides/common-v1_26-ts_489-0000002515871036) |
| 13 | TextInput | 水印遮罩导致TextInput无法获取粘贴权限 | [link](https://developer.huawei.com/consumer/cn/doc/architecture-guides/common-v1_26-ts_218-0000002395608776) |
| 14 | Search | 基于Search组件keyboardAppearance属性设置输入法键盘沉浸式样式 | [link](https://developer.huawei.com/consumer/cn/doc/architecture-guides/input_method_application_immersive_mode-0000002283469114) |
| 15 | TextArea | TextArea拉起键盘的问题 | [link](https://developer.huawei.com/consumer/cn/doc/architecture-guides/tools-v1_2-ts_262-0000002426583397) |
| 16 | TextArea | TextArea设置计数器显示效果 | [link](https://developer.huawei.com/consumer/cn/doc/architecture-guides/tools-v1_2-ts_25-0000002340262685) |
| 17 | TextInput | TextInput实现自定义密码显隐效果 | [link](https://developer.huawei.com/consumer/cn/doc/architecture-guides/architecture-v1-3_2-ts_24-0000002552383065) |
| 18 | TextInput | TextInput组件禁止长按事件 | [link](https://developer.huawei.com/consumer/cn/doc/architecture-guides/tools-v1_2-ts_258-0000002425876725) |
| 19 | TextInput | TextInput设置手机号格式输入-如何解决修改数据后光标位置错乱的问题 | [link](https://developer.huawei.com/consumer/cn/doc/architecture-guides/tools-v1_2-ts_3-0000002298561821) |
| 20 | TextInput, TextArea | 如何实现TextArea、TextInput获取光标时不拉起键盘 | [link](https://developer.huawei.com/consumer/cn/doc/architecture-guides/tools-v1_2-ts_164-0000002374622448) |
| 21 | TextInput | 禁止编辑TextInput内容 | [link](https://developer.huawei.com/consumer/cn/doc/architecture-guides/tools-v1_2-ts_200-0000002413320293) |
| 22 | TextInput | 如何实现TextInput获焦失焦时的文本显示效果 | [link](https://developer.huawei.com/consumer/cn/doc/architecture-guides/educate-v1_1-ts_30-0000002358826161) |
| 23 | TextArea | 如何控制TextArea最多显示多少行，超出尺寸的显示滚动条 | [link](https://developer.huawei.com/consumer/cn/doc/architecture-guides/news-v1_2-ts_127-0000002410834098) |
| 24 | TextArea | ForEach嵌套TextArea时如何确保软键盘输入后不收起 | [link](https://developer.huawei.com/consumer/cn/doc/architecture-guides/insurance-v1_2-ts_167-0000002381162486) |
| 25 | TextArea | TextArea注入长文本未自动滚动 | [link](https://developer.huawei.com/consumer/cn/doc/architecture-guides/insurance-v1_2-ts_113-0000002373203016) |
| 26 | TextInput, TextArea | TextInput、RichEditor、TextArea避让软键盘 | [link](https://developer.huawei.com/consumer/cn/doc/architecture-guides/insurance-v1_2-ts_71-0000002393380261) |
| 27 | TextInput | TextInput如何监听键盘的删除操作 | [link](https://developer.huawei.com/consumer/cn/doc/architecture-guides/insurance-v1_2-ts_112-0000002406922581) |
| 28 | TextInput | TextInput组件中如何实现点击输入框弹出Popup气泡，选中内容时关闭Popup | [link](https://developer.huawei.com/consumer/cn/doc/architecture-guides/insurance-v1_2-ts_225-0000002427231329) |
| 29 | TextInput | TextInput组件的下划线设置 | [link](https://developer.huawei.com/consumer/cn/doc/architecture-guides/insurance-v1_2-ts_105-0000002367457874) |
| 30 | TextInput | TextInput组件获取焦点时，点击组件外区域如何收起软键盘问题 | [link](https://developer.huawei.com/consumer/cn/doc/architecture-guides/insurance-v1_2-ts_39-0000002319725458) |
| 31 | TextInput | TextInput背景设置 | [link](https://developer.huawei.com/consumer/cn/doc/architecture-guides/insurance-v1_2-ts_59-0000002373481017) |
| 32 | TextInput | TextInput输入框绑定自定义键盘不生效的解法方案 | [link](https://developer.huawei.com/consumer/cn/doc/architecture-guides/insurance-v1_2-ts_245-0000002430839929) |
| 33 | TextInput | 如何解决TextInput限制输入异常问题 | [link](https://developer.huawei.com/consumer/cn/doc/architecture-guides/insurance-v1_2-ts_244-0000002430719981) |
| 34 | TextInput | TextInput绑定的Popup气泡无法弹出 | [link](https://developer.huawei.com/consumer/cn/doc/architecture-guides/socialcontact-v1_2-ts_55-0000002392356882) |
| 35 | Search | Search组件是否支持设置placeholder文本和搜索图标的间距 | [link](https://developer.huawei.com/consumer/cn/doc/architecture-guides/office-v1_2-ts_63-0000002397239110) |
| 36 | TextInput | 使用bindPopup实现气泡占用全屏时TextInput可以输入文本的效果 | [link](https://developer.huawei.com/consumer/cn/doc/architecture-guides/office-v1_2-ts_46-0000002413316481) |
| 37 | TextArea | 在TextArea中复制完文字后如何取消文字的选中状态 | [link](https://developer.huawei.com/consumer/cn/doc/architecture-guides/office-v1_2-ts_66-0000002442710541) |
| 38 | TextInput | TextInput的placeholder文本显示不完整如何解决 | [link](https://developer.huawei.com/consumer/cn/doc/architecture-guides/purchase-v1_2-ts_46-0000002392863688) |
| 39 | Swiper | 如何解决Swiper嵌套多个RichEditor时，RichEditor输入异常的问题 | [link](https://developer.huawei.com/consumer/cn/doc/architecture-guides/architecture-v1-3_2-ts_92-0000002445416341) |

## Selection/Button 选择与按钮控件（12 篇）

Reference: `references/selection-controls-patterns.md`

| # | 组件 | 标题 | 官方链接 |
|---:|---|---|---|
| 1 | Checkbox | Checkbox多选、反选、全选场景实现方案 | [link](https://developer.huawei.com/consumer/cn/doc/architecture-guides/convenient-life-v1_2-ts_223-0000002563413357) |
| 2 | Checkbox | Checkbox更改样式 | [link](https://developer.huawei.com/consumer/cn/doc/architecture-guides/convenient-life-v1_2-ts_c120-0000002519957838) |
| 3 | Button | Button组件设置borderRadius无效 | [link](https://developer.huawei.com/consumer/cn/doc/architecture-guides/traffic-v1_1-ts_66-0000002393511512) |
| 4 | Checkbox | 如何解决Checkbox组件无法全部选中的问题 | [link](https://developer.huawei.com/consumer/cn/doc/architecture-guides/traffic-v1_1-ts_56-0000002419465221) |
| 5 | Toggle | 如何在EntryAbility中获取Toggle组件的值 | [link](https://developer.huawei.com/consumer/cn/doc/architecture-guides/common-v1_26-ts_c113-0000002548135001) |
| 6 | Toggle | 如何在Toggle的圆形滑块上添加文字 | [link](https://developer.huawei.com/consumer/cn/doc/architecture-guides/common-v1_26-ts_534-0000002518207324) |
| 7 | Radio | Radio组件通过ContentModifier实现自定义样式后如何实现单选 | [link](https://developer.huawei.com/consumer/cn/doc/architecture-guides/tools-v1_2-ts_2-0000002298561817) |
| 8 | Button | 如何实现Button可拖动并在应用退出后保存其位置 | [link](https://developer.huawei.com/consumer/cn/doc/architecture-guides/tools-v1_2-ts_198-0000002379840732) |
| 9 | CheckboxGroup | 动态生成多个CheckboxGroup并设置全选 | [link](https://developer.huawei.com/consumer/cn/doc/architecture-guides/educate-v1_1-ts_44-0000002393199425) |
| 10 | Checkbox | Checkbox多选和反选功能实现 | [link](https://developer.huawei.com/consumer/cn/doc/architecture-guides/news-v1_2-ts_48-0000002358786345) |
| 11 | DownloadFileButton | 如何使用DownloadFileButton组件保存文件 | [link](https://developer.huawei.com/consumer/cn/doc/architecture-guides/office-v1_2-ts_71-0000002411897168) |
| 12 | Toggle | 如何让组件（如Toggle）在自定义弹窗点击确认之后才改变状态 | [link](https://developer.huawei.com/consumer/cn/doc/architecture-guides/architecture-v1-3_2-ts_69-0000002427231325) |

## Slider/Progress 反馈与数值控件（20 篇）

Reference: `references/slider-progress-feedback-patterns.md`

| # | 组件 | 标题 | 官方链接 |
|---:|---|---|---|
| 1 | Slider | Slider组件滑轨的宽度不能铺满父容器 | [link](https://developer.huawei.com/consumer/cn/doc/architecture-guides/convenient-life-v1_2-ts_210-0000002521339928) |
| 2 | Slider | Slider组件自定义气泡开发 | [link](https://developer.huawei.com/consumer/cn/doc/architecture-guides/convenient-life-v1_2-ts_c132-0000002524893392) |
| 3 | Badge | Badge组件如何实现点击灰点处和按钮事件都生效 | [link](https://developer.huawei.com/consumer/cn/doc/architecture-guides/common-v1_26-ts_161-0000002413440145) |
| 4 | Slider | Slider设置为渐变色时不压缩 | [link](https://developer.huawei.com/consumer/cn/doc/architecture-guides/common-v1_26-ts_316-0000002503058698) |
| 5 | DataPanel | 如何在环形DataPanel组件上显示百分比信息 | [link](https://developer.huawei.com/consumer/cn/doc/architecture-guides/common-v1_26-ts_392-0000002538307077) |
| 6 | Slider | 如何让Slider不显示进度变化动画 | [link](https://developer.huawei.com/consumer/cn/doc/architecture-guides/common-v1_26-ts_434-0000002511363556) |
| 7 | Progress | Progress组件实现时钟样式进度条 | [link](https://developer.huawei.com/consumer/cn/doc/architecture-guides/tools-v1_2-ts_274-0000002429259969) |
| 8 | Progress | Progress进度更新问题 | [link](https://developer.huawei.com/consumer/cn/doc/architecture-guides/tools-v1_2-ts_316-0000002566762503) |
| 9 | Progress | 使用animator动画实现Progress宽高变化效果 | [link](https://developer.huawei.com/consumer/cn/doc/architecture-guides/tools-v1_2-ts_53-0000002325074910) |
| 10 | Progress | 自定义Progress样式的常见场景 | [link](https://developer.huawei.com/consumer/cn/doc/architecture-guides/tools-v1_2-ts_389-0000002541794832) |
| 11 | Slider | Slider组件调节系统音量 | [link](https://developer.huawei.com/consumer/cn/doc/architecture-guides/audio-v1_2-ts_95-0000002550125881) |
| 12 | Slider | 如何实现Slider正、负向滑动 | [link](https://developer.huawei.com/consumer/cn/doc/architecture-guides/audio-v1_2-ts_c115-0000002518524880) |
| 13 | DataPanel | 基于DataPanel实现双向滑块调节分数区间 | [link](https://developer.huawei.com/consumer/cn/doc/architecture-guides/adjusting_score_interval_screening_schools-0000002294530662) |
| 14 | Slider | 解决Slider精度问题 | [link](https://developer.huawei.com/consumer/cn/doc/architecture-guides/educate-v1_1-ts_79-0000002376295284) |
| 15 | Slider | 使用Slider时如何判断点击的是滑块还是进度条 | [link](https://developer.huawei.com/consumer/cn/doc/architecture-guides/news-v1_2-ts_85-0000002414561965) |
| 16 | Slider | 如何实现Slider滑块的自定义设置 | [link](https://developer.huawei.com/consumer/cn/doc/architecture-guides/news-v1_2-ts_116-0000002409956078) |
| 17 | Progress | Progress组件起点与终点样式重叠及白边问题 | [link](https://developer.huawei.com/consumer/cn/doc/architecture-guides/shaking_to_dialog_1-ts_64-0000002441170005) |
| 18 | Progress | 怎么解决Progress组件配合animateTo实现循环动画无反应问题 | [link](https://developer.huawei.com/consumer/cn/doc/architecture-guides/shaking_to_dialog_1-ts_8-0000002263227646) |
| 19 | Progress | Progress如何控制平滑过渡的速率 | [link](https://developer.huawei.com/consumer/cn/doc/architecture-guides/purchase-v1_2-ts_26-0000002393454045) |
| 20 | Progress | Progress滑动评分动效实现 | [link](https://developer.huawei.com/consumer/cn/doc/architecture-guides/purchase-v1_2-ts_53-0000002409798886) |

## Picker/Select/Menu 选择器菜单（9 篇）

Reference: `references/picker-select-menu-patterns.md`

| # | 组件 | 标题 | 官方链接 |
|---:|---|---|---|
| 1 | Menu | 如何实现点击Menu组件菜单选项弹出自定义弹框 | [link](https://developer.huawei.com/consumer/cn/doc/architecture-guides/convenient-life-v1_2-ts_129-0000002429890321) |
| 2 | Menu | 如何解决Menu组件在数据为空时依旧显示的问题 | [link](https://developer.huawei.com/consumer/cn/doc/architecture-guides/convenient-life-v1_2-ts_5-0000002263237462) |
| 3 | Select | Select如何自定义按钮样式和内容 | [link](https://developer.huawei.com/consumer/cn/doc/architecture-guides/common-v1_26-ts_616-0000002532292326) |
| 4 | DatePicker | 自定义DatePicker实现不同日历效果 | [link](https://developer.huawei.com/consumer/cn/doc/architecture-guides/common-v1_26-ts_204-0000002386827026) |
| 5 | TextPicker | TextPicker组件如何禁止响应事件 | [link](https://developer.huawei.com/consumer/cn/doc/architecture-guides/tools-v1_2-ts_174-0000002409376789) |
| 6 | TimePicker | 居中显示TimePicker的文本 | [link](https://developer.huawei.com/consumer/cn/doc/architecture-guides/news-v1_2-ts_101-0000002426940389) |
| 7 | Select | Select组件默认加粗字体 | [link](https://developer.huawei.com/consumer/cn/doc/architecture-guides/insurance-v1_2-ts_154-0000002378698304) |
| 8 | DatePicker, TextPicker | 使用TextPicker实现DatePicker的效果 | [link](https://developer.huawei.com/consumer/cn/doc/architecture-guides/insurance-v1_2-ts_24-0000002306289930) |
| 9 | PatternLock | 如何隐藏PatternLock控件的解锁轨迹 | [link](https://developer.huawei.com/consumer/cn/doc/architecture-guides/office-v1_2-ts_47-0000002379677068) |

## Flex/RelativeContainer 布局容器（11 篇）

Reference: `references/layout-containers-patterns.md`

| # | 组件 | 标题 | 官方链接 |
|---:|---|---|---|
| 1 | Flex | 基于Flex布局的常见换行场景 | [link](https://developer.huawei.com/consumer/cn/doc/architecture-guides/convenient-life-v1_2-ts_c133-0000002556074703) |
| 2 | Column | 如何绘制一个倾斜的Column | [link](https://developer.huawei.com/consumer/cn/doc/architecture-guides/convenient-life-v1_2-ts_185-0000002509565634) |
| 3 | Flex | 如何实现Flex分页展示的功能 | [link](https://developer.huawei.com/consumer/cn/doc/architecture-guides/common-v1_26-ts_612-0000002530379924) |
| 4 | Flex | 如何解决Flex组件设置width('auto')不生效的问题 | [link](https://developer.huawei.com/consumer/cn/doc/architecture-guides/common-v1_26-ts_398-0000002506676642) |
| 5 | Column | 如何解决Column子组件超出容器边界 | [link](https://developer.huawei.com/consumer/cn/doc/architecture-guides/tools-v1_2-ts_169-0000002375777270) |
| 6 | Flex | 如何解决Flex组件设置minHeight属性后子组件高度被压缩的问题 | [link](https://developer.huawei.com/consumer/cn/doc/architecture-guides/tools-v1_2-ts_326-0000002445421333) |
| 7 | Row | 解决Row容器空间不足时子组件消失的问题 | [link](https://developer.huawei.com/consumer/cn/doc/architecture-guides/tools-v1_2-ts_177-0000002409746321) |
| 8 | Flex | 解决不同主轴方向的Flex组件嵌套高度不一致的问题 | [link](https://developer.huawei.com/consumer/cn/doc/architecture-guides/tools-v1_2-ts_68-0000002337911476) |
| 9 | Row | Row组件设置padding属性不生效 | [link](https://developer.huawei.com/consumer/cn/doc/architecture-guides/educate-v1_1-ts_114-0000002418062213) |
| 10 | Flex | 如何实现Flex组件宽度和高度自适应子组件宽度和高度 | [link](https://developer.huawei.com/consumer/cn/doc/architecture-guides/shaking_to_dialog_1-ts_35-0000002409291741) |
| 11 | Flex | 利用Flex布局实现子项的展开与折叠 | [link](https://developer.huawei.com/consumer/cn/doc/architecture-guides/architecture-v1-3_2-ts_33-0000002373201824) |

## XComponent 原生渲染桥接（4 篇）

Reference: `references/xcomponent-native-patterns.md`

| # | 组件 | 标题 | 官方链接 |
|---:|---|---|---|
| 1 | XComponent | XComponent实现多个画面切换 | [link](https://developer.huawei.com/consumer/cn/doc/architecture-guides/traffic-v1_1-ts_25-0000002373042700) |
| 2 | XComponent | 停止XComponent渲染数据 | [link](https://developer.huawei.com/consumer/cn/doc/architecture-guides/common-v1_26-ts_345-0000002535669925) |
| 3 | XComponent | 如何解决XComponent无法触发触摸事件问题 | [link](https://developer.huawei.com/consumer/cn/doc/architecture-guides/common-v1_26-ts_110-0000002359726938) |
| 4 | XComponent | 重新初始化XComponent导致闪退 | [link](https://developer.huawei.com/consumer/cn/doc/architecture-guides/office-v1_2-ts_6-0000002330953313) |

## Shape 绘制组件（4 篇）

Reference: `references/drawing-shape-patterns.md`

| # | 组件 | 标题 | 官方链接 |
|---:|---|---|---|
| 1 | Polygon | 如何在同一个坐标系统里绘制多个Polygon | [link](https://developer.huawei.com/consumer/cn/doc/architecture-guides/common-v1_26-ts_270-0000002411906748) |
| 2 | Circle | Circle显示不同进度水波纹 | [link](https://developer.huawei.com/consumer/cn/doc/architecture-guides/audio-v1_2-ts_49-0000002397240366) |
| 3 | Circle | 如何使用Circle组件实现物体自由落体效果 | [link](https://developer.huawei.com/consumer/cn/doc/architecture-guides/purchase-v1_2-ts_32-0000002374629224) |
| 4 | Polyline | 基于Polyline实现比赛晋级图 | [link](https://developer.huawei.com/consumer/cn/doc/architecture-guides/tournament_advancement_chart-0000002381782357) |

