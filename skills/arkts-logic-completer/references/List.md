# List + ListItem 组件功能逻辑规格

## 1. 功能定位

List 是列表容器组件，配合 ListItem 展示一组结构相同的数据。当界面需要展示可滚动的多条数据时使用，是 HarmonyOS 中最常见的布局容器。

## 2. 典型场景

- 设置页：设置项列表（图标 + 文字 + 右侧控件）
- 消息列表：头像 + 名称 + 最后一条消息 + 时间
- 数据列表：带下拉刷新、上拉加载更多
- 导航菜单：点击跳转到子页面

## 3. 状态声明

```typescript
// 基本列表
@State items: ItemData[] = []

// 带加载状态的列表
@State items: ItemData[] = []
@State isLoading: boolean = false
@State isRefreshing: boolean = false
@State hasMore: boolean = true
@State currentPage: number = 1
private scroller: Scroller = new Scroller()  // 滚动控制器

// 带选择功能的列表
@State items: ItemData[] = []
@State selectedIds: Set<string> = new Set()
@State isSelectMode: boolean = false
```

## 4. 事件与交互逻辑

### ListItem 点击事件
每个列表项通常需要点击响应：

```typescript
ListItem() {
  Row() {
    Text(item.title)
    Blank()
    Image($r('app.media.arrow_right'))
      .width(16)
  }
}
.onClick((): void => {
  router.pushUrl({ url: item.routePath, params: { id: item.id } })
})
```

### List 滚动事件

```typescript
List() { ... }
  .onScrollIndex((firstIndex: number, lastIndex: number): void => {
    // 滚动到底部加载更多
    if (lastIndex >= this.items.length - 1 && this.hasMore && !this.isLoading) {
      this.loadMore()
    }
  })
  .onReachEnd((): void => {
    // 触底加载
    if (this.hasMore) {
      this.loadMore()
    }
  })
```

### ListItem 侧滑操作

```typescript
ListItem() {
  Text(item.title)
}
.swipeAction({
  end: this.DeleteButton(item.id)
})

@Builder
DeleteButton(id: string) {
  Button('删除')
    .backgroundColor(Color.Red)
    .onClick((): void => {
      this.items = this.items.filter((i: ItemData): boolean => i.id !== id)
    })
}
```

## 5. 数据结构

```typescript
// 通用列表项
interface ItemData {
  id: string
  title: string
  subtitle?: string
  icon?: Resource
  routePath?: string      // 跳转路径
  extraInfo?: string      // 右侧附加信息
}

// 设置列表项（带控件）
interface SettingItemData {
  id: string
  label: string
  type: string  // 'toggle' | 'arrow' | 'text'，右侧控件类型
  value?: string | boolean
  routePath?: string
}

// 分页数据
interface PageResult<T> {
  list: T[]
  total: number
  page: number
  pageSize: number
  hasMore: boolean
}
```

## 6. 联动说明

- 搜索框输入 → 过滤列表内容
- 下拉刷新 → 重新请求数据 → 更新列表
- 列表项点击 → 路由跳转到详情页
- 列表项侧滑 → 显示删除/编辑操作
- 全选 Checkbox → 选中所有列表项
- 列表为空 → 显示空状态占位图

### 嵌套滚动

List 嵌套在 Scroll 或其他可滚动容器中时，如果出现滑动冲突，可通过 `nestedScroll` 显式设置滚动协调策略：

```typescript
List()
  .nestedScroll({
    scrollForward: NestedScrollMode.PARENT_FIRST,
    scrollBackward: NestedScrollMode.SELF_FIRST
  })
```

默认值为 `SELF_ONLY`，即内外层滚动互不联动。根据实际场景选择合适的 NestedScrollMode 组合即可。

## 7. 完整代码示例

```typescript
interface ContactItem {
  id: string
  name: string
  phone: string
}

@Entry
@Component
struct ContactListPage {
  @State contacts: ContactItem[] = [
    { id: '1', name: '张三', phone: '138xxxx1234' },
    { id: '2', name: '李四', phone: '139xxxx5678' },
    { id: '3', name: '王五', phone: '137xxxx9012' }
  ]
  @State searchText: string = ''
  @State isRefreshing: boolean = false

  getFilteredContacts(): ContactItem[] {
    if (this.searchText === '') return this.contacts
    return this.contacts.filter((c: ContactItem): boolean => c.name.includes(this.searchText))
  }

  build() {
    Column() {
      // 搜索框
      TextInput({ placeholder: '搜索联系人', text: this.searchText })
        .onChange((value: string): void => {
          this.searchText = value
        })
        .margin(12)

      // 列表
      if (this.getFilteredContacts().length === 0) {
        // 空状态
        Column() {
          Text('暂无联系人')
            .fontColor('#999')
        }
        .width('100%')
        .layoutWeight(1)
        .justifyContent(FlexAlign.Center)
      } else {
        List({ space: 1 }) {
          ForEach(this.getFilteredContacts(), (item: ContactItem): void => {
            ListItem() {
              Row() {
                Column() {
                  Text(item.name)
                    .fontSize(16)
                  Text(item.phone)
                    .fontSize(14)
                    .fontColor('#666')
                }
                .alignItems(HorizontalAlign.Start)

                Blank()
                Image($r('app.media.arrow_right'))
                  .width(16)
                  .height(16)
              }
              .width('100%')
              .padding(16)
            }
            .onClick((): void => {
              router.pushUrl({
                url: 'pages/ContactDetail',
                params: { contactId: item.id }
              })
            })
            .swipeAction({
              end: this.ItemDeleteButton(item.id)
            })
          }, (item: ContactItem): string => item.id)
        }
        .layoutWeight(1)
        .divider({ strokeWidth: 0.5, color: '#eee', startMargin: 16 })
      }
    }
    .width('100%')
    .height('100%')
  }

  @Builder
  ItemDeleteButton(id: string) {
    Button('删除')
      .fontColor(Color.White)
      .backgroundColor(Color.Red)
      .onClick((): void => {
        this.contacts = this.contacts.filter((c: ContactItem): boolean => c.id !== id)
      })
  }
}
```

## 8. 反面示例

```typescript
// ❌ 列表数据写死在 build 里，没有用 @State
List() {
  ListItem() { Text('item 1') }
  ListItem() { Text('item 2') }
  ListItem() { Text('item 3') }
}

// ❌ ForEach 没有提供 keyGenerator，列表更新可能异常
ForEach(this.items, (item: ItemData) => {
  ListItem() { Text(item.name) }
})
// 应改为：
ForEach(this.items, (item: ItemData): void => {
  ListItem() { Text(item.name) }
}, (item: ItemData): string => item.id)

// ❌ ListItem 没有点击事件，用户点了没反应
ListItem() {
  Row() {
    Text('设置项')
    Image($r('app.media.arrow_right'))  // 有箭头暗示可点击，但没有 onClick
  }
}

// ❌ 没有处理空状态，列表为空时页面一片空白
List() {
  ForEach(this.items, ...)  // items 为空时什么都不显示
}
```

## 9. API 速查

| API | 说明 |
|-----|------|
| `List({ space?, initialIndex?, scroller? })` | 创建列表容器，scroller 绑定 Scroller 控制器 |
| `ListItem()` | 列表子项 |
| `ListItemGroup({ header?, footer? })` | 分组（配合 sticky 可吸顶） |
| `.listDirection(Axis)` | 排列方向：Axis.Vertical（默认）/ Axis.Horizontal |
| `.lanes(number)` | 多列布局，如 `.lanes(2)` 实现两列列表（API 9+） |
| `.divider({ strokeWidth, color, startMargin, endMargin })` | 分割线 |
| `.scrollBar(BarState)` | 滚动条：Auto（默认 API 10+）/ On / Off |
| `.cachedCount(number)` | LazyForEach 预加载行数，建议设为一屏行数的一半 |
| `.sticky(StickyStyle)` | ListItemGroup header/footer 吸顶/吸底（API 9+） |
| `.edgeEffect(EdgeEffect)` | 边缘效果：Spring（回弹）/ Fade（淡出）/ None |
| `.nestedScroll(NestedScrollOptions)` | 嵌套滚动联动模式，出现滑动冲突时可显式设置（API 10+） |
| `.enableScrollInteraction(boolean)` | 是否支持手势滚动，禁用后仍可通过 Scroller 控制（API 10+） |
| `.scrollSnapAlign(ScrollSnapAlign)` | 滚动结束对齐效果，轮播类列表用（API 10+） |
| `.onScrollIndex((first, last) => void)` | 滚动索引变化 |
| `.onReachEnd(() => void)` | 滚动触底 |
| `.swipeAction({ start?, end? })` | ListItem 侧滑操作 |
| `.selectable(boolean)` | ListItem 是否可框选 |
| `ForEach(arr, itemGenerator, keyGenerator)` | 循环渲染 |
| `LazyForEach(dataSource, itemGenerator, keyGenerator)` | 懒加载渲染（长列表必用） |

> **性能要点**：长列表务必用 `LazyForEach` + `.cachedCount(n/2)`（n 为一屏可见项数）。需要编程控制滚动（回到顶部、跳转指定索引）时，通过 `scroller` 参数绑定 `Scroller` 控制器，调用 `scroller.scrollToIndex()` 或 `scroller.scrollEdge(Edge.Top)`。
