# Refresh 组件功能逻辑规格

> 原生 ArkUI 容器组件，无需独立 `import`（全局构造函数）。
> 官方原文：[ts-container-refresh.md](../../../docs/zh-cn/application-dev/reference/apis-arkui/arkui-ts/ts-container-refresh.md)。**下拉刷新 + 上拉加载更多**的标准组合见 [patterns/data-fetching.md](patterns/data-fetching.md)。

## 1. 功能定位

`Refresh` 是**下拉刷新容器**，从 API 8 起支持（API 11+ 为现代形态）。它的主要作用：

- 用 `refreshing: boolean` 作为核心状态,**支持 `$$` 双向绑定**
- 把任何可滚动子组件（`List` / `Scroll` / `Grid` / `WaterFlow`）包起来，下拉超过阈值即触发刷新
- 用 `onRefreshing` 回调发起业务请求，请求完成后把 `refreshing` 改回 `false` 即可收回
- 通过 `refreshingContent`（API 12+ 推荐）/ `builder`（旧）/ `promptText` 三种方式**自定义刷新区域显示内容**

> **边界约定**：本文只讲 `Refresh` 容器自身。"下拉刷新 + 分页加载 + loading/error/empty 四态"的完整组合套路 → 查 [patterns/data-fetching.md](patterns/data-fetching.md)。

## 2. 典型场景

- **资讯流 / 商品列表**：下拉刷新最新数据（最高频场景）
- **消息列表**：下拉拉取新消息
- **编辑器重载**：下拉触发文件重新加载
- **自定义刷新提示**：品牌化定制刷新动画（用 `refreshingContent`）
- **禁用下拉刷新**：某些 Tab 页不需要刷新时 `pullToRefresh(false)`

## 3. 状态声明

```typescript
@Entry
@Component
struct FeedPage {
  @State isRefreshing: boolean = false
  @State items: string[] = []

  build() {
    Refresh({ refreshing: $$this.isRefreshing }) {
      List() {
        ForEach(this.items, (item: string) => {
          ListItem() {
            Text(item).padding(12)
          }
        }, (item: string): string => item)
      }
    }
    .onRefreshing((): void => {
      this.fetchLatest()
    })
  }

  private async fetchLatest(): Promise<void> {
    // 业务请求...
    this.items = ['新消息 1', '新消息 2']
    this.isRefreshing = false
  }
}
```

> - `refreshing` 必须用 `$$` 双向绑定,否则手势完成后组件回不到"未刷新"状态。
> - `@State isRefreshing: boolean`,**不要**写成联合字面量 `'idle' | 'refreshing'`（违反 [SKILL.md §5](../SKILL.md)）。
> - 子组件**必须**是可滚动容器(`List` / `Scroll` / `Grid` / `WaterFlow`),塞普通 `Column` 不会响应下拉手势。
> - `onRefreshing` 是**无参回调**,业务请求完成后自己把 `this.isRefreshing = false` 改回去。

## 4. 事件与交互逻辑

### `onRefreshing`：进入刷新态时触发

```typescript
.onRefreshing((): void => {
  // 发起请求 → 拿到结果 → 把 isRefreshing 改 false
  this.fetchLatest()
})
```

> `onRefreshing` **只在状态进入 `Refresh` 时触发一次**。业务请求结束必须手动把 `this.isRefreshing = false`,否则指示器永远转。

### `onStateChange`：监听 5 个状态转换

```typescript
.onStateChange((state: RefreshStatus): void => {
  // Inactive（0） → Drag（1） → OverDrag（2） → Refresh（3） → Done（4）
  if (state === RefreshStatus.Drag) {
    // 下拉中但未超过阈值
  }
})
```

五个枚举值的转换规则（来自官方 §RefreshStatus）：

- `Inactive(0)` —— 默认未下拉状态
- `Drag(1)` —— 下拉中,距离 **< `refreshOffset`**；松手回 `Inactive`,继续拉过阈值进 `OverDrag`
- `OverDrag(2)` —— 下拉中,距离 **≥ `refreshOffset`**；松手进 `Refresh`,上滑回 `Drag`
- `Refresh(3)` —— 回弹到刷新距离,已触发 `onRefreshing` 回调
- `Done(4)` —— `refreshing = false` 后,指示器回到顶部

### `onOffsetChange`：下拉距离变化（API 12+）

```typescript
.onOffsetChange((offset: number): void => {
  // offset 单位 vp,用来做自定义动画(例如标题栏缩放)
})
```

### 配合可滚动子组件的完整流程

```typescript
Refresh({ refreshing: $$this.isRefreshing }) {
  List({ space: 8 }) {
    ForEach(this.items, (item: Item) => {
      ListItem() { Text(item.title) }
    }, (item: Item): string => item.id)
  }
}
.onRefreshing((): void => { this.reload() })
```

下拉流程:
1. 用户下拉 → 子 `List` 到顶后继续下拉 → 进入 `Drag`
2. 拉过 `refreshOffset`(默认 64vp)→ 进入 `OverDrag`,松手触发刷新
3. `onRefreshing` 回调执行 → 业务请求数据 → `this.isRefreshing = false`
4. 指示器收回 → 状态回到 `Inactive`

## 5. 数据结构 / 关键参数

### 构造参数 `RefreshOptions`

| 字段 | 类型 | 必填 | 场景 |
|------|------|------|------|
| `refreshing` | `boolean`(支持 `$$` 双向绑定) | **是** | 核心状态;**务必用 `$$`** |
| `builder` | `CustomBuilder`(API 10+) | 否 | 自定义刷新区域,**API 12+ 起官方推荐改用 `refreshingContent`**(避免销毁重建导致的动画中断) |
| `promptText` | `ResourceStr`(API 12+) | 否 | 刷新区域底部自定义文本;设置后 `refreshOffset` 默认值从 64vp 变 96vp |
| `refreshingContent` | `ComponentContent`(API 12+) | 否 | 官方推荐的自定义刷新区域;同时设 `builder` 时 `builder` **不生效** |

### 核心属性速览

| 属性 | 类型 | 默认 | 场景 |
|------|------|------|------|
| `refreshOffset` | `number`(vp) | 64 / 96(设了 promptText) | 触发刷新的下拉距离阈值 |
| `pullToRefresh` | `boolean` | `true` | 下拉超过阈值是否触发刷新;设 `false` **完全禁用**下拉刷新 |
| `pullUpToCancelRefresh` | `boolean \| undefined`(API 23+) | `undefined`(= true) | 刷新中上划是否取消 |
| `pullDownRatio` | `Optional<number>` | `undefined`(动态跟手) | 0-1 跟手系数,0 不跟随,1 等比例 |
| `maxPullDownDistance` | `Optional<number>`(API 20+) | `undefined` | 最大下拉距离(vp),**小于 `refreshOffset` 不会触发刷新** |

### 枚举 `RefreshStatus`

| 值 | 名称 | 含义 |
|----|------|------|
| 0 | `Inactive` | 默认 |
| 1 | `Drag` | 下拉中,< 阈值 |
| 2 | `OverDrag` | 下拉中,≥ 阈值 |
| 3 | `Refresh` | 刷新中(触发 `onRefreshing` 后) |
| 4 | `Done` | 刷新结束,回到初始态 |

## 6. 联动说明

### 与 `List` / `Scroll` / `Grid` / `WaterFlow`

`Refresh` 的子组件**必须是可滚动容器**,不能是 `Column` / `Row` / `Stack` —— 下拉手势需要由可滚动容器"到顶"的信号触发。如果直接塞 `Column`,下拉手势会被该 `Column` 的普通滚动吞掉,Refresh 不会进入 `Drag` 状态。

```typescript
// ✅ 推荐
Refresh({ refreshing: $$this.isRefreshing }) {
  List() { /* ... */ }
}

// ✅ 也可以
Refresh({ refreshing: $$this.isRefreshing }) {
  Scroll() {
    Column() { /* 任意内容 */ }
  }
}

// ❌ 不会触发下拉
Refresh({ refreshing: $$this.isRefreshing }) {
  Column() { /* ... */ }      // 不是可滚动容器
}
```

### 与 `List.onReachEnd`(上拉加载更多)

上拉加载不是 `Refresh` 的能力,是 `List` 自己的 `onReachEnd`。典型组合:

```typescript
Refresh({ refreshing: $$this.isRefreshing }) {
  List() {
    ForEach(this.items, /* ... */)
  }
  .onReachEnd((): void => {
    if (!this.hasMore || this.isLoadingMore) { return }
    this.loadMore()
  })
}
.onRefreshing((): void => { this.reload() })
```

完整"下拉刷新 + 上拉加载更多 + 四态"的骨架见 [patterns/data-fetching.md §4-§5](patterns/data-fetching.md)。

### 与业务请求层

`onRefreshing` 自身**不做异步控制**,完全由业务层决定何时把 `isRefreshing` 改回 `false`:

```typescript
.onRefreshing(async (): Promise<void> => {
  try {
    this.items = await this.fetchLatest()
  } catch (err) {
    this.showToast('刷新失败')
  } finally {
    this.isRefreshing = false      // ← 无论成功失败都要改回
  }
})
```

> **⚠️ 忘记改回 `isRefreshing` 是最常见的 bug 源**。推荐用 `try/finally` 兜底。

## 7. 完整代码示例

### 示例 A：最小下拉刷新（默认样式）

```typescript
@Entry
@Component
struct MinimalRefresh {
  @State isRefreshing: boolean = false
  @State items: string[] = ['消息 1', '消息 2', '消息 3']

  build() {
    Refresh({ refreshing: $$this.isRefreshing }) {
      List({ space: 8 }) {
        ForEach(this.items, (item: string) => {
          ListItem() {
            Text(item).padding(12).width('100%')
          }
        }, (item: string): string => item)
      }
      .width('100%')
      .height('100%')
    }
    .onRefreshing((): void => {
      this.reload()
    })
  }

  private reload(): void {
    setTimeout((): void => {
      this.items = ['刷新结果 1', '刷新结果 2', '刷新结果 3']
      this.isRefreshing = false
    }, 1200)
  }
}
```

### 示例 B：自定义刷新文本 + 阈值调整

```typescript
@Entry
@Component
struct RefreshWithText {
  @State isRefreshing: boolean = false
  @State items: string[] = []

  build() {
    Refresh({ refreshing: $$this.isRefreshing, promptText: '松开刷新' }) {
      List() {
        ForEach(this.items, (item: string) => {
          ListItem() { Text(item).padding(12) }
        }, (item: string): string => item)
      }
    }
    .refreshOffset(80)             // 调成 80vp 才触发
    .pullDownRatio(0.6)            // 跟手系数 0.6(更稳重)
    .onRefreshing((): void => {
      this.fetchAndStop()
    })
  }

  private async fetchAndStop(): Promise<void> {
    try {
      this.items = await this.fetchLatest()
    } finally {
      this.isRefreshing = false
    }
  }

  private async fetchLatest(): Promise<string[]> {
    return new Promise<string[]>((resolve: (v: string[]) => void): void => {
      setTimeout((): void => { resolve(['新 1', '新 2']) }, 800)
    })
  }
}
```

### 示例 C：下拉刷新 + 上拉加载更多

```typescript
interface FeedItem {
  id: string
  title: string
}

@Entry
@Component
struct RefreshWithLoadMore {
  @State isRefreshing: boolean = false
  @State isLoadingMore: boolean = false
  @State hasMore: boolean = true
  @State items: FeedItem[] = []
  private pageNum: number = 1
  private readonly pageSize: number = 20

  aboutToAppear(): void {
    this.reload()
  }

  build() {
    Refresh({ refreshing: $$this.isRefreshing }) {
      List({ space: 8 }) {
        ForEach(this.items, (item: FeedItem) => {
          ListItem() {
            Text(item.title).padding(12).width('100%')
          }
        }, (item: FeedItem): string => item.id)

        if (this.isLoadingMore) {
          ListItem() {
            Text('加载中...').padding(12)
          }
        } else if (!this.hasMore) {
          ListItem() {
            Text('— 没有更多了 —').padding(12).fontColor('#999')
          }
        }
      }
      .width('100%')
      .height('100%')
      .onReachEnd((): void => {
        if (this.hasMore && !this.isLoadingMore && !this.isRefreshing) {
          this.loadMore()
        }
      })
    }
    .onRefreshing((): void => {
      this.reload()
    })
  }

  private async reload(): Promise<void> {
    try {
      this.pageNum = 1
      const data: FeedItem[] = await this.fetchPage(this.pageNum, this.pageSize)
      this.items = data
      this.hasMore = data.length === this.pageSize
    } finally {
      this.isRefreshing = false
    }
  }

  private async loadMore(): Promise<void> {
    this.isLoadingMore = true
    try {
      const next: FeedItem[] = await this.fetchPage(this.pageNum + 1, this.pageSize)
      this.items = this.items.concat(next)
      this.pageNum += 1
      this.hasMore = next.length === this.pageSize
    } finally {
      this.isLoadingMore = false
    }
  }

  private async fetchPage(page: number, size: number): Promise<FeedItem[]> {
    // 实际业务换成 http.createHttp() 请求,见 patterns/data-fetching.md
    return new Promise<FeedItem[]>((resolve: (v: FeedItem[]) => void): void => {
      setTimeout((): void => {
        const list: FeedItem[] = []
        for (let i = 0; i < size; i++) {
          list.push({ id: `p${page}-${i}`, title: `第 ${page} 页 第 ${i} 条` })
        }
        resolve(list)
      }, 600)
    })
  }
}
```

## 8. 反面示例

### ❌ 忘记用 `$$` 双向绑定

```typescript
// 错误:refreshing 是单向,手势完成后组件状态不回落
Refresh({ refreshing: this.isRefreshing }) {        // ← 缺 $$
  List() { /* ... */ }
}

// 正确
Refresh({ refreshing: $$this.isRefreshing }) {
  List() { /* ... */ }
}
```

### ❌ `onRefreshing` 里忘了改回 `isRefreshing = false`

```typescript
// 错误:只要请求失败或抛异常,指示器永远转圈
.onRefreshing(async (): Promise<void> => {
  this.items = await this.fetchLatest()
  this.isRefreshing = false          // ← 请求抛异常时永远到不了这行
})

// 正确:try/finally 兜底
.onRefreshing(async (): Promise<void> => {
  try {
    this.items = await this.fetchLatest()
  } finally {
    this.isRefreshing = false
  }
})
```

### ❌ 子组件不是可滚动容器

```typescript
// 错误:Column 不是可滚动容器,下拉手势被吞
Refresh({ refreshing: $$this.isRefreshing }) {
  Column() {
    Text('内容 1')
    Text('内容 2')
  }
}

// 正确:用 Scroll 包一层
Refresh({ refreshing: $$this.isRefreshing }) {
  Scroll() {
    Column() {
      Text('内容 1')
      Text('内容 2')
    }
  }
}
```

### ❌ 箭头函数不带类型标注

```typescript
// 错误:违反 SKILL.md §3
.onStateChange((state) => {           // ← state 缺类型
  console.info(state)
})

// 正确
.onStateChange((state: RefreshStatus): void => {
  console.info('state: ' + state)
})
```

### ❌ 用联合字面量做 `refreshing` 状态

```typescript
// 错误:违反 SKILL.md §5
@State refreshState: 'idle' | 'refreshing' = 'idle'

// 正确:直接用 boolean
@State isRefreshing: boolean = false
```

### ❌ 同时设 `builder` 和 `refreshingContent`

```typescript
// 错误:官方明确"同时设置时 builder 不生效",容易产生误解
Refresh({
  refreshing: $$this.isRefreshing,
  builder: this.customBuilder(),             // ← 不生效
  refreshingContent: this.customContent
})

// 正确:API 12+ 优先用 refreshingContent,API 11 及之前用 builder
```

## 9. API 速查

### 构造

| 接口 | 签名 | 说明 |
|------|------|------|
| `Refresh` | `(options: RefreshOptions)` | 必填 options |
| `RefreshOptions` | `{ refreshing: boolean, builder?, promptText?, refreshingContent? }` | `refreshing` 用 `$$` |

### 核心属性

| 属性 | 类型 | 场景 |
|------|------|------|
| `refreshOffset` | `number`(vp) | 触发刷新阈值,默 64 / 96 |
| `pullToRefresh` | `boolean` | 设 `false` 禁用下拉刷新 |
| `pullUpToCancelRefresh` | `boolean \| undefined`(API 23+) | 刷新中上划取消 |
| `pullDownRatio` | `Optional<number>` | 0-1 跟手系数 |
| `maxPullDownDistance` | `Optional<number>`(API 20+) | 最大下拉距离 |

### 核心事件

| 事件 | 签名 | 说明 |
|------|------|------|
| `onRefreshing` | `() => void` | 进入刷新态,**发起请求的入口** |
| `onStateChange` | `(state: RefreshStatus) => void` | 5 个状态转换监听 |
| `onOffsetChange` | `Callback<number>`(API 12+) | 下拉距离变化,做自定义动画 |

### 枚举

| `RefreshStatus` | Inactive(0) / Drag(1) / OverDrag(2) / Refresh(3) / Done(4) |
|-----------------|------------------------------------------------------------|

**记忆锚点**:

- `refreshing` **必须** `$$` 双向绑定,不是普通单向
- 子组件**必须**可滚动(`List` / `Scroll` / `Grid` / `WaterFlow`),塞 `Column` 不响应
- `onRefreshing` 内业务请求**必须** try/finally 兜底 `isRefreshing = false`
- 自定义刷新内容:API 12+ 用 `refreshingContent`,API 11 及之前用 `builder`,同时设只 `refreshingContent` 生效
- 完整"下拉刷新 + 上拉加载 + 四态"套路见 [patterns/data-fetching.md](patterns/data-fetching.md)
