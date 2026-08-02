# BottomTab 底部页签导航功能逻辑规格

## 1. 功能定位

BottomTab 是底部页签导航模式，基于 Tabs + TabContent 的 BottomTabBarStyle 实现，用于应用主页在多个一级页面之间切换导航。

## 2. 典型场景

- 应用首页底部导航（首页 / 发现 / 消息 / 我的）
- 电商应用底部 Tab（首页 / 分类 / 购物车 / 订单 / 我的）
- 社交应用底部 Tab（消息 / 通讯录 / 动态 / 我的）
- 带角标的底部 Tab（未读消息数）

## 3. 状态声明

```typescript
// 当前选中 Tab 索引
@State currentIndex: number = 0

// 未读消息角标
@State unreadCount: number = 0

// Tab 页签配置
@State tabItems: TabItemInfo[] = [
  { label: '首页', icon: $r('app.media.ic_home'), selectedIcon: $r('app.media.ic_home_selected') },
  { label: '发现', icon: $r('app.media.ic_discover'), selectedIcon: $r('app.media.ic_discover_selected') },
  { label: '消息', icon: $r('app.media.ic_message'), selectedIcon: $r('app.media.ic_message_selected') },
  { label: '我的', icon: $r('app.media.ic_mine'), selectedIcon: $r('app.media.ic_mine_selected') }
]
```

装饰器选择：
- `@State`：页面内页签索引
- `$$`：index 支持双向绑定 `Tabs({ index: $$this.currentIndex })`
- `@StorageLink`：跨页面持久化当前 Tab（如从通知跳转到指定 Tab）

## 4. 事件与交互逻辑

### onChange 页签切换

```typescript
Tabs({ barPosition: BarPosition.End, index: $$this.currentIndex }) {
  // TabContent...
}
.onChange((index: number): void => {
  this.currentIndex = index
  if (index === 2) {
    this.unreadCount = 0
  }
})
.onTabBarClick((index: number): void => {
  if (index === this.currentIndex) {
    this.scrollToTop()
  }
})
```

## 5. 数据结构

```typescript
interface TabItemInfo {
  label: string
  icon: Resource
  selectedIcon: Resource
  badge?: number
}
```

## 6. 联动说明

- Tab 切换 → 对应 TabContent 显示，其余隐藏（不销毁）
- 消息 Tab 点击 → 清除未读角标
- 重复点击当前 Tab → 触发页面内滚动到顶部
- 外部通知跳转 → 修改 currentIndex 切换到指定 Tab

## 7. 完整代码示例

```typescript
interface TabItemInfo {
  label: string
  icon: Resource
  selectedIcon: Resource
  badge?: number
}

@Entry
@Component
struct BottomTabDemo {
  @State currentIndex: number = 0
  @State unreadCount: number = 5

  private tabItems: TabItemInfo[] = [
    { label: '首页', icon: $r('sys.media.ohos_ic_public_home'), selectedIcon: $r('sys.media.ohos_ic_public_home') },
    { label: '发现', icon: $r('sys.media.ohos_ic_public_search_filled'), selectedIcon: $r('sys.media.ohos_ic_public_search_filled') },
    { label: '消息', icon: $r('sys.media.ohos_ic_public_message'), selectedIcon: $r('sys.media.ohos_ic_public_message') },
    { label: '我的', icon: $r('sys.media.ohos_ic_public_contacts'), selectedIcon: $r('sys.media.ohos_ic_public_contacts') }
  ]

  build() {
    Tabs({ barPosition: BarPosition.End, index: $$this.currentIndex }) {
      TabContent() {
        Column() {
          Text('首页内容').fontSize(20)
        }
        .width('100%')
        .height('100%')
        .justifyContent(FlexAlign.Center)
      }
      .tabBar(BottomTabBarStyle.of(this.tabItems[0].icon, '首页'))

      TabContent() {
        Column() {
          Text('发现内容').fontSize(20)
        }
        .width('100%')
        .height('100%')
        .justifyContent(FlexAlign.Center)
      }
      .tabBar(BottomTabBarStyle.of(this.tabItems[1].icon, '发现'))

      TabContent() {
        Column() {
          Text('消息内容').fontSize(20)
          if (this.unreadCount > 0) {
            Text(this.unreadCount.toString() + ' 条未读')
              .fontColor(Color.Red)
          }
        }
        .width('100%')
        .height('100%')
        .justifyContent(FlexAlign.Center)
      }
      .tabBar(BottomTabBarStyle.of(this.tabItems[2].icon, '消息'))

      TabContent() {
        Column() {
          Text('我的页面').fontSize(20)
        }
        .width('100%')
        .height('100%')
        .justifyContent(FlexAlign.Center)
      }
      .tabBar(BottomTabBarStyle.of(this.tabItems[3].icon, '我的'))
    }
    .scrollable(false)
    .barHeight(56)
    .onChange((index: number): void => {
      this.currentIndex = index
      if (index === 2) {
        this.unreadCount = 0
      }
    })
  }
}
```

## 8. 反面示例

```typescript
// ❌ barPosition 用了 Start，底部 Tab 应使用 End
Tabs({ barPosition: BarPosition.Start })

// ❌ 没有用 BottomTabBarStyle，而是用了 SubTabBarStyle（视觉不符合底部导航规范）
TabContent() { ... }
  .tabBar(SubTabBarStyle.of('首页'))

// ❌ 忘记设置 scrollable(false)，用户左右滑动会切页而非操作页面内容
Tabs({ barPosition: BarPosition.End }) { ... }
// 缺少 .scrollable(false)

// ❌ index 不用双向绑定，通过 TabsController 和 onChange 手动同步容易遗漏
@State currentIndex: number = 0
Tabs({ index: this.currentIndex }) // 应使用 $$this.currentIndex
```

## 9. API 速查

| API | 说明 |
|-----|------|
| `Tabs({ barPosition: BarPosition.End, index })` | 创建底部页签容器，index 支持 $$ 双向绑定 |
| `TabContent().tabBar(BottomTabBarStyle.of(icon, text))` | 底部页签样式，含图标 + 文字 |
| `BottomTabBarStyle.of(icon, text)` | 创建底部页签样式实例 |
| `.scrollable(false)` | 禁用手势滑动切页 |
| `.barHeight(Length)` | 设置 TabBar 高度（默认 56vp / API 12+ 默认 48vp） |
| `.onChange((index: number) => void)` | 页签切换回调 |
| `.onTabBarClick((index: number) => void)` | 页签点击回调（含重复点击） |
| `.barBackgroundColor(color)` | TabBar 背景色 |
| `.barMode(BarMode.Fixed)` | 所有 Tab 平均分配宽度（默认） |
