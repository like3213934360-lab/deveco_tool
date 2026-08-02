---
name: arkts-logic-completer
description: >-
  在"设计稿转代码"管线中承担功能逻辑补全环节：接收 UX-DSL 或组件结构，输出包含状态声明、
  事件处理、数据绑定、组件联动和 ArkTS 语法合规的完整可运行代码。
  务必在以下场景使用此 Skill：生成 ArkTS 代码、生成 HarmonyOS 页面、从设计稿/DSL 转 ArkTS 代码、
  编写包含表单、列表、搜索、选择器、弹窗、导航、反馈等 ArkUI 组件的界面、补全组件交互逻辑、
  或任何涉及鸿蒙 UI 开发的代码生成任务——即使用户没有明确要求"补全逻辑"，
  只要生成的是 ArkTS 组件代码，就应当使用此 Skill 确保输出包含可运行的交互逻辑而非纯 UI 外壳，
  同时遵守 ArkTS 语法限制（禁止对象展开、禁止 struct getter、箭头函数必须标注类型等）。
---

# ArkUI 组件功能逻辑补全 Skill

## 核心问题

AI 生成 ArkTS 代码时，通常只输出 UI 结构（组件嵌套和样式），缺少让界面"跑起来"的功能逻辑：
- 没有 `@State` 状态声明，组件无法响应交互
- 没有事件处理（`onChange`/`onClick`），用户操作无反馈
- 没有数据结构定义，列表和表单是空壳
- 组件之间没有联动，页面是一堆孤立的控件

## 使用方式

生成任何 ArkTS 组件代码时，按以下步骤补全逻辑：

0. **识别项目上下文** — 先检查当前项目中是否已有可复用的 Service、工具函数、数据模型、状态管理方案。如果有，生成的逻辑代码应直接调用现有代码并保持风格一致；如果没有，再按 Reference 中的模式新建
1. **识别组件类型** — 确认当前生成的是哪种组件；当前已覆盖 53 个高频组件 Reference（含 10个 HDS 组件）
2. **读取对应参考文档** — 根据下方索引表，读取 references/ 下该组件的详细规格
3. **补全五要素** — 按参考文档中的规格，逐项补全状态声明、事件逻辑、数据结构、组件联动、异常与边界处理
4. **用检查清单自检** — 确保没有遗漏，代码可直接运行

## 五要素检查清单

每个组件生成后，用这个清单自检：

- [ ] **状态声明**：是否用 `@State`/`@Prop`/`@Link` 声明了必要的状态变量？
- [ ] **事件处理**：是否绑定了关键事件（onChange/onClick/onSubmit）并写了处理逻辑？
- [ ] **数据结构**：如果组件需要数据驱动（列表、表单），是否定义了 interface 和初始数据？
- [ ] **组件联动**：组件状态变化是否会影响页面其他部分？如果是，联动逻辑是否实现？
- [ ] **异常与边界**：涉及异步操作的，是否处理了 loading/error/empty 三态？是否有防重复触发（如按钮防连点、请求防并发）？

## 通用原则

- 状态变量用 `@State` 声明，需要父子传递时用 `@Prop`（单向）或 `@Link`（双向）
- 支持 `$$` 双向绑定的属性优先使用 `$$` 语法（API 10+）
- 列表数据用 `ForEach` 渲染，大数据量用 `LazyForEach`
- 事件处理中涉及异步操作（网络请求、存储）要处理 loading 和 error 状态
- 持久化数据使用 `@StorageLink` 或 `PersistentStorage`

## ArkTS 语法限制（必须遵守）

ArkTS 不是完整的 TypeScript，以下语法会导致编译失败或运行时崩溃，生成代码时**必须规避**：

### 1. 禁止对象展开运算符
ArkTS **不允许对对象使用** `{ ...obj, key: value }`；数组展开 `[...arr, x]` 在某些严格模式下也会报错，保险起见统一用循环或 `concat`。
```typescript
// ❌ 编译报错 arkts-no-spread
this.tasks[index] = { ...item, checked: true }
this.tasks = [newTask, ...this.tasks]

// ✅ 逐字段复制或定义辅助函数
const updated: TaskItem = { id: item.id, title: item.title, checked: true }
this.tasks[index] = updated

// ✅ 数组前置插入
this.tasks = [newTask].concat(this.tasks)
```

### 2. struct 中禁止 get 访问器
`@Component struct` 不支持 `get` 关键字。编译不报错，但**运行时返回 undefined 导致崩溃**。
```typescript
// ❌ 运行时 this.checkedCount 为 undefined → TypeError
get checkedCount(): number { return this.tasks.filter(...).length }

// ✅ 改为普通方法，调用时加 ()
getCheckedCount(): number { return this.tasks.filter(...).length }
```

### 3. 箭头函数必须显式标注类型
参数和返回值都**必须写类型**，不允许隐式推断。
```typescript
// ❌ 编译报错：缺少类型标注
this.tasks.filter(t => t.checked)

// ✅ 参数和返回值都标注
this.tasks.filter((t: TaskItem): boolean => t.checked)
```

### 4. 自定义业务数据对象必须对应 interface（对象字面量需类型化）
对应 ArkTS 官方规则 `arkts-no-untyped-obj-literals`：自行构造的业务数据对象字面量（列表项、表单数据、状态模型等）必须匹配一个已声明的 `interface` 或 `class`，不允许无类型的对象字面量。ArkUI 组件构造参数（`Toggle({...})`、`TextInput({...})`）和框架 API 参数（`router.pushUrl({...})`、`.divider({...})`）不受此限制——它们已有框架定义的类型。
```typescript
// ❌ 自定义对象缺少类型声明
const task = { id: '1', title: '示例', checked: false }

// ✅ 匹配已声明的 interface
const task: TaskItem = { id: '1', title: '示例', checked: false }

// ✅ ArkUI 组件 / 框架 API 的 options 对象无需额外声明
Toggle({ type: ToggleType.Switch, isOn: this.isOn })
router.pushUrl({ url: 'pages/Detail', params: { id: item.id } })
```

### 5. @State 不支持联合字面量类型
`@State` 装饰的变量不要用字符串联合类型，改用 `string` + 常量注释。
```typescript
// ❌ 可能编译失败
@State status: 'idle' | 'loading' | 'error' = 'idle'

// ✅ 用 string 类型
@State status: string = 'idle'  // 'idle' | 'loading' | 'error'
```

### 6. API 必须可在官方网站找到（权威性优先级）

生成的 API / 组件名 / 枚举值必须能在**官方网站的对外文档**里直接命中，否则即便"看起来合理"也不能输出。本仓库的权威层级如下（优先级从高到低）：

| 层级 | 位置 | 状态 |
|------|------|------|
| **L1 权威** | [`hds参考文档/中文文档/`](../../hds参考文档/中文文档/) | 抓自官方网站 `developer.huawei.com`，**对外开放，可以生成** |
| **L2 参考** | [`hds参考文档/references/`](../../hds参考文档/references/) / [`组件参考.md`](../../hds参考文档/组件参考.md) | HDS 开发人员内部整理版，**含少量未对外开放 API**，仅作辨析参考 |
| **L3 禁止** | L2 里出现但 L1 里查不到的 API | **不生成**，仅以"辨析"方式警示一句 |

**典型 L3 禁区**（出现在 `references/config-examples.md` 等内部稿里，但官方网站未公开）：
- `systemMaterialEffect: { ... }` 材质效果块
- `hdsMaterial.MaterialType` / `MaterialLevel` / `DarkMode` 枚举
- `HdsToolBar`（顶部悬浮工具栏，与 `HdsActionBar` 不同）
- `HdsEffect` / `HdsDrawable` / `audiowave` / `pointlight` / `symbolRegister` / `MovingPhoto`

详见 [references/patterns/hds-migration.md §0](references/patterns/hds-migration.md#0-api-权威性--为什么本文没有材质效果)。

### 7. V1 / V2 状态管理装饰器不得在同一 `struct` 内混用

ArkTS 状态管理有 V1(传统 `@Component`)和 V2(`@ComponentV2`)两套生态，装饰器同名不同义。**同一个 `struct` 只能走一条路**，交叉使用直接编译失败。

```typescript
// ❌ 错误：@Component 里用 @Local
@Component
struct Bad {
  @Local count: number = 0              // 编译报错
}

// ❌ 错误：@ComponentV2 里用 @State
@ComponentV2
struct Bad {
  @State count: number = 0              // 编译报错
  @Provide('k') k: number = 0           // 编译报错，V2 要用 @Provider
}

// ✅ 正确：整 struct 统一一条路
@ComponentV2
struct Good {
  @Local count: number = 0
  @Param value: number = 0
  @Provider('theme') theme: string = 'light'
}
```

**装饰器映射表**（一个 struct 只能挑一列）：

| 作用 | V1(`@Component`) | V2(`@ComponentV2`) |
|------|------------------|---------------------|
| 内部状态 | `@State` | `@Local` |
| 父传子只读 | `@Prop` | `@Param` |
| 父传子双向 | `@Link` | `@Param` + `@Event` 回调 |
| 对象深度观测 | `@Observed` + `@ObjectLink` | `@ObservedV2` + `@Trace`（类装饰器，可两套通用） |
| 跨层级通信 | `@Provide` + `@Consume` | `@Provider` + `@Consumer` |
| 全局状态 | `AppStorage` + `@StorageLink/@StorageProp` | `AppStorageV2.connect<T>(...)` |
| 持久化 | `PersistentStorage.persistProp` | `PersistenceV2.connect / globalConnect` |
| 派生值 | 普通方法 `getXxx()`（no-getter 约束） | `@Computed get xxx()`（no-getter 唯一豁免） |
| 监听变化 | 属性钩子 `xxx_?:` | `@Monitor('field')` |

**选型决策、响应式失灵排查、存储三件套对比**见 [references/patterns/state-management.md](references/patterns/state-management.md)。

> **建议**：新项目优先 V2（精度更高、`@Computed` 心智更轻）；已有 V1 项目继续 V1，不要中途切换。两个生态可以**按组件隔离**在同一工程里共存，互传数据走 `@Param` 或普通参数。

## 常见页面级调用链

当生成的是一个完整页面（而非单个组件）时，先识别页面模式，按调用链骨架组织跨组件逻辑，再逐组件加载 Reference 补细节：

| 页面模式 | 涉及组件 | 调用链骨架 |
|---------|---------|-----------|
| 登录/注册页 | TextInput + Button | 输入 → 逐字段校验 → 请求API → 成功跳转 / 失败提示 |
| 搜索列表页 | TextInput + List | 输入防抖 → 请求数据 → 更新列表 → 空状态兜底 |
| 搜索筛选页 | Search + Select + SegmentedButton + List | 输入关键字/切换筛选 → 拉取数据 → 更新结果列表 → 空态/重置兜底 |
| 设置页 | Toggle + List | 开关切换 → 持久化存储 → 联动显隐子项 |
| 多选操作页 | Checkbox + List + Button | 勾选 → 更新选中集合 → 计数联动 → 批量操作 → 确认弹窗 |
| 表单提交页 | TextInput + Checkbox + Button | 逐字段校验 → 协议勾选 → 全量校验 → 提交请求 → loading → 结果反馈 |
| 详情页 | Text + Image + Button + List | 页面初始化请求 → loading骨架屏 → 数据填充 → 操作按钮(收藏/分享) |
| Tab 首页 | BottomTab + SubTab + List/Swiper | 切换页签 → 判断是否首次加载 → 拉取对应内容 → 保持页签状态 |
| 弹窗确认流 | Button + Dialog + Toast/SnackBar | 点击操作 → 打开确认弹窗 → 执行请求 → 成功反馈 / 失败提示 |
| Stack 路由页 | Navigation + NavDestination + NavPathStack | 首页 `pushPath(info)` → 子页 `@Consume('pathStack')` 接栈 → 子页 `pop(result)` → 父页在 push 时注册的 `onPop` 回调刷新 |
| Split 分栏页 | Navigation(mode=Auto) + NavDestination | 宽屏自动左栏列表 + 右栏详情;点击列表 `pushPath` 自动渲染到内容区;`onNavigationModeChange` 监听平板↔手机切换 |
| 登录守卫路由 | Navigation + `pathStack.setInterception` | `aboutToAppear` 注册拦截器 → `willShow` 里判断目标页名 + 登录态 → 未登录则 `pop()` + `pushPath('LoginPage')` 改道 |

调用链骨架解决"组件之间怎么串起来"的问题，各组件内部逻辑仍由对应 Reference 文件提供。

### 跨页导航骨架代码（Navigation + NavDestination + NavPathStack）

跨页路由的核心套路是"**一个 @Entry 父壳 + @Provide 路由栈 + navDestination 分派 Builder + 子页 @Consume 拿栈**"。遇到"实现一个多页应用 / 点击列表进详情页 / 带登录拦截的路由"时，先按下面骨架铺好脊椎，再往里填细节。完整示例见 [references/Navigation.md](references/Navigation.md) 和 [references/NavDestination.md](references/NavDestination.md)。

```typescript
import { NavPathStack, NavPathInfo, PopInfo } from '@kit.ArkUI'

@Entry
@Component
struct AppShell {
  @Provide('pathStack') pathStack: NavPathStack = new NavPathStack()
  @State isLoggedIn: boolean = false

  aboutToAppear(): void {
    this.pathStack.setInterception({
      willShow: (
        from: NavDestinationContext | NavBar,
        to: NavDestinationContext | NavBar,
        operation: NavigationOperation,
        isAnimated: boolean
      ): void => {
        if (typeof to !== 'string' && to.pathInfo.name === 'OrderPage' && !this.isLoggedIn) {
          this.pathStack.pop()
          this.pathStack.pushPath({ name: 'LoginPage' } as NavPathInfo)
        }
      }
    })
  }

  build() {
    Navigation(this.pathStack) {
      Column() {
        Button('进入订单').onClick((): void => {
          this.pathStack.pushPathByName('OrderPage', undefined, (popInfo: PopInfo): void => {
            // 子页 pop(result) 时拿到返回值，顺手刷新
            console.info('返回结果: ' + JSON.stringify(popInfo.result))
          })
        })
      }
    }
    .title('首页')
    .mode(NavigationMode.Auto)           // Auto = 宽 ≥ 600vp 自动分栏（平板 / 折叠屏友好）
    .navDestination(this.destinationMap)
  }

  @Builder
  destinationMap(name: string, param: Object) {
    if (name === 'OrderPage') {
      OrderPage()
    } else if (name === 'LoginPage') {
      LoginPage()
    }
  }
}

@Component
struct OrderPage {
  @Consume('pathStack') pathStack: NavPathStack    // 从父 Provide 取，不要自己 new
  @State orderId: number = 0

  build() {
    NavDestination() {
      Column() {
        Text('订单 ' + this.orderId)
        Button('完成订单').onClick((): void => {
          this.pathStack.pop({ done: true })       // 带 result 返回
        })
      }
    }
    .title('订单详情')
    .onReady((context: NavDestinationContext): void => {
      this.orderId = context.pathInfo.param as number   // onReady 是唯一拿 param 的时机
    })
    .onBackPressed((): boolean => {
      // 返回 true 拦截系统返回键（脏检查 / 二次确认）；返 false 放行自动 pop
      return false
    })
  }
}
```

**五条跨页硬纪律**（违反其一都会导致路由行为异常）：

1. **`new NavPathStack()` 只 `@Provide` 一次**，子页用 `@Consume('pathStack')` 接；子页**禁止**自己 `new` 出第二个栈对象
2. **`navDestination` Builder 只能一个根节点**，用 `if / else if` 分派，不要 `switch` 或多根
3. **拿 `pathInfo.param` 必须在 `onReady`**，不要在 `aboutToAppear`（此时 context 还没注入）
4. **`onBackPressed` 返 `boolean`**，且必须标注箭头函数返回类型 `(): boolean =>`
5. **新代码不与 `@ohos.router` 混用**，两个路由栈互不感知，会导致按返回键行为错乱

## 通用 Pattern 索引

单组件 Reference 负责"**一个组件怎么用**",Pattern 文档负责"**多组件怎么组起来完成一个常见任务**"。生成代码时,如果任务命中下列场景,先读 Pattern 文档再读组件 Reference:

| 场景 | 读取 | 核心产出 |
|------|------|---------|
| 列表页 / 远程拉数据 / 下拉刷新 / 分页加载 / 快速切筛选 | [references/patterns/data-fetching.md](references/patterns/data-fetching.md) | 四态模型(`enum DataStatus`)、`@kit.NetworkKit` 请求骨架、`pageNum + hasMore` 分页三元组、版本号防并发 |
| 登录 / 注册 / 下单表单、多字段校验、异步查重 | [references/patterns/form-validation.md](references/patterns/form-validation.md) | `interface FormErrors`(不用 `Record`)、`onBlur` 校验 vs `onChange` 更新、`showError(undefined)`、防抖 + 版本号异步校验 |
| 状态管理选型 / 嵌套对象观测失灵 / 跨层级通信 / 全局 & 持久化 / V1↔V2 并存 | [references/patterns/state-management.md](references/patterns/state-management.md) | V1/V2 双轨选型决策树、`@Observed`/`@ObservedV2` 深度观测对比、`@Provide`/`@Provider` 跨层级、`AppStorageV2`/`PersistenceV2` API、响应式失灵 Top 8 排查、`@Computed` no-getter 唯一豁免 |
| 原生页面改 HDS / 6.1 新特性(动态模糊、双样式、跟手分割线) | [references/patterns/hds-migration.md](references/patterns/hds-migration.md) | L1/L2/L3 API 权威性、HdsTabs vs Tabs 与 HdsNavigation vs Navigation 选型决策、"只改主组件"铁律 |

> **Pattern 文档不走 9 节模板**,内部是"场景 / 骨架 / 陷阱"自由结构。它们**不会**被静态校验器 `references/*.md` 层的 9 节检查覆盖,所以 Pattern 文档内代码示例的 ArkTS 合规性由写作时自觉保证。

## 组件参考索引

生成代码中包含以下组件时，读取对应参考文档获取完整的逻辑规格：

### 基础交互

| 当代码中出现... | 读取 | 你将获得 |
|---------------|------|---------|
| `Button` / 按钮 / 提交 | [references/Button.md](references/Button.md) | 防重复点击、loading 态、表单校验联动、确认对话框 |
| `Checkbox` / 多选 / 勾选 | [references/Checkbox.md](references/Checkbox.md) | 选中状态管理、全选/反选、CheckboxGroup 联动 |
| `CheckboxGroup` / 多选组 | [references/CheckboxGroup.md](references/CheckboxGroup.md) | 批量选择、全选控制、组值同步 |
| `Radio` / 单选 | [references/Radio.md](references/Radio.md) | 单选状态、互斥联动、表单选项绑定 |
| `Rating` / 评分 | [references/Rating.md](references/Rating.md) | 星级评分、只读显示、提交评分逻辑 |
| `Toggle` / 切换开关 | [references/Toggle.md](references/Toggle.md) | 状态绑定、onChange、互斥联动、持久化 |
| `Switch` / Switch 风格开关 | [references/Switch.md](references/Switch.md) | Switch 样式切换、受控状态、设置页交互 |
| `Slider` / 滑动条 | [references/Slider.md](references/Slider.md) | 区间调节、实时反馈、进度同步 |
| `Counter` / 计数器 | [references/Counter.md](references/Counter.md) | 数量增减、边界校验、购物车场景 |

### 文本输入

| 当代码中出现... | 读取 | 你将获得 |
|---------------|------|---------|
| `TextInput` / 输入框 | [references/TextInput.md](references/TextInput.md) | 双向绑定、表单校验、密码模式、提交逻辑 |
| `Search` / 搜索框 | [references/Search.md](references/Search.md) | 关键词绑定、实时搜索、搜索建议、清空重置 |
| `Text` / 文本 | [references/Text.md](references/Text.md) | 富文本展示、溢出处理、状态联动文案 |
| `TextClock` / 文本时钟 | [references/TextClock.md](references/TextClock.md) | 实时时间显示、格式化、时钟刷新 |
| `TextSelection` / 文本选择 | [references/TextSelection.md](references/TextSelection.md) | 选择范围监听、复制交互、编辑器联动 |

### 数据展示

| 当代码中出现... | 读取 | 你将获得 |
|---------------|------|---------|
| `List` / `ListItem` / 列表 | [references/List.md](references/List.md) | ForEach 数据驱动、点击跳转、侧滑删除、空状态 |
| `Refresh` / 下拉刷新容器 | [references/Refresh.md](references/Refresh.md) | `$$refreshing` 双向绑定、`onRefreshing` 回调、`RefreshStatus` 五态、配合 `List.onReachEnd` 上拉加载 |
| `Swiper` / 轮播 | [references/Swiper.md](references/Swiper.md) | 自动轮播、索引联动、引导页切换 |
| `Progress` / 进度条 | [references/Progress.md](references/Progress.md) | 下载进度、阶段态切换、加载反馈 |
| `QRCode` / 二维码 | [references/QRCode.md](references/QRCode.md) | 内容生成、分享码/支付码展示、刷新逻辑 |
| `Badge` / 标记 | [references/Badge.md](references/Badge.md) | 未读数、红点提示、列表项徽标 |

### 选择器

| 当代码中出现... | 读取 | 你将获得 |
|---------------|------|---------|
| `Select` / 下拉选择 | [references/Select.md](references/Select.md) | 单选下拉、筛选联动、受控/非受控模式 |
| `Picker` / 选择器 | [references/Picker.md](references/Picker.md) | 日期/文本选择、确认回调、默认值处理 |
| `SegmentedButton` / 分段按钮 | [references/SegmentedButton.md](references/SegmentedButton.md) | 分段切换、单选/多选模式、筛选状态同步 |

### 导航布局

| 当代码中出现... | 读取 | 你将获得 |
|---------------|------|---------|
| `Tabs` / 页签容器 | [references/Tabs.md](references/Tabs.md) | `TabsController.changeIndex`、`$$` 双向绑定 index、`onContentWillChange` 拦截、`preloadItems` 预加载、`BarMode.Fixed/Scrollable` |
| `Navigation` / 应用主导航容器 | [references/Navigation.md](references/Navigation.md) | `NavPathStack` 路由栈、`pushPath`/`pop`/`replacePath`、`setInterception` 拦截、`navDestination(builder)` 分派、`NavigationMode.Stack/Split/Auto` |
| `NavDestination` / 路由子页根容器 | [references/NavDestination.md](references/NavDestination.md) | 生命周期 `onShown`/`onHidden`/`onWillXxx`/`onReady`、`onBackPressed` 返回键拦截、`bindToScrollable` 滚动联动、`NavDestinationMode.STANDARD/DIALOG` |
| `BottomTab` / 底部页签 | [references/BottomTab.md](references/BottomTab.md) | Tab 切换、页面状态保持、底部导航 |
| `SubTab` / 子页签 | [references/SubTab.md](references/SubTab.md) | 内嵌标签切换、局部内容刷新、页签联动 |
| `TitleBar` / 标题栏 | [references/TitleBar.md](references/TitleBar.md) | 页面标题、返回操作、顶部导航行为 |
| `SubHeader` / 子标题栏 | [references/SubHeader.md](references/SubHeader.md) | 分组标题、操作区布局、列表头联动 |
| `Toolbar` / 工具栏 | [references/Toolbar.md](references/Toolbar.md) | 底部工具操作、批量动作入口、状态控制 |
| `ActionBar` / 底部操作栏 | [references/ActionBar.md](references/ActionBar.md) | 主次按钮编排、提交区联动、危险操作隔离 |
| `AlphabetIndexer` / 字母索引条 | [references/AlphabetIndexer.md](references/AlphabetIndexer.md) | 联系人索引、滚动定位、与 List 联动 |

### 弹窗浮层

| 当代码中出现... | 读取 | 你将获得 |
|---------------|------|---------|
| `Dialog` / 对话框 | [references/Dialog.md](references/Dialog.md) | 确认弹窗、自定义弹窗、控制器模式 |
| `Menu` / 菜单 | [references/Menu.md](references/Menu.md) | 右键菜单、长按菜单、选项点击回调 |
| `ModelSheet` / 半模态面板 | [references/ModelSheet.md](references/ModelSheet.md) | `bindSheet`、底部弹出、面板状态控制 |
| `PopupTip` / 气泡提示 | [references/PopupTip.md](references/PopupTip.md) | Popup 弹出、引导提示、锚点联动 |
| `Toast` / 吐司 | [references/Toast.md](references/Toast.md) | `promptAction` 提示、成功失败反馈、轻量通知 |
| `SnackBar` / 操作反馈条 | [references/SnackBar.md](references/SnackBar.md) | 底部反馈、撤销操作、短时消息提示 |

### 其他

| 当代码中出现... | 读取 | 你将获得 |
|---------------|------|---------|
| `Chips` / 标签块 | [references/Chips.md](references/Chips.md) | 单选/多选标签、筛选条件联动 |
| `ScrollBar` / 滚动条 | [references/ScrollBar.md](references/ScrollBar.md) | 自定义滚动指示、滚动位置同步 |
| `PatternLock` / 图案锁 | [references/PatternLock.md](references/PatternLock.md) | 解锁验证、密码设置、错误态处理 |

### HDS 组件（UI Design Kit）

> 本分类的组件都来自 `@kit.UIDesignKit`，在原生 ArkUI 基础上封装了标题栏动态模糊、分割线跟手、半模态等华为设计规范效果。
> 原始华为官方中文文档、迁移摘要和重构案例存放在仓库的资料目录 [hds参考文档/](../../hds参考文档/README.md)，供 Reference 反向引用。
>
> **先读迁移纪律**：若是把**已有页面**升级为 HDS（把原生 Tabs / Navigation 或自定义 Row 顶/底栏换成 HDS 组件），先读 [references/patterns/hds-migration.md](references/patterns/hds-migration.md) —— 里面有 §0 API 权威性原则（为什么不生成材质 / `hdsMaterial`）、"只改主组件"铁律、HdsTabs 三件套和 HdsNavigation 双样式默认配置，避免走到具体 HdsXxx 文档后才发现要返工。

| 当代码中出现... | 读取 | 你将获得 |
|---------------|------|---------|
| `HdsNavigation` / 一级导航容器 | [references/HdsNavigation.md](references/HdsNavigation.md) | NavPathStack 路由、标题栏动态模糊、滚动联动、分栏自适应、菜单 Badge |
| `HdsNavDestination` / 路由子页根容器 | [references/HdsNavDestination.md](references/HdsNavDestination.md) | 页面级 titleBar/toolBar、完整生命周期、bindToScrollable、systemBarStyle、半模态 |
| `HdsTabs` / HDS 底部/侧边 Tab | [references/HdsTabs.md](references/HdsTabs.md) | HdsTabsController + bindScroller、跟手分割线、渐变模糊、半屏居中布局 |
| `HdsActionBar` / 浮层多按钮操作栏 | [references/HdsActionBar.md](references/HdsActionBar.md) | 主按钮展开/收起、isExpand 双向绑定、ActionBarButton 实例、BlurStrategy |
| `HdsSideBar` / 双栏容器 | [references/HdsSideBar.md](references/HdsSideBar.md) | sideBarPanelBuilder + contentPanelBuilder 分栏、Overlay/Embed/Auto、autoHide |
| `HdsSideMenu` / 侧边菜单 | [references/HdsSideMenu.md](references/HdsSideMenu.md) | 一/二级菜单、selectedIndex 双向绑定、Badge 角标、HdsSideMenuMainItem 实例 |
| `HdsSnackBar` / 非模态命令式弹窗 | [references/HdsSnackBar.md](references/HdsSnackBar.md) | `new HdsSnackBar(uiContext).show()`、5 种 operationType、duration=-1 常驻 |
| `HdsListItem` / 横滑列表项 | [references/HdsListItem.md](references/HdsListItem.md) | HdsSwipeActionOptions、fullDelete、LazyForEach + IDataSource |
| `HdsListItemCard` / 规范列表卡片 | [references/HdsListItemCard.md](references/HdsListItemCard.md) | Prefix/Text/Suffix 三区结构、Prefix/Suffix 类实例、customBuilder 优先级 |
| `HdsVisualComponent` / 复杂视效容器 | [references/HdsVisualComponent.md](references/HdsVisualComponent.md) | HdsSceneController 生命周期、scene 参数、双边流光 |
| `MultiWindowEntryInAPP` / 应用内多窗入口 | [references/MultiWindowEntryInAPP.md](references/MultiWindowEntryInAPP.md) | Want 字段约束、设备形态限制、onTouch 替代 onClick |

## 反面示例：典型的"死代码"

```typescript
// ❌ 这是 AI 常见的错误输出 — 纯 UI 外壳，没有任何逻辑
@Entry
@Component
struct SettingsPage {
  build() {
    Column() {
      Row() {
        Text('Wi-Fi')
        Toggle({ type: ToggleType.Switch, isOn: true })  // isOn 写死，没有状态
      }
      Row() {
        Text('蓝牙')
        Toggle({ type: ToggleType.Switch })  // 没有 onChange，点了没反应
      }
      Button('保存')  // 没有 onClick，点了没反应
    }
  }
}
```

```typescript
// ✅ 补全逻辑后的正确输出
@Entry
@Component
struct SettingsPage {
  @State isWifiOn: boolean = false
  @State isBluetoothOn: boolean = false

  build() {
    Column() {
      Row() {
        Text('Wi-Fi')
        Blank()
        Toggle({ type: ToggleType.Switch, isOn: this.isWifiOn })
          .onChange((isOn: boolean): void => {
            this.isWifiOn = isOn
          })
      }

      Row() {
        Text('蓝牙')
        Blank()
        Toggle({ type: ToggleType.Switch, isOn: this.isBluetoothOn })
          .onChange((isOn: boolean): void => {
            this.isBluetoothOn = isOn
          })
      }

      Button('保存')
        .onClick((): void => {
          // 持久化设置
        })
    }
  }
}
```
