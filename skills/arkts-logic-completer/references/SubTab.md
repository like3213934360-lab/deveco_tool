# SubTab 子页签/内联标签功能逻辑规格

## 1. 功能定位

SubTab 是子页签/内联标签模式，基于 Tabs + TabContent 的 SubTabBarStyle 实现，用于页面内部区域的内容分类切换（区别于 BottomTab 的一级导航）。

## 2. 典型场景

- 详情页顶部的"简介 / 评论 / 推荐"内容切换
- 列表页的"最新 / 热门 / 关注"排序切换
- 个人主页的"动态 / 收藏 / 点赞"分区切换
- 设置页内的"通用 / 隐私 / 通知"分区

## 3. 状态声明

```typescript
// 当前选中 SubTab 索引
@State currentSubTabIndex: number = 0

// 子页签标签
@State subTabs: string[] = ['最新', '热门', '关注']

// 各 Tab 对应的列表数据
@State latestList: string[] = []
@State hotList: string[] = []
```

装饰器选择：
- `@State`：页面内的 Tab 索引
- `$$`：index 支持双向绑定
- `@Prop`：子组件中接收 Tab 配置

## 4. 事件与交互逻辑

### SubTabBarStyle 与 onChange

```typescript
Tabs({ index: $$this.currentSubTabIndex }) {
  TabContent() {
    // 最新列表
  }
  .tabBar(SubTabBarStyle.of('最新')
    .indicator({
      color: '#007DFF',
      height: 2,
      borderRadius: 1
    })
    .labelStyle({
      font: { size: 16 },
      selectedColor: '#007DFF',
      unselectedColor: '#99000000'
    })
  )

  TabContent() {
    // 热门列表
  }
  .tabBar(SubTabBarStyle.of('热门'))
}
.barMode(BarMode.Fixed)
.onChange((index: number): void => {
  this.currentSubTabIndex = index
  this.loadDataForTab(index)
})
```

## 5. 数据结构

```typescript
interface SubTabConfig {
  label: string
  hasIndicator: boolean
}

interface TabPageData {
  tabIndex: number
  items: string[]
  isLoaded: boolean
}
```

## 6. 联动说明

- SubTab 切换 → 加载对应数据（懒加载策略）
- 滑动手势 → Tab 内容跟手切换 + 指示器联动
- 下拉刷新 → 刷新当前 Tab 对应的数据
- 数据为空 → 显示空态占位组件

## 7. 完整代码示例

```typescript
interface ContentItem {
  title: string
  time: string
}

@Entry
@Component
struct SubTabDemo {
  @State currentIndex: number = 0
  @State latestData: ContentItem[] = [
    { title: '最新文章 1', time: '刚刚' },
    { title: '最新文章 2', time: '5 分钟前' },
    { title: '最新文章 3', time: '10 分钟前' }
  ]
  @State hotData: ContentItem[] = [
    { title: '热门文章 1', time: '1000 赞' },
    { title: '热门文章 2', time: '800 赞' }
  ]
  @State followData: ContentItem[] = [
    { title: '关注作者的新文章', time: '1 小时前' }
  ]

  @Builder
  buildList(items: ContentItem[]) {
    List() {
      ForEach(items, (item: ContentItem) => {
        ListItem() {
          Row() {
            Column() {
              Text(item.title).fontSize(16)
              Text(item.time).fontSize(12).fontColor('#999999').margin({ top: 4 })
            }
            .alignItems(HorizontalAlign.Start)
          }
          .width('100%')
          .padding(16)
        }
      })
    }
    .width('100%')
    .layoutWeight(1)
    .divider({ strokeWidth: 0.5, color: '#F0F0F0' })
  }

  build() {
    Column() {
      Text('内容广场').fontSize(20).fontWeight(FontWeight.Bold).padding(16)

      Tabs({ index: $$this.currentIndex }) {
        TabContent() {
          this.buildList(this.latestData)
        }
        .tabBar(SubTabBarStyle.of('最新')
          .indicator({ color: '#007DFF', height: 2, borderRadius: 1 })
          .labelStyle({ selectedColor: '#007DFF', unselectedColor: '#99000000' })
        )

        TabContent() {
          this.buildList(this.hotData)
        }
        .tabBar(SubTabBarStyle.of('热门')
          .indicator({ color: '#007DFF', height: 2, borderRadius: 1 })
          .labelStyle({ selectedColor: '#007DFF', unselectedColor: '#99000000' })
        )

        TabContent() {
          this.buildList(this.followData)
        }
        .tabBar(SubTabBarStyle.of('关注')
          .indicator({ color: '#007DFF', height: 2, borderRadius: 1 })
          .labelStyle({ selectedColor: '#007DFF', unselectedColor: '#99000000' })
        )
      }
      .barMode(BarMode.Fixed)
      .barHeight(48)
      .onChange((index: number): void => {
        this.currentIndex = index
      })
      .layoutWeight(1)
    }
    .width('100%')
    .height('100%')
  }
}
```

## 8. 反面示例

```typescript
// ❌ 用 BottomTabBarStyle 做内容区子 Tab（视觉风格不匹配）
TabContent() { ... }
  .tabBar(BottomTabBarStyle.of($r('app.media.icon'), '最新'))

// ❌ barMode 用 Scrollable 但 Tab 数量很少（2-3 个），应使用 Fixed 平均分配
Tabs() { /* 仅 2 个 Tab */ }
  .barMode(BarMode.Scrollable)

// ❌ 每次切换 Tab 都重新创建数据，没有缓存策略
.onChange((index: number): void => {
  this.allData = this.fetchFromServer(index) // 应先检查缓存
})

// ❌ SubTabBarStyle.of() 不传字符串参数
TabContent() { ... }
  .tabBar(SubTabBarStyle.of(''))  // 空字符串，Tab 标签无文字
```

## 9. API 速查

| API | 说明 |
|-----|------|
| `Tabs({ barPosition?, index?, controller? })` | 创建 Tab 容器 |
| `TabContent().tabBar(SubTabBarStyle.of(text))` | 子页签样式 |
| `SubTabBarStyle.of(text)` | 创建子页签样式实例 |
| `.indicator({ color, height, borderRadius })` | 指示器样式 |
| `.labelStyle({ selectedColor, unselectedColor, font? })` | 标签文字样式 |
| `.barMode(BarMode.Fixed)` | Tab 平均分配宽度 |
| `.barMode(BarMode.Scrollable, options?)` | Tab 可滚动 |
| `.barHeight(Length)` | TabBar 高度（SubTab 默认 56vp） |
| `.onChange((index: number) => void)` | 页签切换回调 |
| `.scrollable(boolean)` | 是否可手势滑动切换内容 |
| `.animationDuration(number)` | 切换动画时长 |
