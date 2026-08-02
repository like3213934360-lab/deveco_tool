# ArkTS 业务逻辑架构模式参考文档

> 本文件服务于 understanding-modes.md 的**逻辑理解模式**，覆盖 ViewModel/Controller/Manager/FSM/设计模式/依赖管理的识别与分析。

---

## 1. ArkTS 逻辑分层架构

ArkTS 业务逻辑采用多层分离架构：无容器管理的 DI 和事务，逻辑层职责通过装饰器和接口约定划分。

| ArkTS 层 | 职责 | 识别特征 |
|----------|------|----------|
| **ViewModel** | 数据响应(@Observed/@ObjectLink/@Trace)、业务逻辑承载 | `*VM.ets`、`@ObservedV2` |
| **Controller** | 业务逻辑协调、回调分发(emitCallback/onCallback) | `*Controller.ets`、`onCallback` |
| **Manager** | 资源管理、生命周期管理、跨模块协调 | `*Manager.ets`、单例模式 |
| **Helper** | 单一职责工具方法、纯函数 | `*Helper.ets`、无状态 |
| **DataSource** | 数据获取与状态管理(IDataSource接口) | `*DataSource.ets`、`IDataSource` |

```typescript
@ObservedV2
class OrderVM {
  @Trace orderId: string = ''
  @Trace status: OrderStatus = OrderStatus.PENDING
  @Trace items: OrderItem[] = []
  calculateTotal(): number {
    return this.items.reduce((sum, i) => sum + i.price * i.quantity, 0)
  }
}

class OrderController {
  private orderVM: OrderVM = new OrderVM()
  private dataSource: OrderDataSource = new OrderDataSource()
  onSubmit = () => { this.submitOrder() }
  submitOrder(): void {
    const total = this.orderVM.calculateTotal()
    this.dataSource.submit(this.orderVM.orderId, total)
  }
}

class OrderDataSource implements IDataSource {
  private dataList: OrderItem[] = []
  private listeners: DataChangeListener[] = []
  totalCount(): number { return this.dataList.length }
  getData(index: number): OrderItem { return this.dataList[index] }
  addDataChangeListener(l: DataChangeListener): void { this.listeners.push(l) }
  removeDataChangeListener(l: DataChangeListener): void { this.listeners.splice(this.listeners.indexOf(l), 1) }
}
```

---

## 2. 状态机模式 (FSM)

ArkTS 中状态机主要有三种实现方式，用于管理页面/组件的复合状态。

### 位掩码状态机

enum 常量 + 位运算组合多个布尔状态为一个整型值，适合页面多状态并行判断。

```typescript
enum PageState {
  INIT = 1 << 0, NO_DATA = 1 << 1, BROWSE = 1 << 2, SELECT = 1 << 3, EDIT = 1 << 4
}
let state: number = PageState.INIT | PageState.NO_DATA
state = state & ~PageState.NO_DATA | PageState.BROWSE  // 去除NO_DATA, 加入BROWSE
if (state & PageState.SELECT) { /* 选择态处理 */ }
```

### LoadingState 有限状态机

数据加载流程的三态转换，HarmonyOS 最常见的 FSM 模式。

```typescript
enum LoadingState { WAIT_TO_LOAD, LOADING, IDLE }

@ObservedV2
class PageVM {
  @Trace loadingState: LoadingState = LoadingState.WAIT_TO_LOAD
  load(): void {
    this.loadingState = LoadingState.LOADING
    this.dataSource.fetchData(() => { this.loadingState = LoadingState.IDLE })
  }
}
```

### 状态代理聚合

AbstractObserverProxy + 多子状态代理，统一管理复合状态变化。

```typescript
class PageStateProxy {
  private loadingProxy: LoadingStateProxy = new LoadingStateProxy()
  private selectionProxy: SelectionStateProxy = new SelectionStateProxy()
  isReady(): boolean {
    return this.loadingProxy.state === LoadingState.IDLE && !this.selectionProxy.isEmpty
  }
}
```

---

## 3. 观察者模式

ArkTS 观察者模式通过装饰器和接口实现——基于声明式绑定而非中央事件总线。

### @Watch 装饰器 —— 属性变更监听

```typescript
@ObservedV2
class OrderVM {
  @Watch('onQuantityChanged') @Trace quantity: number = 0
  onQuantityChanged(): void { this.totalPrice = this.price * this.quantity }
}
```

### @Provide/@Consume —— 跨层级依赖注入

```typescript
@Component struct ParentPage {
  @Provide orderStatus: string = 'pending'
  build() { Column() { ChildComponent() } }
}
@Component struct ChildComponent {
  @Consume orderStatus: string  // 自动匹配同名@Provide
  build() { Text(this.orderStatus) }
}
```

### DataChangeListener —— IDataSource 数据变更通知

```typescript
class ListDataSource implements IDataSource {
  private listeners: DataChangeListener[] = []
  notifyDataReload(): void { this.listeners.forEach(l => l.onDataReloaded()) }
  notifyDataAdd(index: number): void { this.listeners.forEach(l => l.onDataAdded(index)) }
}
```

### emitCallback/onCallback —— 组件间业务通信

```typescript
@Component struct OrderPage {
  private controller: OrderController = new OrderController()
  build() { Button('提交').onClick(() => this.controller.onSubmit()) }
}
```

---

## 4. 策略模式

ArkTS 策略模式通过 IDataSource 接口多实现 + DataSourceManager 管理器协调。

```typescript
class LocalOrderDataSource implements IDataSource {
  totalCount(): number { return this.localData.length }
  getData(index: number): OrderItem { return this.localData[index] }
}
class RemoteOrderDataSource implements IDataSource {
  totalCount(): number { return this.remoteData.length }
  getData(index: number): OrderItem { return this.remoteData[index] }
}

class DataSourceManager {
  private activeSource: IDataSource
  switchStrategy(source: IDataSource): void { this.activeSource = source }
  getData(index: number): Object { return this.activeSource.getData(index) }
}
```

ArkTS 需手动构造 DataSourceManager 维护策略实例。

---

## 5. 工厂与模板方法模式

### @Builder 函数复用 —— UI 构建模板方法

```typescript
@Builder function OrderItemBuilder(item: OrderItem) {
  Row() { Text(item.name).width('60%'); Text(`¥${item.price}`).width('40%') }
}
@Component struct OrderListPage {
  build() {
    LazyForEach(this.dataSource, (item: OrderItem) => {
      OrderItemBuilder(item)
    }, (item: OrderItem) => item.id.toString())
  }
}
```

### PageLoader + LoaderParams —— 页面加载参数模板

```typescript
class LoaderParams {
  pageName: string = ''; data?: Record<string, Object> = {}; onResult?: (r: Object) => void
}
class PageLoader {
  load(params: LoaderParams): void {
    const targetPage = this.pageFactory(params.pageName)
    targetPage.init(params.data)
  }
}
```

---

## 6. 依赖管理

### 组件间依赖：装饰器体系

| 装饰器 | 方向 | 用途 |
|--------|------|------|
| @State | 组件内部 | 本地状态，驱动UI刷新 |
| @Prop | 父→子(单向) | 父组件传递只读副本 |
| @Link | 父↔子(双向) | 双向数据绑定 |
| @Provide/@Consume | 祖→孙(跨层级) | 跨层级依赖注入 |
| @Watch | 属性→副作用 | 属性变更触发回调 |

### 模块间依赖：import lazy + oh-package.json5

```typescript
import lazy { FeatureModule } from '@app/feature'
// oh-package.json5 声明模块依赖
{ "dependencies": { "@app/common": "^1.0.0", "@app/network": "^2.0.0" } }
```

ArkTS 组件间依赖由装饰器声明式绑定（编译期确定），模块间依赖由 oh-package.json5 显式声明（无运行时DI容器）。

---

## 7. 逻辑架构理解检查清单

- [ ] 识别 ViewModel/Controller/Manager/Helper/DataSource 分层入口
- [ ] 分析业务流程与入口点（build() 回调绑定 -> Controller -> DataSource）
- [ ] 识别 FSM 状态机模式（位掩码 / LoadingState / 状态代理聚合）
- [ ] 识别观察者模式（@Watch / @Provide/@Consume / DataChangeListener / emitCallback）
- [ ] 识别策略模式（IDataSource 多实现 + DataSourceManager 协调）
- [ ] 识别工厂/模板方法模式（@Builder / PageLoader + LoaderParams）
- [ ] 分析组件间依赖（@State/@Prop/@Link/@Provide/@Consume 装饰器体系）
- [ ] 分析模块间依赖（import lazy + oh-package.json5）