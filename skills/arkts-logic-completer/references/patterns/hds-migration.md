# HDS 迁移 Pattern —— 从原生 ArkUI 升级到 UI Design Kit

> **本文是横切"纪律文档",不是针对单个组件的 Reference**,因此不套用 9 节模板。
> 配套的组件级规格仍在 `references/HdsXxx.md`,本文只讲"怎么把已有页面迁过去"的纪律。

## §0. API 权威性 —— 为什么本文没有"材质效果"

本文使用的所有字段 / 枚举 **必须能在 [官方网站(`hds参考文档/中文文档/`)对外文档](../../../../hds参考文档/中文文档/)** 里直接命中,才会出现在 `6.1 默认配置` 和示例代码里。

仓库里的 [`hds参考文档/references/*.md`](../../../../hds参考文档/references/) 和 [`hds参考文档/组件参考.md`](../../../../hds参考文档/组件参考.md) 是 **HDS 开发人员的内部整理版**,包含一部分尚未对外开放的 API。典型的例子:

| 内部可见但对外未开放 | 本 Skill 处理方式 |
|-------------------|-----------------|
| `systemMaterialEffect: { ... }` 材质效果块 | **不生成**,既不出现在默认配置也不出现在示例里 |
| `hdsMaterial.MaterialType` / `MaterialLevel` / `DarkMode` 枚举 | **不导入**,避免写出编译不过的 `import` |
| `HdsToolBar`(顶部悬浮工具栏) / `HdsEffect` / `HdsDrawable` / `audiowave` / `pointlight` / `symbolRegister` / `MovingPhoto` | **本 Skill 不收**;若用户代码中出现,仅以"辨析"方式警示一句,不补 API |

这不是技术上的缺失,是**纪律选择** —— 生成可运行的三方应用代码,应以官方网站为准。等到华为官方把某个 API 对外公开,再来补 Reference。

## 读这份文档的时机

- 用户已有一个用**原生 ArkUI / 自定义容器**拼出来的页面,想要"升级"为 HDS。
- 生成代码时需要判断:**哪些组件要改,哪些保持不变,哪些参数是 HDS 6.1 推荐的默认值**。
- 组合使用多个 HDS 组件(如 `HdsNavigation` + `HdsActionBar`)时,需要一份统一的"默认 6.1 新特性配置"参考。

如果是**从零生成**一个 HDS 页面,可以直接读目标组件的 `HdsXxx.md` Reference,跳过本文 §5 / §6 的示例。

---

## §1. 两种迁移场景决策表

| 生态伙伴实现方式 | 目标场景 | 场景详情 | 开发者占比 | 支持方案 |
|-----------------|---------|---------|----------|---------|
| **ArkUI 实现** | **组件平替** | 原本使用的标准 `Tabs` / `Navigation` / `Toolbar` 组件平替到 HDS 组件 | 约 20% | 识别界面中的标准组件,替换为 HDS 同名组件并补新特性 |
| **ArkUI 实现** | **重构替换** | 用 `Column` / `Row` 等自定义拼出的 Toolbar / Tabs / Navigation,重构后替换为 HDS 组件 | 约 80% | 提取原自定义组件的功能,用 HDS 组件重写,建议用开关切换 |
| **RN 实现** | **不支持** | 原本用 Web 实现的效果移除再用 ArkTS 重写 | — | 不支持(会破坏跨平台效果) |

> 数据来源:`hds参考文档/references/migration-patterns.md` 第 5-9 行的适用场景表。

**判断口诀**:

- 目标界面里能**直接找到** `Tabs` / `Navigation` / `ListItem` / `SideBarContainer` 等标准组件 → 走 §2 的"平替"路径。
- 目标界面里是**一堆 `Column` / `Row` / `Scroll` 拼出来的**"看起来像 Toolbar"的结构 → 走 §6 的"重构"路径,优先把结构识别出来再选对应的 HDS 组件。

---

## §1.5 HdsTabs vs Tabs 选型决策

`HdsTabs` **继承自 `Tabs`** —— 原生 `Tabs` 的全部 API / 属性 / 事件在 `HdsTabs` 上都生效;反过来不成立。所以本节回答的问题是:**"要不要额外引入 HDS 6.1 的新能力"**,而不是"两个二选一"。

### 决策优先级表(从硬性到软性)

| 优先级 | 判断点 | 规则 |
|-------|--------|------|
| **P0 硬约束** | 目标设备最低 API 版本 | 需要跑在 **API < 20** 的设备 → **只能 `Tabs`**(HdsTabs 起始版本 API 20 / HarmonyOS 6.0) |
| **P0 硬约束** | 是否要适配 **TV 设备** | 要 TV → **只能 `Tabs`**(HdsTabs 官方明确不支持 TV) |
| **P1 视觉需求** | 分割线**跟手渐变**(TabBar 随内容滚动联动渐显/渐隐) | 需要 → `HdsTabs`(`DividerMode.FOLLOW_SCROLL` + `HdsTabsController.bindScroller`) |
| **P1 视觉需求** | TabBar **渐变模糊 / 内容过渡渐隐** | 需要 → `HdsTabs`(`barBackgroundStyle({ maskColor, maskHeight })`) |
| **P1 布局需求** | 平板 / 折叠屏下 **TabBar 半屏居中**(不满宽) | 需要 → `HdsTabs`(`barMode(ExtendBarMode.HALF_SCREEN_FIXED)`) |
| **P1 视觉需求** | **图标溢出 TabBar 边界**(出血图标,视觉冲击页签) | 需要 → `HdsTabs`(`bleedIconStyle`) |
| **P2 代码成本** | 项目已引入 `@kit.UIDesignKit`,团队熟悉 HDS | 是 → 优先 `HdsTabs`(沉浸感免费升级) |
| **P3 默认** | 以上都不确定 / 简单业务页 / 第三方 App 保守做法 | **`Tabs`**(原生最稳,零依赖) |

### 三条常见场景的直接结论

| 场景 | 选 | 理由 |
|------|-----|------|
| App **底部 4-5 个主页签**,图标 + 文字 | **`Tabs`** + `BottomTabBarStyle` | 底部主导航没有"跟手渐变"需求,原生足够;业务写法查 [BottomTab.md](../BottomTab.md) |
| **内容页顶部横向 Tab + 长列表**(热门/关注/推荐) | **`HdsTabs`** | 滑 List 时分割线跟手渐出、TabBar 背景渐隐,是 HDS 6.1 的招牌场景 |
| **工具类 / 低版本设备适配** / 第三方无 Kit 依赖 | **`Tabs`** | 不引 `@kit.UIDesignKit`,避免额外依赖 |

### 避免的误区(对齐 §0 / §2 规则)

1. **❌ "反正 HdsTabs 是更新版,无脑选 HdsTabs"** —— API 20 是很新的版本,老设备直接不可用;TV 也不支持。要看设备矩阵。
2. **❌ "HdsTabs 要把 TabContent 换成 HdsTabContent / TabBarStyle 换成 HdsBottomTabBarStyle"** —— **不存在这些 API**,见 §2 的"只改主组件"铁律。
3. **❌ "用 HdsTabs 就要开 `systemMaterialEffect` / `hdsMaterial.*` 做材质"** —— 这些是 **L3 内部 API**,官方网站未开放,本 Skill 不生成,见 §0 API 权威性。

> **小结**:遇到"选哪个" → 先看 P0 硬约束;若 P0 放行,再看业务界面是否需要 P1 那四种"跟手/模糊/半屏/出血"视觉;都用不上就**默认 `Tabs`**。

---

## §1.6 HdsNavigation vs Navigation 选型决策

`HdsNavigation` **继承自 `Navigation`**,所以 `Navigation` 的全部路由栈 / 属性 / 事件在 `HdsNavigation` 上都生效。本节回答:**"要不要额外引入 HDS 6.1 的动态模糊标题栏 / 滚动联动"**。

### 决策优先级表

| 优先级 | 判断点 | 规则 |
|-------|--------|------|
| **P0 硬约束** | 目标设备最低 API 版本 | 需要跑在 **API < 20** 的设备 → **只能 `Navigation`** |
| **P0 硬约束** | 是否要适配 **TV 设备** | 要 TV → **只能 `Navigation`** |
| **P1 视觉需求** | 需要**动态模糊标题栏**(滚动时 titleBar 背景从透明渐变为模糊) | 需要 → `HdsNavigation` |
| **P1 视觉需求** | 需要 Free 模式下**双标题样式**的增强切换动效 | 需要 → `HdsNavigation` |
| **P1 布局需求** | 需要**页面级 `titleBar({...}) / toolBar({...})` 精细控制**(由 `HdsNavDestination` 提供) | 需要 → `HdsNavigation` + [`HdsNavDestination`](../HdsNavDestination.md) 搭配 |
| **P2 代码成本** | 项目已引入 `@kit.UIDesignKit` | 是 → 优先 `HdsNavigation` |
| **P3 默认** | 以上都不确定 / 简单路由 / 第三方 App 保守做法 | **`Navigation`** |

### 三条常见场景的直接结论

| 场景 | 选 | 理由 |
|------|-----|------|
| 普通多层路由(首页 → 详情 → 编辑),只要标题 + 返回键 | **`Navigation`** | 基础路由能力足够,不引 Kit 依赖 |
| 长内容页(资讯流、相册、文档阅读)**标题栏要随滚动渐变模糊** | **`HdsNavigation`** + `HdsNavDestination` | HDS 6.1 招牌视觉 |
| 工具类 / 低版本设备 / 第三方无 Kit 依赖 | **`Navigation`** | 零依赖更稳 |

### 避免的误区

1. **❌ "反正 HdsNavigation 是更新版,无脑选它"** —— API 20 很新,老设备不可用;TV 不支持。
2. **❌ "HdsNavigation 要把 NavDestination / NavPathStack / ToolbarItem 都换掉"** —— **不存在** `HdsNavPathStack` / `HdsToolbarItem`,见 §2 只改主组件铁律。
3. **❌ "用 HdsNavigation 就要开 `systemMaterialEffect` / `hdsMaterial.*` 配材质"** —— L3 内部 API,本 Skill 不生成,见 §0。
4. **❌ "HdsNavigation 能直接替代 `@ohos.router`"** —— 无论原生还是 HDS 的 Navigation,都**不要**与旧 `router` 命名空间混用,两个路由系统互不感知。

> **小结**:路由行为本身 100% 由 `NavPathStack` 决定,`Navigation` / `HdsNavigation` 只是**外壳**。选型 = 要不要那套动态模糊视觉。不确定就 `Navigation`。

---

## §2. "只改主组件"铁律 —— 不要给所有东西加 Hds 前缀

这是从原生 `Tabs` 平替到 `HdsTabs` 时**最容易犯**的错:把所有子组件 / 样式类也加上 `Hds` 前缀,结果编译失败。

### 需要修改的(3 项)

| 项目 | 原生 | HDS |
|------|------|-----|
| **主组件名称** | `Tabs` | `HdsTabs` |
| **控制器类型** | `TabsController` | `HdsTabsController` |
| **导入语句** | 无需导入(内置组件) | `import { HdsTabs, HdsTabsController, DividerMode } from '@kit.UIDesignKit'` |

### 保持不变的(4 项,千万不要加 Hds 前缀)

| 项目 | 说明 |
|------|------|
| `TabContent` | **保持不变**,不存在 `HdsTabContent` 组件 |
| `SubTabBarStyle` | **保持不变**,不存在 `HdsSubTabBarStyle` |
| `BottomTabBarStyle` | **保持不变**,不存在 `HdsBottomTabBarStyle` |
| `Scroll` / `Column` / `Row` 等通用容器 | **保持不变**,HDS 不提供这一层的替代 |

> 表格来源:`hds参考文档/references/migration-patterns.md` 第 26-36 行、`hds参考文档/references/components.md` 第 52-60 行。

**与 validator 的关系**:上一轮 `validate_references.py` 里 `CHILD_TO_PARENT` 映射表曾把 `TabContent` / `BottomTabBarStyle` / `SubTabBarStyle` 收编到 `Tabs` —— 正是因为这条铁律成立,它们就是"原生组件的子节点",不该按 HDS 独立 Reference 来要求。

---

## §3. HDS 6.1 新特性默认配置样板

三方应用从原生组件升级到 HDS 组件,**主要目的就是体验 6.1 新特性**(悬浮栏、材质效果、动态模糊)。官方建议**默认**就把这些配置配上,而不是等开发者手动加。下面分两个主组件给出"开箱即用"样板,复制过去再微调即可。

### §3.1 HdsTabs 默认"三件套"

| 配置 | 作用 |
|------|------|
| `barOverlap(true)` | 页签栏背后变模糊并叠加在 `TabContent` 之上 |
| `divider({ mode: DividerMode.FOLLOW_SCROLL })` | 分割线跟手渐变显隐 |
| `barFloatingStyle({ ... })` | 悬浮页签栏配置(`barBottomMargin` 调底部留白) |

> `systemMaterialEffect` / `hdsMaterial.*` 材质效果**不是**对外开放 API,参考 §0 说明,本文不作为默认配置项。

**推荐默认写法**:

```typescript
import { HdsTabs, DividerMode } from '@kit.UIDesignKit'

HdsTabs() {
  // TabContent...(TabContent / BottomTabBarStyle 保持原生写法,见 §2)
}
.barPosition(BarPosition.End)
.barOverlap(true)
.divider({
  mode: DividerMode.FOLLOW_SCROLL,
  style: { strokeWidth: 0.5, color: 0x1A000000 }
})
.barFloatingStyle({
  barBottomMargin: 28
})
```

> 以上字段均可在 [`hds参考文档/中文文档/HdsTabs.md`](../../../../hds参考文档/中文文档/HdsTabs.md) 里找到原文描述。

**使用约束**(来源 `hds参考文档/中文文档/HdsTabs.md`):

- `barFloatingStyle` 必须配合 `barOverlap(true)`。
- 悬浮页签栏仅在 `barPosition(BarPosition.End)` 且 `vertical(false)` 时生效。
- `barWidth` 可省略 —— 默认走全屏宽度。

### §3.2 HdsNavigation 默认"动态模糊 + 双样式"

`HdsNavigation` 的 6.1 特性和 `HdsTabs` **不共享配置键** —— 模糊走 `titleBar.style.scrollEffectOpts`,"滚动前/滚动后"的视觉差异通过一组 `originalStyle` / `scrollEffectStyle` 双样式来表达。

```typescript
import { HdsNavigation, ScrollEffectType } from '@kit.UIDesignKit'
import { LengthMetrics } from '@kit.ArkUI'

HdsNavigation() {
  // 页面内容...
}
.titleBar({
  style: {
    scrollEffectOpts: {
      enableScrollEffect: true,
      scrollEffectType: ScrollEffectType.IMMERSIVE_GRADIENT_BLUR,
      blurEffectiveStartOffset: LengthMetrics.vp(0),
      blurEffectiveEndOffset: LengthMetrics.vp(20)
    },
    originalStyle: {
      backgroundStyle: {
        backgroundColor: $r('sys.color.ohos_id_color_background')
      },
      contentStyle: {
        titleStyle:    { mainTitleColor: $r('sys.color.font_primary'),
                         subTitleColor:  $r('sys.color.font_secondary') },
        menuStyle:     { backgroundColor: $r('sys.color.comp_background_tertiary'),
                         iconColor:       $r('sys.color.icon_primary') },
        backIconStyle: { backgroundColor: $r('sys.color.comp_background_tertiary'),
                         iconColor:       $r('sys.color.icon_primary') }
      }
    },
    scrollEffectStyle: {
      backgroundStyle: {
        backgroundColor: $r('sys.color.ohos_id_color_background_transparent')
      },
      contentStyle: {
        titleStyle:    { mainTitleColor: $r('sys.color.font_primary'),
                         subTitleColor:  $r('sys.color.font_secondary') },
        menuStyle:     { backgroundColor: $r('sys.color.comp_background_tertiary'),
                         iconColor:       $r('sys.color.icon_primary') },
        backIconStyle: { backgroundColor: $r('sys.color.comp_background_tertiary'),
                         iconColor:       $r('sys.color.icon_primary') }
      }
    }
  },
  content: {
    title: { mainTitle: '标题', subTitle: '副标题' }
  }
})
```

> 以上字段均可在 [`hds参考文档/中文文档/HdsNavigation.md`](../../../../hds参考文档/中文文档/HdsNavigation.md) 的 `ScrollEffectOptions` / `HdsNavigationTitleBarStyle` / `originalStyle` / `scrollEffectStyle` 小节找到。

**`scrollEffectType` 三档枚举**(来源同文件 `## ScrollEffectType` 小节):

| 取值 | 含义 | 典型场景 |
|------|------|---------|
| `COMMON_BLUR` | 通用模糊(默认) | 普通内容页、列表页 |
| `GRADIENT_BLUR` | 渐变模糊 | 有图片头图的页面,从图片淡出到背景 |
| `IMMERSIVE_GRADIENT_BLUR` | 沉浸式渐变模糊 | 适合文章详情 / 视频播放等沉浸页 |

**使用约束**:

- `blurEffectiveStartOffset` = 模糊**开始**生效的 vp 偏移;`blurEffectiveEndOffset` = 模糊**完全**生效的 vp 偏移。两者都用 `LengthMetrics.vp()` 包裹,**不能**直接写 `0` / `20`。
- `originalStyle` 和 `scrollEffectStyle` **两份都要给**,否则滚动过程中样式不会平滑插值。双样式里的子字段(`titleStyle` / `menuStyle` / `backIconStyle`)可以相同,但**结构必须对齐**。
- 若需做"材质 / 沉浸"观感,建议改走 `backgroundStyle.backgroundColor` 的透明化切换 —— 这属于官方对外开放范畴,和 §0 列出的"内部 API"不同。

### §3.3 去哪里找"第二份"同类样板

| 你在写什么组件 | 去哪读一份默认版 |
|--------------|---------------|
| `HdsTabs` | 本文 §3.1 + [`HdsTabs.md`](../HdsTabs.md) |
| `HdsNavigation` | 本文 §3.2 + [`HdsNavigation.md`](../HdsNavigation.md) |
| `HdsNavDestination` 上的 `titleBar` | [`HdsNavDestination.md`](../HdsNavDestination.md)(子页级,字段和 §3.2 一致) |
| `HdsActionBar` 结构 | [`HdsActionBar.md`](../HdsActionBar.md) |

---

## §5. 完整迁移示例 A —— Tabs 组件平替

> 原型代码 / 替换后代码均来自 `hds参考文档/references/migration-patterns.md` 第 40-94 行,仅做截断。

### 原生写法

```typescript
private tabsController: TabsController = new TabsController()

Tabs({ controller: this.tabsController }) {
  TabContent() {
    Text('内容1')
  }.tabBar('页签1')

  TabContent() {
    Text('内容2')
  }.tabBar('页签2')
}
.barHeight(48)
```

### HDS 平替(默认配置三件套)

```typescript
import { HdsTabs, HdsTabsController, DividerMode } from '@kit.UIDesignKit'

private tabsController: HdsTabsController = new HdsTabsController()

HdsTabs({ controller: this.tabsController }) {
  TabContent() {                      // 保持不变,见 §2
    Text('内容1')
  }.tabBar('页签1')

  TabContent() {                      // 保持不变
    Text('内容2')
  }.tabBar('页签2')
}
.barHeight(48)
.barPosition(BarPosition.End)
.barOverlap(true)
.divider({
  mode: DividerMode.FOLLOW_SCROLL,
  style: { strokeWidth: 0.5, color: 0x1A000000 }
})
.barFloatingStyle({
  barBottomMargin: 28
})
```

### 这次迁移做了什么

1. `Tabs` → `HdsTabs`、`TabsController` → `HdsTabsController`(§2 铁律)。
2. `TabContent` / `.tabBar()` 完全没碰(§2 铁律)。
3. 追加了 §3 的三件套作为 6.1 默认配置。
4. 新增 `import { HdsTabs, HdsTabsController, DividerMode } from '@kit.UIDesignKit'`。

---

## §6. 完整迁移示例 B —— 自定义 Toolbar/底栏的重构替换

> 来源:`hds参考文档/case-refactor-replacement.md/` 目录下的 `HdsToolbarPage.ets` 案例。本文只保留核心 **~60 行**骨架,完整 560 行原文见该目录。

### 识别要点 —— 哪些"自定义拼装"可以认出来是 HDS 组件

| 原生拼装模式 | 可替换为 | 识别特征 |
|------------|---------|---------|
| `Column` 顶部 `Row`(返回按钮 + 标题 + 菜单) | `HdsNavigation`(用 `.titleBar({ ... })` 配置) | 顶部有返回 + 中部标题 + 右侧操作按钮 |
| `Column` 底部 `Row`(点赞 + 评论 + 收藏多按钮) | `HdsActionBar`(`primaryButton` + `startButtons` / `endButtons` + `actionBarStyle`) | 底部一排按钮,常有主按钮样式不同 |

> ⚠️ **易错提示**:`HdsActionBar` 的按钮字段是 `startButtons` / `endButtons`(不是 `secondaryButtons`),样式字段是 `actionBarStyle`(不是 `style`),每个按钮必须 `new ActionBarButton({...})`、图标字段是 `baseIcon`(不是 `icon`)。完整 API 见 [`references/HdsActionBar.md`](../HdsActionBar.md) 或官方 [`hds参考文档/中文文档/HdsActionBar.md`](../../../../hds参考文档/中文文档/HdsActionBar.md)。

> 识别表来源:`hds参考文档/references/components.md` 第 112-126 行。

### 重构骨架(开关切换模式)

```typescript
import {
  HdsNavigation, HdsActionBar,
  ActionBarButton, ActionBarStyle,   // ⚠️ 按钮和样式都是类,必须一起导入
  ScrollEffectType
} from '@kit.UIDesignKit'
import { LengthMetrics } from '@kit.ArkUI'

// 迁移期保留开关,方便 A/B 对照回退
const USE_HDS_COMPONENTS = true

@Entry
@ComponentV2
struct ArticleDetail {
  @Local isLiked: boolean = false

  build() {
    if (USE_HDS_COMPONENTS) {
      this.HdsPageBuilder()
    } else {
      this.LegacyPageBuilder()   // 保留原实现,随时回退
    }
  }

  @Builder
  HdsPageBuilder() {
    HdsNavigation() {
      Column() {
        Scroll() { /* 文章内容 */ }.layoutWeight(1)
        this.HdsActionBarBuilder()
      }
    }
    .titleBar({
      style: {
        scrollEffectOpts: {
          enableScrollEffect: true,
          scrollEffectType: ScrollEffectType.IMMERSIVE_GRADIENT_BLUR,
          blurEffectiveStartOffset: LengthMetrics.vp(0),
          blurEffectiveEndOffset: LengthMetrics.vp(20)
        },
        originalStyle: { /* 滚动前样式,参考 §3.2 */ },
        scrollEffectStyle: { /* 滚动后样式,参考 §3.2 */ }
      },
      content: {
        title: { mainTitle: '文章详情' }
      }
    })
  }

  @Builder
  HdsActionBarBuilder() {
    HdsActionBar({
      // 主按钮:必须 new ActionBarButton(...),图标字段是 baseIcon / altIcon
      primaryButton: new ActionBarButton({
        baseIcon: $r('sys.symbol.heart'),
        altIcon:  $r('sys.symbol.heart_fill'),
        onClick: (): void => { this.isLiked = !this.isLiked }
      }),
      // 评论 / 收藏 放在末尾位置按钮组(不是 "secondaryButtons")
      endButtons: [
        new ActionBarButton({
          baseIcon: $r('sys.symbol.chat_bubble'),
          onClick: (): void => { /* 评论 */ }
        }),
        new ActionBarButton({
          baseIcon: $r('sys.symbol.bookmark'),
          onClick: (): void => { /* 收藏 */ }
        })
      ],
      // 样式字段叫 actionBarStyle,不是 style;传 new ActionBarStyle(...)
      actionBarStyle: new ActionBarStyle({
        height: LengthMetrics.vp(56),
        backgroundBlurStyle: BlurStyle.COMPONENT_REGULAR
      })
    })
  }

  @Builder
  LegacyPageBuilder() { /* 原 Column + Row 自定义实现保留 */ }
}
```

### 重构替换的操作顺序(固定流程)

1. **加开关**:全局 `const USE_HDS_COMPONENTS = true`,`build()` 里分支走不同 `@Builder`,保留原实现。
2. **识别结构**:对照上面的"识别要点"表,把顶部自定义 Row 判成 `HdsNavigation`,底部自定义 Row 判成 `HdsActionBar`。
3. **搬样式,不搬代码**:不是把原自定义 `Row`、`.shadow()`、`.backgroundColor()` 搬进 HDS 组件 —— 而是把原来的"意图"(有顶栏、有标题、有底部操作按钮)翻译成 HDS 的配置字段。
4. **默认配置 6.1 新特性**:`scrollEffectOpts` + `originalStyle`/`scrollEffectStyle` 双样式默认都配上,理由见 §3.2。材质类(`systemMaterialEffect` / `hdsMaterial.*`)为内部 API,**不要**配(见 §0)。
5. **跑通后再删原实现**:先保留开关 A/B 验证几轮,稳定后再移除 Legacy 分支。

---

## §7. 反向引用清单 —— 配合哪些 Reference 一起读

| 场景 | 先读 | 再读 |
|------|------|------|
| 从原生 `Tabs` 平替为 `HdsTabs` | 本文 §2 + §3.1 + §5 | [HdsTabs.md](../HdsTabs.md) |
| 自定义顶栏重构为 `HdsNavigation` | 本文 §6 | [HdsNavigation.md](../HdsNavigation.md) + [HdsNavDestination.md](../HdsNavDestination.md) |
| 自定义底栏重构为 `HdsActionBar` | 本文 §6 | [HdsActionBar.md](../HdsActionBar.md) |
| 组合使用多个 HDS 组件 | 本文 §3 | 对应的 `HdsXxx.md` |
| 用户提到 `HdsToolBar` / 材质 / `hdsMaterial` | —— | **不生成对应代码**(见 §0):回复"该 API 尚未对外开放,本 Skill 不输出" |

## 迁移纪律速记(5 条)

1. **只改主组件**:`Tabs` → `HdsTabs`、控制器跟改,`TabContent` / `BottomTabBarStyle` 等**永远保持原名**。
2. **导入要跟上**:`HdsXxx` + `HdsXxxController` + `DividerMode` + `ScrollEffectType` 视需求一起 `import`;**不要**导入 `hdsMaterial`(§0)。
3. **6.1 三件套 / 双样式默认配**:`barOverlap` + `divider(FOLLOW_SCROLL)` + `barFloatingStyle`(HdsTabs),或 `scrollEffectOpts` + `originalStyle`/`scrollEffectStyle` 双样式(HdsNavigation)是标配,别指望用户自己翻文档。
4. **重构用开关**:迁移期保留 `USE_HDS_COMPONENTS` 开关,先 A/B,再收敛。
5. **官方网站为准**:与迁移相关但**官方对外文档里没有记录**的 API(例如 `systemMaterialEffect` / `hdsMaterial.*` / `HdsToolBar`),本文**不做补全**,原样拒绝输出(见 §0)。
