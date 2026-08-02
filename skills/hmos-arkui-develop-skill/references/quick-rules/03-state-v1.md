## 3. 状态管理 V1 装饰器约束

### @State
- 观察能力：仅能观察到**第一层**的变化（赋值、数组项增删、Map/Set API 调用）
- 嵌套对象的**深层属性变化**无法被观察到，需配合 @Observed/@ObjectLink
- @State 装饰对象的**嵌套数组属性**（如 `project.tasks`）做 `push/splice` 增删项观测不到（数组引用未变、非第一层赋值）；需数组为 `@Observed class extends Array` 且有子组件 `@ObjectLink` 接收该数组实例本身，二者缺一不可
- **聚合值**（如已完成数、总进度）无法自动观测子项属性变化，须通过回调手动 recompute
- 不支持 undefined、null 类型

### @Prop
- **单向同步**，本地修改会被父组件更新覆盖
- 允许本地初始化，也可被外部初始化
- @Prop 装饰的变量在本地**拷贝了数据源**

### @Link
- **必须被外部初始化**，**禁止本地初始化**
- 与数据源**双向同步**
- 只能被 V1 状态变量初始化

### @ObjectLink
- **禁止本地初始化**，必须从父组件传入
- **禁止整体赋值**（`this.objLink = ...`），只允许修改属性（`this.objLink.a = ...`）
- API version 19 前：类型**必须**为被 @Observed 装饰的 class 实例
- API version 19+：可接收复杂类型，但嵌套类型观察仍需 @Observed
- **不支持简单类型**（number, string, boolean），如需使用简单类型请用 @Prop

### @Observed
- 用于装饰 class
- 嵌套场景下，**非简单类型的属性也需要被 @Observed 装饰**，否则观察不到变化

### @Provide / @Consume
- @Consume **不可以被外部初始化**
- @Provide 可被外部初始化，也可本地初始化

### @StorageLink / @StorageProp / @LocalStorageLink / @LocalStorageProp
- **不可以被外部初始化**，与 AppStorage / LocalStorage 自动绑定

### @Watch
- 严格禁止在 @Watch 回调中修改**自身被监视的变量**，否则会导致无限循环

### @Builder
- **禁止在 @Builder 内部定义状态变量**或使用生命周期函数
- 参数类型**不允许** undefined、null 和返回 undefined、null 的表达式
- **按值传递（默认）状态变量不触发刷新**：`builder(this.label)` 中 label 变化时 Builder 内 UI 不刷新
- **按引用传递需"单参数 + 对象字面量"才刷新**：`builder({ paramA1: this.label })`；多层嵌套时参数名约定用 `$$`，但 `$$` 不是语法关键字
- **形参类型必须是已声明的 class/interface**：禁止 `$$: { x: T }` 内联对象字面量类型，触发 **10605040**（arkts-no-obj-literals-as-types）；先 `interface P { x: T }` 再 `$$: P`。调用处传字面量 `{ x: this.v }` 合法（目标类型已知）
- **两个及以上参数不触发刷新**：多参数、按值与按引用混用均不刷新，需合并为单个对象参数
- **@Builder 内禁止修改入参**：简单类型修改不刷新，对象类型改属性运行时报错（API23 起报 140109）；需在 Builder 内修改时用 `MutableBinding`（API20+）并传 SetterCallback
- **@Builder 内创建自定义组件传整个对象不刷新**：需拆成简单类型属性传入子组件
- **禁止在 UI 语句外调用 @Builder**：赋值给变量/数组后刷新异常，应直接调用或传方法引用
- **禁止在 @Watch 回调内调用 @Builder**：会导致 UI 刷新异常
- 全局 @Builder 函数如果不涉及组件状态变量变化，建议使用全局定义

### @BuilderParam
- 用于占位，允许被外部初始化

### @Extend
- **仅支持全局定义**（不能在组件内部定义）
- **仅当前文件可用**，不支持 export（需要 export 请用 AttributeModifier）
- **不能与 @Styles 混用**

### @Styles
- **不支持参数**
- **不支持业务逻辑语句**
- 仅支持**通用属性**（不支持组件私有属性如 Button 的 fontColor）
- 不支持 export

### @Require
- 含义是必须被外部初始化，与 private 自相矛盾
- **禁止** @Require 和 private 同时装饰 @State/@Prop/@Provide/@BuilderParam/常规成员变量

### @AnimatableExtend
- 装饰的函数参数类型**只允许** number、string、Color 及其联合类型
- 鸿蒙卡片中动画最大时长 **1000ms**

### wrapBuilder
- 类型参数必须与 @Builder 函数签名**严格一致**

## 常见错误

- **省略状态变量类型注解**：ArkUI 装饰器要求每个状态变量必须声明类型
  - ❌ `@State count = 0` → ✅ `@State count: number = 0`
  - ❌ `@State list = []` → ✅ `@State list: Array<string> = []`

---
