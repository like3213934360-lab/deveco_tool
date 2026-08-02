# 状态管理装饰器选型模式

> 本文回答的问题：**「这个场景该用 `@State` 还是 `@Observed`?该用 `@Provide` 还是 `@Provider`?要持久化该用 `AppStorage` 还是 `PersistenceV2`?V1 和 V2 怎么选?」**
>
> 本文以**选型决策为核心**,不复刻每个装饰器的 API 规格。需要完整规格直接查官方文档:
> - V1 系列:[arkts-observed-and-objectlink.md](../../../../docs/zh-cn/application-dev/ui/state-management/arkts-observed-and-objectlink.md)、[arkts-provide-and-consume.md](../../../../docs/zh-cn/application-dev/ui/state-management/arkts-provide-and-consume.md)、[arkts-appstorage.md](../../../../docs/zh-cn/application-dev/quick-start/arkts-appstorage.md)、[arkts-localstorage.md](../../../../docs/zh-cn/application-dev/quick-start/arkts-localstorage.md)
> - V2 系列:[arkts-new-local.md](../../../../docs/zh-cn/application-dev/quick-start/arkts-new-local.md)、[arkts-new-param.md](../../../../docs/zh-cn/application-dev/quick-start/arkts-new-param.md)、[arkts-new-observedV2-and-trace.md](../../../../docs/zh-cn/application-dev/ui/state-management/arkts-new-observedV2-and-trace.md)、[arkts-new-provider-and-consumer.md](../../../../docs/zh-cn/application-dev/ui/state-management/arkts-new-provider-and-consumer.md)、[arkts-new-appstoragev2.md](../../../../docs/zh-cn/application-dev/ui/state-management/arkts-new-appstoragev2.md)、[arkts-new-persistencev2.md](../../../../docs/zh-cn/application-dev/ui/state-management/arkts-new-persistencev2.md)

---

## §0. 先建立地图：V1 / V2 两套生态并存

鸿蒙状态管理现在**两套并存**,装饰器同名不同义,一个组件内**不能混用**。

| 维度 | V1(传统,2022 起) | V2(现代,API 12+) |
|------|-------------------|--------------------|
| 组件声明 | `@Component struct` | `@ComponentV2 struct` |
| 内部状态 | `@State` | `@Local` |
| 父传子 | `@Prop`(单向)、`@Link`(双向) | `@Param`(单向,配 `@Once` 阻断更新) |
| 类属性深度观测 | `@Observed` + `@ObjectLink` | `@ObservedV2` + `@Trace` |
| 跨层级通信 | `@Provide` + `@Consume` | `@Provider` + `@Consumer` |
| 全局状态 | `AppStorage` / `@StorageProp` / `@StorageLink` | `AppStorageV2.connect(...)` |
| 持久化 | `PersistentStorage` | `PersistenceV2.connect/globalConnect(...)` |
| 派生值 | 手动 `get` 方法(受 ArkTS [no-getter](../../SKILL.md) 限制) | `@Computed` |
| 监听变化 | 变量名+`xxx_?:` 变更回调 | `@Monitor` 装饰器 |

### V1 装饰器**不得出现**在 `@ComponentV2` 内(编译报错)

```typescript
@ComponentV2
struct Bad {
  @State count: number = 0      // ❌ @ComponentV2 内用 @State 直接编译失败
}
```

### V2 装饰器**不得出现**在 `@Component` 内(编译报错)

```typescript
@Component
struct Bad {
  @Local count: number = 0      // ❌ @Component 内用 @Local 直接编译失败
  @Provider('x') x: number = 0  // ❌ 同理
}
```

> 这是**[SKILL.md ArkTS 硬约束第 6 条](../../SKILL.md)**:V1/V2 装饰器不得在同一 `struct` 内混用。但**整个项目可以并存**:A 组件写 `@Component` + `@State`,B 组件写 `@ComponentV2` + `@Local`,互相调用没问题(`@Param` 接收 V1 `@State` 传入的值也合法)。

---

## §1. V1 / V2 选型硬决策(最先看)

### 决策表

| 场景 | 建议 | 理由 |
|------|------|------|
| **新项目 / 新组件** | 优先 **V2** | API 12+ 稳定,精度更高(按属性刷新),`@Computed`/`@Monitor` 心智更轻 |
| **已有 V1 项目 / 维护老代码** | **继续 V1**,不要中途切 | 同 struct 内不能混,全量重构成本大 |
| **项目里既有 V1 也有 V2**(正常情况) | **按组件隔离**,不跨界 | 互相传值走 `@Param` / 普通参数,不要试图把 V1 状态"注入"V2 |
| 需要**深度嵌套对象**观测 | V1 用 `@Observed`+`@ObjectLink`(略繁琐),**V2 首选 `@ObservedV2`+`@Trace`**(精确按属性) | V2 `@Trace` 只通知真正用到该属性的组件刷新 |
| 需要**派生值**(全价 = 单价 × 数量) | V1 用普通方法(受 no-getter 限制),**V2 首选 `@Computed`** | `@Computed` 自动追踪依赖,只在依赖变化时重算 |
| 需要**监听某个值变化**做副作用 | V1 用 `propertyName_?:` 钩子,**V2 用 `@Monitor('field')`** | V2 支持多字段、深度路径 |

### 三条硬纪律

1. **一个 `struct` 只能走一条路**。起手写 `@Component` 就从头到尾 V1,写 `@ComponentV2` 就从头到尾 V2
2. **V1/V2 互相传数据**:通过普通参数传递。`@Param` 能接收 V1 组件用 `@State` 传过来的值(本质是普通引用)
3. **`@ObservedV2` + `@Trace` 是例外**:它装饰**类**(不是组件),既能在 V1 组件里 `new` 使用,也能在 V2 组件里用。但 `@Observed` 类**不**能在 V2 组件里用 `@ObjectLink`(`@ObjectLink` 本身是 V1 装饰器)

---

## §2. V1 装饰器速览(每个一句话 + 骨架 + 一个坑)

### `@State` / `@Prop` / `@Link`(已在 [SKILL.md](../../SKILL.md) 覆盖)

**定位**:组件内部状态 / 父传子单向 / 父传子双向。

**最小骨架**:

```typescript
@Component
struct Parent {
  @State count: number = 0

  build() {
    Column() {
      Text('父: ' + this.count)
      Button('+1').onClick((): void => { this.count += 1 })
      ChildOneWay({ value: this.count })          // @Prop 单向
      ChildTwoWay({ value: $count })              // @Link 双向,语法 $字段名
    }
  }
}

@Component
struct ChildOneWay {
  @Prop value: number = 0                         // 父变 → 子变;子内部可改,但不回传
}

@Component
struct ChildTwoWay {
  @Link value: number                             // 父子双向;没有默认值
}
```

**最常见的坑**:`@Link` 不能写默认值(编译报错),`@Prop` 对于对象类型是**浅拷贝**(内部字段变化不回传)。

---

### `@Observed` + `@ObjectLink`:类属性深度观测

**定位**:被 `@State` 的对象,**内部字段变化**默认 V1 观测不到;用 `@Observed` 标类 + `@ObjectLink` 接对象,才能触发刷新。

**最小骨架**:

```typescript
@Observed
class TaskItem {
  title: string = ''
  done: boolean = false

  constructor(title: string) {
    this.title = title
  }
}

@Component
struct TaskList {
  @State tasks: TaskItem[] = [new TaskItem('买菜')]

  build() {
    Column() {
      ForEach(this.tasks, (task: TaskItem) => {
        TaskRow({ task: task })
      }, (task: TaskItem): string => task.title)
    }
  }
}

@Component
struct TaskRow {
  @ObjectLink task: TaskItem           // ← 必须用 @ObjectLink,不能用 @Prop/@Link

  build() {
    Row() {
      Checkbox().select(this.task.done)
        .onChange((v: boolean): void => { this.task.done = v })       // 直接改字段触发刷新
      Text(this.task.title)
    }
  }
}
```

**最常见的坑**:**继承自 `@Observed` 的子类必须也 `@Observed`**,否则深度观测失效。

---

### `@Provide` + `@Consume`:跨层级通信

**定位**:祖先提供 / 后代消费,中间层不用层层传。一个 key 对应一份数据。

**最小骨架**:

```typescript
@Entry
@Component
struct App {
  @Provide('theme') theme: string = 'light'      // key = 'theme'

  build() {
    Column() {
      MiddleLayer()       // 中间层不用参与,直接穿透
    }
  }
}

@Component
struct MiddleLayer {
  build() {
    DeepLeaf()
  }
}

@Component
struct DeepLeaf {
  @Consume('theme') theme: string                // 后代直接接

  build() {
    Text('当前主题: ' + this.theme)
  }
}
```

**最常见的坑**:

- `@Consume` **没设默认值**且找不到对应 `@Provide` → **运行时抛异常**(API 20 起可设默认值)
- key 不一致 → 后代拿到的是本地默认值或报错;**建议用字符串常量统一 key**

---

### `AppStorage` / `@StorageProp` / `@StorageLink`:全局状态

**定位**:整个**应用级别**共享的 key-value,进程内不跨组件层级限制。

**最小骨架**:

```typescript
// 应用启动时写入(入口文件或 EntryAbility)
AppStorage.setOrCreate<string>('userName', 'Alice')

@Component
struct Header {
  @StorageLink('userName') userName: string = ''       // 双向:两边都能改

  build() {
    Text('Hi, ' + this.userName)
  }
}

@Component
struct ReadOnlyHeader {
  @StorageProp('userName') userName: string = ''       // 单向:AppStorage 变 → 组件变;组件内改不回传
}
```

**最常见的坑**:

- **默认值只是 fallback**,真实值以 AppStorage 已有值为准。初始化时机决定行为
- key 拼写错不会报错,**静默返回默认值**
- 进程销毁(应用被杀)后数据消失。**要跨启动留存必须配合 `PersistentStorage.persistProp(...)`**

---

### `LocalStorage` / `@LocalStorageProp` / `@LocalStorageLink`:页面级状态

**定位**:作用范围限定到**单个 UIAbility 实例或单个页面**,不跨应用。比 AppStorage 更克制。

**骨架与 AppStorage 类似**,但创建时显式绑定一个 `LocalStorage` 实例:

```typescript
let storage: LocalStorage = new LocalStorage({ 'count': 0 })

@Entry(storage)
@Component
struct Page {
  @LocalStorageLink('count') count: number = 0     // 绑上面声明的 storage
  // ...
}
```

**最常见的坑**:`@Entry(storage)` 的 `storage` 参数**必须是模块级变量或通过入口 Ability 传入**,直接 inline `new LocalStorage()` 每次 build 都会重建。

---

## §3. V2 装饰器速览(每个一句话 + 骨架 + 一个坑)

### `@ComponentV2` + `@Local` + `@Param` + `@Once`:新组件套件

**定位**:`@ComponentV2` 宣告组件走 V2;内部状态 `@Local`,外部传入 `@Param`,`@Param` 默认能随父变化刷新,加 `@Once` 则只初始化一次之后父变化不更新。

**最小骨架**:

```typescript
@Entry
@ComponentV2
struct ParentV2 {
  @Local count: number = 0

  build() {
    Column() {
      Text('父: ' + this.count)
      Button('+1').onClick((): void => { this.count += 1 })
      ChildFollow({ value: this.count })            // 父变 → 子变(@Param 默认)
      ChildFrozen({ value: this.count })            // @Once 阻断后续更新
    }
  }
}

@ComponentV2
struct ChildFollow {
  @Param value: number = 0                          // 默认:父变子变,子内不能改(只读)

  build() {
    Text('跟随父: ' + this.value)
  }
}

@ComponentV2
struct ChildFrozen {
  @Param @Once value: number = 0                    // 只在初始化拿一次,后续父变不更新

  build() {
    Text('冻结在首次值: ' + this.value)
  }
}
```

**最常见的坑**:

- `@Local` **必须本地初始化**,不能从父组件传入(这是它和 `@State` 的关键差别)
- `@Param` **是只读的**,在组件内 `this.value = x` 编译报错;要改就要在父组件改,或用 `@Event` 回调通知父
- `@Once` 只装饰 `@Param`,单独用没意义

---

### `@ObservedV2` + `@Trace`:V2 的类属性深度观测

**定位**:V2 版的 `@Observed`+`@ObjectLink`。关键差别:**按属性级刷新**,只刷新真正读了该属性的组件,精度比 V1 高得多。

**最小骨架**:

```typescript
@ObservedV2
class Order {
  @Trace amount: number = 0           // 只有这个属性变化会触发用到它的 UI 刷新
  @Trace status: string = 'pending'
  internal: string = 'x'              // 不加 @Trace → 即使变化也不触发刷新
}

@ComponentV2
struct OrderView {
  @Local order: Order = new Order()   // 或从外部 @Param 接进来

  build() {
    Column() {
      Text('金额: ' + this.order.amount)      // amount 变会刷这个 Text
      Text('状态: ' + this.order.status)      // status 变会刷这个 Text
      Button('+10').onClick((): void => { this.order.amount += 10 })
    }
  }
}
```

**最常见的坑**:

- **`@ObservedV2` 和 `@Trace` 必须成对用**。单独 `@ObservedV2` 无刷新效果;单独 `@Trace`(不加类装饰器)也无效
- **类必须 `new` 出来实例化才有观测能力**,直接用 `{ }` 对象字面量无效
- `@Trace` 不支持 `Function` 类型(官方明确)

---

### `@Provider` + `@Consumer`:V2 的跨层级通信

**定位**:V2 版的 `@Provide`+`@Consume`,**仅能在 `@ComponentV2` 内用**,跨 V1 组件**会编译报错**。

**最小骨架**:

```typescript
@Entry
@ComponentV2
struct AppV2 {
  @Provider('theme') theme: string = 'light'

  build() {
    Column() {
      MiddleV2()
    }
  }
}

@ComponentV2
struct MiddleV2 {
  build() { DeepV2() }
}

@ComponentV2
struct DeepV2 {
  @Consumer('theme') theme: string = 'dark'       // ← V2 的 @Consumer **必须本地初始化**,这是和 V1 @Consume 的关键差别

  build() {
    Text(this.theme)
  }
}
```

**和 V1 的关键差别**:

| 能力 | V1 `@Provide`/`@Consume` | V2 `@Provider`/`@Consumer` |
|------|------|------|
| `@Consume(r)` 本地初始化 | **禁止**(API 20 起可设默认值) | **必须**本地初始化,找不到时用本地默认值 |
| 找不到对应 provider | 抛异常(V1)/用默认值(V1 API 20+) | **用本地默认值**,不抛异常 |
| 组件类型限制 | 在 `@Component` 里 | **只能**在 `@ComponentV2` 里 |

**最常见的坑**:在 `@ComponentV2` 里误写 `@Provide`/`@Consume` → 直接编译错(因为装饰器名字拼错了)。

---

### `AppStorageV2` / `PersistenceV2`:V2 存储

**定位**:V2 的全局状态(AppStorageV2)和持久化(PersistenceV2)。**API 形态大改**,不再是 `@StorageLink` 绑 key,而是 `AppStorageV2.connect()` 返回绑定对象。

**AppStorageV2 骨架**:

```typescript
import { AppStorageV2 } from '@kit.ArkUI'

@ObservedV2
class UserSession {
  @Trace userName: string = ''
  @Trace loggedIn: boolean = false
}

@Entry
@ComponentV2
struct Header {
  @Local session: UserSession = AppStorageV2.connect<UserSession>(
    UserSession,                                // 类型构造器做 key
    (): UserSession => new UserSession()        // 第一次连接时的初始化器
  )!

  build() {
    Text(this.session.loggedIn ? ('Hi, ' + this.session.userName) : '未登录')
  }
}

@ComponentV2
struct LoginButton {
  // 不同组件 connect 同一个 UserSession 类,拿到的是同一个对象实例,实现全局同步
  @Local session: UserSession = AppStorageV2.connect<UserSession>(
    UserSession, (): UserSession => new UserSession())!

  build() {
    Button('登录').onClick((): void => {
      this.session.userName = 'Alice'
      this.session.loggedIn = true
    })
  }
}

// 登出时清掉
AppStorageV2.remove<UserSession>(UserSession)
```

**API 清单**(AppStorageV2 静态方法,来自 [官方原文](../../../../docs/zh-cn/application-dev/ui/state-management/arkts-new-appstoragev2.md)):

| 方法 | 签名 | 用途 |
|------|------|------|
| `connect` | `connect<T>(type: TypeCtor, defaultCreator: () => T): T \| undefined` | 按类型订阅 / 初始化 |
| `connect` | `connect<T>(type: TypeCtor, keyOrCreator: string, defaultCreator: () => T): T \| undefined` | 按类型 + 别名订阅 |
| `remove` | `remove<T>(type: TypeCtor \| string)` | 清除 |
| `keys` | `keys(): Array<string>` | 列所有 key |

**最常见的坑**:

- `connect` 返回 `T | undefined`,末尾 `!` 断言非空;如果类型定义错会 undefined,**必须 catch**或保证 defaultCreator 有效
- **被 connect 的类必须 `@ObservedV2` + 字段 `@Trace`**,否则字段变化不刷新
- `remove` 用**类型构造器**,不是字符串 key

---

**PersistenceV2 骨架**:

```typescript
import { PersistenceV2, Type } from '@kit.ArkUI'

@ObservedV2
class Settings {
  @Trace darkMode: boolean = false
  @Trace fontSize: number = 14
}

PersistenceV2.notifyOnError((key: string, reason: string, msg: string): void => {
  console.error(`持久化失败 key=${key} reason=${reason} msg=${msg}`)
})

@Entry
@ComponentV2
struct SettingsPage {
  @Local settings: Settings = PersistenceV2.connect<Settings>(
    Settings,
    (): Settings => new Settings()
  )!

  build() {
    Column() {
      Toggle({ type: ToggleType.Switch, isOn: this.settings.darkMode })
        .onChange((v: boolean): void => {
          this.settings.darkMode = v             // 直接改字段,会自动持久化
        })
    }
  }
}
```

**globalConnect(API 23+)用于 `collections.Array`/`Map`/`Set`**:

```typescript
@ComponentV2
struct FavList {
  @Local favs: Array<string> = PersistenceV2.globalConnect<Array<string>>({
    type: Type.from<Array<string>>(),
    key: 'favorites',
    defaultCreator: (): Array<string> => []
  })!
}
```

**最常见的坑**:

- `Array` / `Map` / `Set` **本身不可观测**,要用 `globalConnect` + `UIUtils.makeObserved(arr)` 包一层,或者手动 `PersistenceV2.save(key)` 强制持久化
- `notifyOnError` 是**全局一次注册**,不是每个类一个;建议在 Ability 启动时就注册
- 存大对象会卡启动;**只存用户配置 / 登录 token / 小体积偏好**,不要存列表数据

---

### `@Monitor` / `@Computed`(V2 独有,解 V1 痛点)

**`@Monitor('field')`:监听变化做副作用**

```typescript
@ComponentV2
struct Page {
  @Local count: number = 0

  @Monitor('count')
  onCountChange(monitor: IMonitor): void {
    const change = monitor.value()
    if (change !== undefined) {
      console.info(`count: ${change.before} -> ${change.now}`)
    }
  }
}
```

**`@Computed`:派生值,依赖变化自动重算**

```typescript
@ObservedV2
class Cart {
  @Trace price: number = 0
  @Trace quantity: number = 0

  @Computed
  get total(): number {
    return this.price * this.quantity      // ← 这里的 get 是 @Computed 专用,V2 放行
  }
}

@ComponentV2
struct CartView {
  @Local cart: Cart = new Cart()

  build() {
    Text('总价: ' + this.cart.total)       // total 会自动随 price/quantity 变化刷新
  }
}
```

> ⚠️ **`@Computed` 是 [SKILL.md no-getter 硬约束](../../SKILL.md) 的唯一豁免**。普通 `get xxx()` 仍然禁用;**只有 `@Computed get xxx()` 才放行**。V1 组件里完全不能用 `get`。

---

## §4. 选型决策树(核心章)

给定一个场景,从上往下看第一条匹配就是答案。

### 场景 A:组件内部私有状态(不给外面用)

```
→ V1:@State
→ V2:@Local
```

### 场景 B:父组件传值给子组件,子**只读**使用

```
→ V1:@Prop
→ V2:@Param
```

### 场景 C:父组件传值给子组件,子能**回传修改**(双向)

```
→ V1:@Link(父侧 $field 语法)
→ V2:不存在"子直接双向改"。用 @Param 接值 + @Event 回调给父
       父侧:@Local x + 写一个回调函数 (v:T)=>void 传给子
       子侧:@Param x + @Event onChange 声明事件,调用时通知父改
```

### 场景 D:对象类型的状态,**内部字段变化**要触发 UI 刷新

```
→ V1:@Observed class + @ObjectLink 接(子组件)
       父侧:@State obj: MyClass
       子侧:@ObjectLink obj: MyClass
→ V2:@ObservedV2 class + 属性 @Trace
       任意组件直接用属性,按属性级刷新
```

### 场景 E:数组 / Map / Set 里的**元素对象**变化

```
→ V1:元素类必须 @Observed,ForEach/LazyForEach 里给子组件 @ObjectLink
→ V2:元素类 @ObservedV2 + @Trace 字段,数组整体 @Local 即可
     (如果数组元素为基础类型变化,直接 @Local arr 就够,V2 能观察 push/splice)
```

### 场景 F:跨组件层级(父 → 孙 → 曾孙)共享数据,中间层不想层层传

```
→ V1:@Provide('key') / @Consume('key')
→ V2:@Provider('key') / @Consumer('key'),后者必须本地初始化
     (V2 唯一受限:两端都必须 @ComponentV2)
```

### 场景 G:应用级全局状态(登录态 / 主题 / 多 Tab 页共享)

```
→ V1:AppStorage + @StorageLink('key')
→ V2:AppStorageV2.connect<T>(TypeCtor, () => new T())
     (被连接的类必须 @ObservedV2 + @Trace)
→ 选型提示:新项目优先 V2(类型安全,更易调试)
```

### 场景 H:页面级状态(仅当前页面内多个子组件共享,不想泄露到全局)

```
→ V1:LocalStorage 实例 + @Entry(storage) + @LocalStorageLink
→ V2:@Provider/@Consumer 在 @Entry 组件 @Provider,下面 @Consumer 消费即可
     (V2 不再推荐 LocalStorage V1 方案)
```

### 场景 I:需要持久化(应用重启后数据还在)

```
→ V1:PersistentStorage.persistProp('key', default) + @StorageLink
→ V2:PersistenceV2.connect<T>(TypeCtor, () => new T())
     (类 @ObservedV2 + @Trace;数组用 globalConnect)
```

### 场景 J:派生值(全价 = 单价 × 数量)

```
→ V1:没有原生支持,只能普通方法 getTotal(),在 UI 里调用
       ⚠️ 不能用 get total(),违反 SKILL.md no-getter 硬约束
→ V2:@Computed get total(),自动依赖追踪,按需重算
```

### 场景 K:监听某个字段变化做副作用(埋点 / 请求 / Toast)

```
→ V1:命名钩子:同名后加 _,如 xxx_?: (old:T, new:T) => void
     (只在 @Observed class 内对属性生效,不适合 @State)
→ V2:@Monitor('field') method(monitor: IMonitor): void,更通用
```

---

## §5. 响应式失灵 Top 8 排查(超实用)

### ❌ 症状 1:对象内部字段变了,UI 不刷新

```typescript
// 现象:改了 user.name,Text 不更新
@Component
struct Bad {
  @State user: User = new User()
  build() {
    Text(this.user.name)
    Button('改名').onClick((): void => { this.user.name = 'Alice' })  // ← 不刷新!
  }
}
```

**原因**:`@State` 只观测**整体赋值**,不观测对象内部字段。

**修法(V1)**:

```typescript
@Observed
class User {
  name: string = ''
}

@Component
struct Good {
  @State user: User = new User()
  build() {
    Child({ user: this.user })
  }
}

@Component
struct Child {
  @ObjectLink user: User       // ← 用 @ObjectLink 才能深度观测
  build() {
    Text(this.user.name)
    Button('改名').onClick((): void => { this.user.name = 'Alice' })
  }
}
```

**修法(V2)**:直接 `@ObservedV2` + `@Trace`,不需要拆子组件。

---

### ❌ 症状 2:数组 `arr.push(x)`,UI 不刷新

```typescript
@State items: string[] = []
Button('加').onClick((): void => { this.items.push('x') })      // ← 在 V1 里可能不刷新
```

**原因**:V1 对数组方法的观测有**特定版本**要求,某些 API 版本仅支持整体赋值触发刷新。

**修法**:

```typescript
// V1 兜底:整体替换
this.items = this.items.concat(['x'])

// V2:@Local 数组原生支持 push/splice/pop 观察,直接改没问题
@Local items: string[] = []
this.items.push('x')      // ✅
```

---

### ❌ 症状 3:`@Consume` 运行时抛异常

```typescript
// 现象:后代组件渲染时 app 崩溃,报 "Cannot find @Provide"
@Component
struct Child {
  @Consume('theme') theme: string           // ← 祖先没 @Provide('theme')
}
```

**原因**:V1 `@Consume` 找不到对应 key 的 `@Provide` 就抛异常(API 20 前)。

**修法**:

- API 20+:`@Consume('theme') theme: string = 'light'` 加默认值
- API 20 前:**保证**祖先链上有 `@Provide('theme')`,或改用 V2 `@Consumer`

---

### ❌ 症状 4:同 struct 内用 `@Component` + `@Local`,编译失败

```typescript
@Component                  // V1 组件
struct Bad {
  @Local count: number = 0    // ❌ V2 装饰器
}
```

**修法**:**整个 struct 要么 V1 要么 V2**。把 `@Component` 改 `@ComponentV2`,或把 `@Local` 改 `@State`。

---

### ❌ 症状 5:`@ObservedV2` 单用,属性变化不刷新

```typescript
@ObservedV2
class User {
  name: string = ''         // ← 缺 @Trace
}
```

**修法**:**`@ObservedV2` 和 `@Trace` 必须成对**。需要观察哪个属性,就在哪个属性上加 `@Trace`。

---

### ❌ 症状 6:`@ObjectLink` 接一个**普通** class(没有 `@Observed`)

```typescript
class Task {
  done: boolean = false
}

@Component
struct Row {
  @ObjectLink task: Task      // ❌ Task 不是 @Observed 类
}
```

**修法**:给 `Task` 类加 `@Observed`。

---

### ❌ 症状 7:`@Computed get` 在 V1 组件里用

```typescript
@Component
struct CartView {
  @State price: number = 0

  @Computed                  // ❌ V2 装饰器,V1 组件里用不了
  get total(): number { return this.price * 2 }
}
```

**修法**:要么改 `@ComponentV2`,要么把 `get total` 去掉,改成普通方法 `getTotal(): number`(但调用方式变 `this.getTotal()`)。

---

### ❌ 症状 8:AppStorage / V2 key 拼错,拿到的是默认值,无声失效

```typescript
AppStorage.setOrCreate<string>('userName', 'Alice')

@StorageLink('userNaem') userName: string = ''        // ← 拼错 key
// 实际拿到的是 '',不抛异常,排查很难
```

**修法**:**用字符串常量统一管理 key**。

```typescript
export const STORAGE_KEY_USER_NAME = 'userName'

@StorageLink(STORAGE_KEY_USER_NAME) userName: string = ''
```

---

## §6. 存储三件套选型(AppStorage / LocalStorage / PersistenceV2)

| 维度 | `AppStorage` / `AppStorageV2` | `LocalStorage`(V1) | `PersistentStorage` / `PersistenceV2` |
|------|------|------|------|
| 作用域 | **进程级**全局,跨组件 / 页面 / UIAbility | **单个实例**,绑 `@Entry(storage)` 或传入 Ability | **进程级** + **硬盘持久化** |
| 进程销毁 | 数据丢失 | 数据丢失 | **保留**,下次启动还在 |
| 典型场景 | 登录态、全局主题、多 Tab 共享 | 单页内部跨组件共享(现代 V2 更推荐 `@Provider`) | 用户偏好、登录 token、小配置 |
| V2 API | `AppStorageV2.connect(T, ...)!` | (V2 不再推荐) | `PersistenceV2.connect(T, ...)!` |
| 常见坑 | key 拼错静默失效 | `@Entry(storage)` 的 storage 必须模块级 | 存大对象卡启动;`collections.Array` 要 `globalConnect` |

### 选型决策

- **要跨组件 / 页面 / UIAbility 共享** → `AppStorage` / `AppStorageV2`
- **只在一个页面内共享** → V2 首选 `@Provider`/`@Consumer`;V1 可以 `LocalStorage`
- **数据要活过进程销毁** → `PersistentStorage`(V1)或 `PersistenceV2`(V2)
- **大列表数据** → 不要用 Storage 存,用数据库(`@ohos.data.relationalStore`)或文件

---

## §7. 反面示例

### ❌ 在 `@ComponentV2` 里用 `@State` / `@Prop` / `@Link`

```typescript
@ComponentV2
struct Bad {
  @State count: number = 0       // 编译错
  @Prop value: number = 0        // 编译错
}

// 正确
@ComponentV2
struct Good {
  @Local count: number = 0
  @Param value: number = 0
}
```

### ❌ 在 `@Component` 里用 `@Local` / `@Param` / `@Provider`

```typescript
@Component
struct Bad {
  @Local count: number = 0       // 编译错
}

// 正确:要么 V1,要么整个切 V2
```

### ❌ V2 里写普通 `get xxx()` 做派生

```typescript
@ComponentV2
struct CartView {
  @Local price: number = 0

  get total(): number {           // ❌ 违反 SKILL.md no-getter,且不会响应式
    return this.price * 2
  }
}

// 正确:用 @Computed(V2 唯一豁免)
@ObservedV2
class Cart {
  @Trace price: number = 0
  @Computed
  get total(): number { return this.price * 2 }
}
```

### ❌ V1 里写 `get xxx()`

```typescript
@Component
struct Bad {
  @State x: number = 0

  get double(): number {          // ❌ 违反 SKILL.md no-getter,V1 无豁免
    return this.x * 2
  }
}

// 正确:普通方法
@Component
struct Good {
  @State x: number = 0

  getDouble(): number {           // 调用时 this.getDouble()
    return this.x * 2
  }
}
```

### ❌ `@Observed` 装饰器忘加

```typescript
class Task { done: boolean = false }     // ❌ 没 @Observed

@Component
struct Row {
  @ObjectLink task: Task
  // 结果:task.done 变化,UI 不刷新
}

// 正确
@Observed
class Task { done: boolean = false }
```

### ❌ `@ObservedV2` 不加 `@Trace`

```typescript
@ObservedV2
class User {
  name: string = ''              // ❌ 没 @Trace
}

// 正确
@ObservedV2
class User {
  @Trace name: string = ''
}
```

### ❌ V1 对 `@Link` 赋默认值

```typescript
@Component
struct Child {
  @Link value: number = 0        // ❌ @Link 禁止默认值
}

// 正确
@Component
struct Child {
  @Link value: number            // 无默认值,必须父侧传入
}
```

### ❌ V2 里试图在子组件改 `@Param`

```typescript
@ComponentV2
struct Child {
  @Param value: number = 0

  changeMe(): void {
    this.value = 999              // ❌ @Param 是只读的,编译错
  }
}

// 正确:用 @Event 回调
@ComponentV2
struct Child {
  @Param value: number = 0
  @Event onValueChange: (v: number) => void = (v: number): void => {}

  changeMe(): void {
    this.onValueChange(999)       // 通知父改
  }
}
```

### ❌ `AppStorage` key 硬编码到处拼

```typescript
// 错误:散布各组件,拼错不会报错
@StorageLink('userName') userName: string = ''
@StorageLink('user_name') userName: string = ''     // 拼错,拿到默认值

// 正确:集中常量
export const STORAGE_KEY_USER_NAME = 'userName'
@StorageLink(STORAGE_KEY_USER_NAME) userName: string = ''
```

### ❌ `PersistenceV2` 存大列表数据

```typescript
// 错误:几千条聊天记录存 PersistenceV2,启动时反序列化卡住
@Local chats: ChatMessage[] = PersistenceV2.globalConnect<ChatMessage[]>({ /* ... */ })!

// 正确:PersistenceV2 只存小配置,业务数据用数据库
```

### ❌ V1 / V2 混用(同一 struct)

```typescript
@Component                      // ❌ V1 开头
struct Bad {
  @State count: number = 0
  @Local xx: number = 0         // ❌ V2 装饰器,编译错
}
```

---

## §8. 速查(必抄骨架)

### V1 套路四段

```typescript
// 1. 内部状态 + 父传子
@Component
struct App {
  @State count: number = 0
  build() { Child({ v: this.count }) }
}
@Component
struct Child { @Prop v: number = 0; build() { Text(this.v + '') } }

// 2. 对象深度观测
@Observed class Task { done: boolean = false }
@Component
struct Row { @ObjectLink task: Task; build() { Text('' + this.task.done) } }

// 3. 跨层级
@Component
struct App { @Provide('theme') theme: string = 'light'; build() { Sub() } }
@Component
struct Sub { @Consume('theme') theme: string = 'light'; build() { Text(this.theme) } }

// 4. 全局
AppStorage.setOrCreate<string>('userName', 'Alice')
@Component
struct H { @StorageLink('userName') u: string = ''; build() { Text(this.u) } }
```

### V2 套路四段

```typescript
import { AppStorageV2, PersistenceV2 } from '@kit.ArkUI'

// 1. 内部状态 + 父传子
@ComponentV2
struct App {
  @Local count: number = 0
  build() { Child({ v: this.count }) }
}
@ComponentV2
struct Child { @Param v: number = 0; build() { Text(this.v + '') } }

// 2. 对象深度观测(V1 的 @Observed/@ObjectLink 的 V2 版)
@ObservedV2 class Task { @Trace done: boolean = false }
@ComponentV2
struct Row {
  @Local task: Task = new Task()
  build() { Text('' + this.task.done) }
}

// 3. 跨层级(V2 的 @Consumer 必须本地初始化)
@ComponentV2
struct AppV2 { @Provider('theme') theme: string = 'light'; build() { SubV2() } }
@ComponentV2
struct SubV2 { @Consumer('theme') theme: string = 'dark'; build() { Text(this.theme) } }

// 4. 全局 / 持久化
@ObservedV2
class UserSession {
  @Trace userName: string = ''
  @Trace loggedIn: boolean = false
}
@ComponentV2
struct Header {
  @Local session: UserSession = AppStorageV2.connect<UserSession>(
    UserSession, (): UserSession => new UserSession())!
  build() { Text(this.session.userName) }
}

// 派生值(V2 专属)
@ObservedV2
class Cart {
  @Trace price: number = 0
  @Trace quantity: number = 0
  @Computed get total(): number { return this.price * this.quantity }
}
```

### 决策树一句话总结

```
内部状态  →  V1:@State   / V2:@Local
父传子    →  V1:@Prop(只读)/@Link(双向) / V2:@Param(只读) + @Event 回调
对象深度  →  V1:@Observed + @ObjectLink / V2:@ObservedV2 + @Trace
跨层级    →  V1:@Provide/@Consume        / V2:@Provider/@Consumer(必须本地初始化)
应用全局  →  V1:AppStorage + @StorageLink / V2:AppStorageV2.connect()
持久化    →  V1:PersistentStorage         / V2:PersistenceV2.connect / globalConnect
派生值    →  V1:普通方法 getXxx()         / V2:@Computed get xxx()(no-getter 唯一豁免)
监听变化  →  V1:属性名_? 钩子             / V2:@Monitor('field')
```

### 九条硬纪律

1. **V1/V2 装饰器不得在同一 `struct` 内混用**(SKILL.md 硬约束 §6)
2. `@Link` 禁止设默认值
3. `@Observed` 的**子类继承时必须也 `@Observed`**,否则深度观测失效
4. `@ObservedV2` 和 `@Trace` **必须成对**,单独用无效
5. `@Param` **只读**,子组件要改值走 `@Event` 回调
6. `@Computed get xxx()` 是 V2 对 SKILL.md no-getter 硬约束的**唯一豁免**;V1 或非 `@Computed` 的 `get` 一律禁用
7. `@Consumer`(V2)**必须本地初始化**,否则找不到 provider 时行为不一致
8. `AppStorage` / `AppStorageV2` 的 key **必须用字符串常量统一管理**,防拼写错误
9. `PersistenceV2` **只存小配置**,大列表数据用数据库 / 文件

### 引用链接

- V1 `@Observed`/`@ObjectLink` → [官方原文](../../../../docs/zh-cn/application-dev/ui/state-management/arkts-observed-and-objectlink.md)
- V1 `@Provide`/`@Consume` → [官方原文](../../../../docs/zh-cn/application-dev/ui/state-management/arkts-provide-and-consume.md)
- V2 `@Local` → [官方原文](../../../../docs/zh-cn/application-dev/quick-start/arkts-new-local.md)
- V2 `@ObservedV2`/`@Trace` → [官方原文](../../../../docs/zh-cn/application-dev/ui/state-management/arkts-new-observedV2-and-trace.md)
- V2 `@Provider`/`@Consumer` → [官方原文](../../../../docs/zh-cn/application-dev/ui/state-management/arkts-new-provider-and-consumer.md)
- `AppStorageV2` → [官方原文](../../../../docs/zh-cn/application-dev/ui/state-management/arkts-new-appstoragev2.md)
- `PersistenceV2` → [官方原文](../../../../docs/zh-cn/application-dev/ui/state-management/arkts-new-persistencev2.md)
- 状态管理概述 → [arkts-state-management-overview](../../../../docs/zh-cn/application-dev/ui/state-management/)
- MVVM V2 范式 → [arkts-mvvm-v2.md](../../../../docs/zh-cn/application-dev/quick-start/arkts-mvvm-v2.md)
