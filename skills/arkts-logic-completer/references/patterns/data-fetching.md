# 数据请求与列表渲染模式

> 本文回答的问题：**「要从后端拉数据,loading / error / empty / 分页 / 下拉刷新 / 防并发 都怎么写才不会生成残废代码?」**
>
> 本文是**跨组件套路**,不是单组件规格。涉及的 `Refresh` / `List` / `TextInput` 等组件的完整规格请直接查对应 Reference。

---

## §0. 什么时候用这套

| 场景 | 建议 |
|------|------|
| 单页固定数据(配置、详情) | 不需要本文。直接 `aboutToAppear` 拉一次就好 |
| 列表 / 流式内容 | **必用本文**的四态模型 + 分页骨架 |
| 带筛选条件的列表 | **必用本文 §6**(防并发),不然切筛选会出串数据 |
| 实时消息 / 长连接 | 本文不够,要再叠 `WebSocket` 或订阅模式 |

---

## §1. 四态模型(核心抽象)

任何"远程拉数据再渲染"的页面,都存在 **5 种运行态**:

| 状态 | 语义 | UI 表现 |
|------|------|--------|
| `Idle` | 初始,未发起请求 | 占位 / 空白 |
| `Loading` | 请求进行中 | 转圈 / 骨架屏 |
| `Success` | 拿到数据且非空 | 渲染列表 |
| `Empty` | 拿到数据但为空 | "暂无内容"占位图 |
| `Error` | 请求失败 | 错误提示 + 重试按钮 |

**用 `enum` 表达这五态**,不要用联合字面量(违反 [SKILL.md §5](../../SKILL.md)):

```typescript
enum DataStatus {
  Idle,
  Loading,
  Success,
  Empty,
  Error
}
```

> **为什么非要 enum?**
>
> ArkTS 不支持 `@State status: 'idle' | 'loading' | ...`(联合字面量),`Record` 作为 `@State` 也有限制。`enum` 是唯一能稳定通过 ArkTS 校验的写法。

---

## §2. 最小骨架(复制即可运行)

```typescript
enum DataStatus {
  Idle,
  Loading,
  Success,
  Empty,
  Error
}

interface FeedItem {
  id: string
  title: string
}

@Entry
@Component
struct FeedPage {
  @State status: DataStatus = DataStatus.Idle
  @State items: FeedItem[] = []
  @State errorMsg: string = ''

  aboutToAppear(): void {
    this.load()
  }

  build() {
    Column() {
      if (this.status === DataStatus.Loading) {
        this.LoadingView()
      } else if (this.status === DataStatus.Error) {
        this.ErrorView()
      } else if (this.status === DataStatus.Empty) {
        this.EmptyView()
      } else if (this.status === DataStatus.Success) {
        this.SuccessView()
      }
    }
    .width('100%').height('100%')
  }

  @Builder
  LoadingView() {
    Column() {
      LoadingProgress().width(48).height(48)
      Text('加载中...').margin({ top: 12 })
    }
    .width('100%').height('100%').justifyContent(FlexAlign.Center)
  }

  @Builder
  ErrorView() {
    Column({ space: 12 }) {
      Text(this.errorMsg).fontColor('#FF3B30')
      Button('重试').onClick((): void => { this.load() })
    }
    .width('100%').height('100%').justifyContent(FlexAlign.Center)
  }

  @Builder
  EmptyView() {
    Column() {
      Text('暂无内容').fontColor('#999')
    }
    .width('100%').height('100%').justifyContent(FlexAlign.Center)
  }

  @Builder
  SuccessView() {
    List({ space: 8 }) {
      ForEach(this.items, (item: FeedItem) => {
        ListItem() {
          Text(item.title).padding(12).width('100%')
        }
      }, (item: FeedItem): string => item.id)
    }
    .width('100%').height('100%')
  }

  private async load(): Promise<void> {
    this.status = DataStatus.Loading
    try {
      const list: FeedItem[] = await this.fetchFeed()
      if (list.length === 0) {
        this.status = DataStatus.Empty
      } else {
        this.items = list
        this.status = DataStatus.Success
      }
    } catch (e) {
      const err = e as Error
      this.errorMsg = err.message.length > 0 ? err.message : '网络错误,请重试'
      this.status = DataStatus.Error
    }
  }

  private async fetchFeed(): Promise<FeedItem[]> {
    // 真实业务用 http.createHttp(),见 §3
    return new Promise<FeedItem[]>((resolve: (v: FeedItem[]) => void): void => {
      setTimeout((): void => { resolve([{ id: '1', title: 'Hello' }]) }, 600)
    })
  }
}
```

**关键纪律**:

1. `@State status: DataStatus = DataStatus.Idle`,**不要**写联合字面量
2. 五态分支用 `if / else if` 一条链,**不要**叠多个 `if`(会互相覆盖)
3. `load()` 一进来先置 `Loading`,再 try/catch 转终态
4. `catch (e)` 里 `e` 默认类型是 `unknown`,**必须** `as Error` 再取 message
5. 所有 `@Builder` 和普通方法都**显式返回类型**(`void` 或具体类型)

---

## §3. HTTP 请求封装

### 基础调用(官方推荐形态)

```typescript
import { http } from '@kit.NetworkKit'

async function httpGetJson(url: string): Promise<Object> {
  const req = http.createHttp()
  try {
    const resp: http.HttpResponse = await req.request(url, {
      method: http.RequestMethod.GET,
      header: { 'Content-Type': 'application/json' } as Record<string, string>,
      readTimeout: 10000,
      connectTimeout: 10000,
      expectDataType: http.HttpDataType.OBJECT
    })
    if (resp.responseCode !== http.ResponseCode.OK) {
      throw new Error('HTTP ' + resp.responseCode)
    }
    return resp.result as Object
  } finally {
    req.destroy()          // ← 必须释放,官方原文明确"否则内存泄漏"
  }
}
```

### 硬纪律(写错一条就出 bug)

1. **`createHttp()` 出来的 `HttpRequest` 必须 `destroy()`**,用 try/finally 兜底
2. **`ohos.permission.INTERNET` 权限**必须在 `module.json5` 声明,否则运行时拒绝
3. **`responseCode` 必须判**,`req.request` 在 4xx/5xx 时**不会**抛异常,它认为"请求发出成功了"
4. **`resp.result` 类型是 `string | Object | ArrayBuffer`**,取前必须 `as` 窄化
5. **URL 包含中文必须 `encodeURL(url)`**

### 类型化封装(推荐在项目里放一个)

```typescript
import { http } from '@kit.NetworkKit'

interface ApiError {
  code: number
  message: string
}

class NetError extends Error {
  code: number

  constructor(code: number, message: string) {
    super(message)
    this.code = code
  }
}

async function apiGet<T>(url: string): Promise<T> {
  const req = http.createHttp()
  try {
    const resp: http.HttpResponse = await req.request(url, {
      method: http.RequestMethod.GET,
      readTimeout: 10000,
      connectTimeout: 10000,
      expectDataType: http.HttpDataType.OBJECT
    })
    if (resp.responseCode !== http.ResponseCode.OK) {
      throw new NetError(resp.responseCode as number, 'HTTP ' + resp.responseCode)
    }
    return resp.result as T
  } finally {
    req.destroy()
  }
}
```

> **为什么不用 `fetch()`?**
>
> HarmonyOS ArkTS **没有全局 `fetch`**。`@ohos.net.http` / `@kit.NetworkKit` 是唯一官方路径。`@kit.RemoteCommunicationKit`(RCP)是另一个更现代的选择,但 API 22+ 才稳定,本文默认用 `http`。

---

## §4. 分页列表(pageNum / pageSize / hasMore 三元组)

### 状态结构

```typescript
@State items: FeedItem[] = []
@State status: DataStatus = DataStatus.Idle
@State isLoadingMore: boolean = false
@State hasMore: boolean = true
private pageNum: number = 1
private readonly pageSize: number = 20
```

`pageNum` / `pageSize` 用**普通成员字段**(不是 `@State`),因为它们不驱动 UI 刷新,只是业务指针。

### 核心 3 函数

```typescript
private async reload(): Promise<void> {
  this.status = DataStatus.Loading
  this.pageNum = 1
  try {
    const list: FeedItem[] = await this.fetchPage(1, this.pageSize)
    this.items = list
    this.hasMore = list.length === this.pageSize
    this.status = list.length === 0 ? DataStatus.Empty : DataStatus.Success
  } catch (e) {
    this.errorMsg = (e as Error).message
    this.status = DataStatus.Error
  }
}

private async loadMore(): Promise<void> {
  if (!this.hasMore || this.isLoadingMore) { return }
  this.isLoadingMore = true
  try {
    const next: FeedItem[] = await this.fetchPage(this.pageNum + 1, this.pageSize)
    this.items = this.items.concat(next)
    this.pageNum += 1
    this.hasMore = next.length === this.pageSize
  } catch (e) {
    // 分页失败一般不打断页面,只 Toast,不切状态
    this.showToast((e as Error).message)
  } finally {
    this.isLoadingMore = false
  }
}

private async fetchPage(page: number, size: number): Promise<FeedItem[]> {
  const url: string = `https://api.example.com/feed?page=${page}&size=${size}`
  return apiGet<FeedItem[]>(url)     // apiGet 来自 §3
}
```

### 触底触发 + 大列表优化

```typescript
List({ space: 8 }) {
  LazyForEach(this.dataSource, (item: FeedItem) => {
    ListItem() {
      Text(item.title).padding(12)
    }
  }, (item: FeedItem): string => item.id)

  if (this.isLoadingMore) {
    ListItem() { LoadingProgress().width(24).height(24) }
  } else if (!this.hasMore && this.items.length > 0) {
    ListItem() { Text('— 没有更多了 —').padding(12).fontColor('#999') }
  }
}
.onReachEnd((): void => {
  this.loadMore()
})
```

> **列表超过 ~50 条务必用 `LazyForEach`**,`ForEach` 会一次性全量渲染,大列表卡顿肉眼可见。`LazyForEach` 需要实现 `IDataSource`,完整套路见 [docs/zh-cn .../lazyforeach](../../../../docs/zh-cn/application-dev/reference/apis-arkui/arkui-ts/ts-rendering-control-lazyforeach.md)。

---

## §5. 下拉刷新(配合 Refresh 组件)

`Refresh` 组件的完整规格见 [references/Refresh.md](../Refresh.md)。在本模式里它只做一件事:**触发 `reload()`**。

```typescript
Refresh({ refreshing: $$this.isRefreshing }) {
  List({ space: 8 }) {
    LazyForEach(this.dataSource, /* ... */)

    if (this.isLoadingMore) {
      ListItem() { LoadingProgress().width(24).height(24) }
    }
  }
  .onReachEnd((): void => { this.loadMore() })
}
.onRefreshing(async (): Promise<void> => {
  try {
    await this.reload()
  } finally {
    this.isRefreshing = false        // ← 硬纪律:必须 finally 兜底
  }
})
```

**下拉刷新 vs 主动 reload**:

| 来源 | 状态变化 | UI 表现 |
|------|---------|--------|
| `aboutToAppear` 首次 | `Idle → Loading → Success/Empty/Error` | 全屏 loading |
| 下拉手势触发 | **不切 `status`,只 `isRefreshing = true`** | 顶部转圈,列表保留 |
| 错误页 "重试" 按钮 | `Error → Loading → ...` | 全屏 loading |

> **关键区别**:下拉刷新**不切** `status` 到 `Loading`,不然会瞬间把已有列表变成全屏转圈,体验很糟。让 `Refresh` 自己的指示器承担 UI 反馈。

---

## §6. 防并发(版本号 / 取消过期响应)

**场景**:有个筛选 Tab,用户快速点击 A → B → C,期望最后渲染 C 的数据。但 A 的请求可能最慢,回来后覆盖了 C 的结果 → **串数据**。

### 方案:自增版本号

```typescript
@State items: FeedItem[] = []
private requestId: number = 0

private async loadBy(filter: string): Promise<void> {
  this.requestId += 1
  const my: number = this.requestId

  try {
    const list: FeedItem[] = await this.fetchByFilter(filter)
    // 只有"我是最新的请求"时才写入状态
    if (my === this.requestId) {
      this.items = list
    }
    // 否则静默丢弃,说明用户已经切到新筛选
  } catch (e) {
    if (my === this.requestId) {
      this.errorMsg = (e as Error).message
    }
  }
}
```

**原理**:每次发起前 `requestId++`,请求回调拿本地捕获的 `my` 跟当前 `this.requestId` 比较,**不相等就丢弃**。简单可靠,不依赖任何取消 API。

### 方案二(高级):主动 destroy 旧请求

```typescript
private currentReq?: http.HttpRequest

private async loadBy(filter: string): Promise<void> {
  this.currentReq?.destroy()               // 取消上一次
  const req = http.createHttp()
  this.currentReq = req
  try {
    const resp: http.HttpResponse = await req.request(`...${filter}`)
    if (this.currentReq === req) {
      this.items = resp.result as FeedItem[]
    }
  } finally {
    if (this.currentReq === req) {
      this.currentReq = undefined
    }
    req.destroy()
  }
}
```

> **推荐用方案一**。方案二的 `destroy()` 对已发出的请求行为取决于系统实现,版本号方案更稳。

---

## §7. 错误兜底三策略

| 策略 | 场景 | 实现 |
|------|------|------|
| **整页错误页 + 重试** | 首次加载失败,整页无数据 | 切 `DataStatus.Error`,渲染 `ErrorView` |
| **Toast 提示 + 保留旧数据** | 分页加载失败 / 下拉刷新失败 | `showToast()`,不切 `status` |
| **内联错误 + 局部重试** | 列表里某条数据子请求失败 | 那条 item 渲染"加载失败,点我重试" |

### Toast 一行范式

```typescript
import { promptAction } from '@kit.ArkUI'

private showToast(msg: string): void {
  promptAction.showToast({ message: msg, duration: 2000 })
}
```

### 错误分类(可选的精细化)

```typescript
function formatError(e: unknown): string {
  const err = e as Error
  const msg: string = err.message
  if (msg.includes('2300006')) { return '无法解析域名,请检查网络' }
  if (msg.includes('2300007')) { return '无法连接服务器,请重试' }
  if (msg.includes('2300028')) { return '请求超时' }
  if (msg.includes('HTTP 401')) { return '登录状态已过期' }
  if (msg.includes('HTTP 5')) { return '服务器繁忙,请稍后' }
  return msg.length > 0 ? msg : '未知错误'
}
```

> 错误码映射表见官方 [errorcode-net-http.md](../../../../docs/zh-cn/application-dev/reference/apis-network-kit/errorcode-net-http.md)。

---

## §8. 反面示例

### ❌ 用联合字面量作为 `@State status`

```typescript
// 错误:ArkTS 编译器会拒绝
@State status: 'idle' | 'loading' | 'success' | 'error' = 'idle'

// 正确:用 enum
enum DataStatus { Idle, Loading, Success, Empty, Error }
@State status: DataStatus = DataStatus.Idle
```

### ❌ 用并列 `if` 渲染分支

```typescript
// 错误:多个 if 都会执行,出现多态并列
Column() {
  if (this.isLoading) { this.LoadingView() }
  if (this.isSuccess) { this.SuccessView() }         // 可能和 Loading 同屏
  if (this.isError) { this.ErrorView() }
}

// 正确:if / else if 串联
Column() {
  if (this.status === DataStatus.Loading) { this.LoadingView() }
  else if (this.status === DataStatus.Error) { this.ErrorView() }
  else if (this.status === DataStatus.Success) { this.SuccessView() }
}
```

### ❌ 忘记 `responseCode` 检查

```typescript
// 错误:4xx/5xx 不会抛异常,会把错误 body 当正常数据用
const resp: http.HttpResponse = await req.request(url)
return resp.result as FeedItem[]              // ← 可能是 {"error": "xxx"}

// 正确
if (resp.responseCode !== http.ResponseCode.OK) {
  throw new Error('HTTP ' + resp.responseCode)
}
return resp.result as FeedItem[]
```

### ❌ 忘记 `req.destroy()`

```typescript
// 错误:内存泄漏
const req = http.createHttp()
const resp = await req.request(url)
return resp.result as FeedItem[]

// 正确:try/finally 兜底
const req = http.createHttp()
try {
  const resp = await req.request(url)
  return resp.result as FeedItem[]
} finally {
  req.destroy()
}
```

### ❌ 下拉刷新把 `status` 切 `Loading`

```typescript
// 错误:下拉瞬间列表变成全屏转圈,体验糟糕
.onRefreshing(async (): Promise<void> => {
  this.status = DataStatus.Loading        // ← 不要
  await this.reload()
  this.isRefreshing = false
})

// 正确:让 Refresh 自己的指示器承担反馈,不切 status
.onRefreshing(async (): Promise<void> => {
  try {
    await this.reload(/* keepItems = true */)
  } finally {
    this.isRefreshing = false
  }
})
```

### ❌ 快速切筛选不防并发

```typescript
// 错误:A/B/C 快速点击,最慢的 A 可能覆盖最后的 C
private async loadBy(filter: string): Promise<void> {
  const list = await this.fetch(filter)
  this.items = list                       // ← 乱序写入
}

// 正确:见 §6 版本号方案
```

### ❌ `catch (e)` 直接 `e.message` 或 `e.code`

```typescript
// 错误:e 默认类型是 unknown,ArkTS 拒绝直接取属性
catch (e) {
  this.errorMsg = e.message                  // ← 编译报错
}

// 正确
catch (e) {
  const err = e as Error
  this.errorMsg = err.message
}
```

### ❌ 大列表用 `ForEach`

```typescript
// 错误:ForEach 一次性全量渲染,数据超过 50 条肉眼可见卡顿
List() {
  ForEach(this.items, (item: FeedItem) => { /* ... */ })
}

// 正确:用 LazyForEach + IDataSource
List() {
  LazyForEach(this.dataSource, (item: FeedItem) => { /* ... */ },
              (item: FeedItem): string => item.id)
}
```

### ❌ 箭头函数缺类型标注

```typescript
// 错误:违反 SKILL.md §3
.onClick(() => { this.load() })

// 正确
.onClick((): void => { this.load() })
```

---

## §9. 速查

### 状态枚举(必抄)

```typescript
enum DataStatus { Idle, Loading, Success, Empty, Error }
```

### HTTP 请求骨架(必抄)

```typescript
import { http } from '@kit.NetworkKit'

async function apiGet<T>(url: string): Promise<T> {
  const req = http.createHttp()
  try {
    const resp: http.HttpResponse = await req.request(url, {
      method: http.RequestMethod.GET,
      readTimeout: 10000,
      connectTimeout: 10000,
      expectDataType: http.HttpDataType.OBJECT
    })
    if (resp.responseCode !== http.ResponseCode.OK) {
      throw new Error('HTTP ' + resp.responseCode)
    }
    return resp.result as T
  } finally {
    req.destroy()
  }
}
```

### 五态 UI 分支决策

```
首次加载/重试 → Idle → Loading → Success / Empty / Error
下拉刷新 → 不切 status,只 $$isRefreshing,失败走 Toast
分页加载 → 不切 status,只 isLoadingMore,失败走 Toast
筛选切换 → 切 Loading,用 requestId 防串数据
```

### 硬纪律 7 条

1. `@State status: DataStatus`(enum),**不用联合字面量**
2. 分支用 `if / else if` 串联,**不用并列 `if`**
3. `http.createHttp()` 必须 `destroy()`,用 try/finally
4. `resp.responseCode` 必须显式判,4xx/5xx 不会自动抛
5. `catch (e)` 必须 `e as Error` 才能取 message
6. 下拉刷新 / 分页加载**不切 `status`**,只用各自 loading 布尔
7. 快速切筛选必上版本号防并发(§6)

### 引用链接

- 下拉刷新容器 → [Refresh.md](../Refresh.md)
- 表单场景的异步校验(同样套路) → [form-validation.md](form-validation.md)
- 错误码映射表 → [errorcode-net-http.md](../../../../docs/zh-cn/application-dev/reference/apis-network-kit/errorcode-net-http.md)
- HTTP API 官方原文 → [js-apis-http.md](../../../../docs/zh-cn/application-dev/reference/apis-network-kit/js-apis-http.md)
