# Badge 组件功能逻辑规格

## 1. 功能定位

Badge 是信息标记组件，用于在单个组件上附加小红点或数字/文本提醒。当界面需要标识未读消息数、新功能标记或状态提示时使用。

## 2. 典型场景

- TabBar 图标上的未读消息数标记
- 列表项右侧的"New"文本标记
- 应用图标上的小红点提醒
- 购物车图标上的商品件数显示

## 3. 状态声明

```typescript
// 未读消息数
@State unreadCount: number = 0

// 是否有新内容（小红点场景）
@State hasNewContent: boolean = false

// 多标签页各自的未读数
@State tabBadges: TabBadgeItem[] = [
  { label: '消息', icon: $r('app.media.ic_message'), count: 5 },
  { label: '通知', icon: $r('app.media.ic_notify'), count: 0 },
  { label: '发现', icon: $r('app.media.ic_discover'), count: 0 }
]
```

装饰器选择：
- `@State`：页面内部状态
- `@Prop`：父组件单向传入（如列表中每个标记项）
- `@Link`：父子双向同步

## 4. 事件与交互逻辑

Badge 自身没有专属事件，交互逻辑通过其子组件或父容器的事件实现：

```typescript
Badge({
  count: this.unreadCount,
  maxCount: 99,
  position: BadgePosition.RightTop,
  style: { badgeSize: 16, badgeColor: '#FA2A2D' }
}) {
  Image($r('app.media.ic_message'))
    .width(24)
    .height(24)
}
.onClick((): void => {
  // 点击后清除未读数
  this.unreadCount = 0
})
```

### 动态控制显隐

Badge 的 count 值 <= 0 时自动隐藏标记（API 12+ 支持 scale 显隐动效）：

```typescript
// count 为 0 时标记隐藏；大于 0 时显示
Badge({
  count: this.unreadCount,
  style: { badgeSize: 16, badgeColor: '#FA2A2D' }
}) {
  Image($r('app.media.ic_message')).width(24).height(24)
}
```

## 5. 数据结构

```typescript
// 标签页标记模型
interface TabBadgeItem {
  label: string       // 标签文本
  icon: Resource      // 图标资源
  count: number       // 未读消息数，0 时隐藏标记
}

// BadgeStyle 常用配置
interface BadgeStyleConfig {
  color: ResourceColor       // 文本颜色，默认 Color.White
  fontSize: number           // 文本大小，默认 10vp
  badgeSize: number          // Badge 大小，默认 16vp
  badgeColor: ResourceColor  // Badge 背景色，默认 Color.Red
}
```

## 6. 联动说明

- 收到新消息 → unreadCount 增加 → Badge 自动显示数字
- 用户进入消息页 → unreadCount 置为 0 → Badge 自动隐藏
- 多个 Tab 各自维护独立的 count → 切换 Tab 时不互相影响
- count 超过 maxCount → 显示为 "maxCount+"（如"99+"）

## 7. 完整代码示例

```typescript
interface TabBadgeItem {
  label: string
  count: number
}

@Entry
@Component
struct MessageCenterPage {
  @State messageCount: number = 12
  @State notifyCount: number = 3
  @State currentTab: number = 0

  @Builder
  tabBuilder(title: string, count: number, index: number) {
    Column() {
      if (count > 0) {
        Badge({
          count: count,
          maxCount: 99,
          position: BadgePosition.RightTop,
          style: { badgeSize: 16, badgeColor: '#FA2A2D' }
        }) {
          Text(title)
            .fontSize(16)
            .fontColor(this.currentTab === index ? '#007DFF' : '#182431')
        }
      } else {
        Text(title)
          .fontSize(16)
          .fontColor(this.currentTab === index ? '#007DFF' : '#182431')
      }
    }
    .width('100%')
    .height('100%')
    .justifyContent(FlexAlign.Center)
  }

  build() {
    Column() {
      Tabs({ barPosition: BarPosition.End }) {
        TabContent() {
          Column({ space: 16 }) {
            Text('消息列表')
              .fontSize(20)
              .fontWeight(FontWeight.Bold)
            Button('清除全部未读')
              .onClick((): void => {
                this.messageCount = 0
              })
            Button('模拟新消息 +1')
              .onClick((): void => {
                this.messageCount++
              })
          }
          .width('100%')
          .height('100%')
          .justifyContent(FlexAlign.Center)
        }
        .tabBar(this.tabBuilder('消息', this.messageCount, 0))

        TabContent() {
          Column({ space: 16 }) {
            Text('通知列表')
              .fontSize(20)
              .fontWeight(FontWeight.Bold)
            Button('全部已读')
              .onClick((): void => {
                this.notifyCount = 0
              })
          }
          .width('100%')
          .height('100%')
          .justifyContent(FlexAlign.Center)
        }
        .tabBar(this.tabBuilder('通知', this.notifyCount, 1))

        TabContent() {
          Text('发现页').fontSize(20)
        }
        .tabBar(this.tabBuilder('发现', 0, 2))
      }
      .onChange((index: number): void => {
        this.currentTab = index
      })
    }
    .width('100%')
    .height('100%')
  }
}
```

## 8. 反面示例

```typescript
// ❌ style 中 badgeSize 设为 0，Badge 不显示
Badge({
  count: 5,
  style: { badgeSize: 0, badgeColor: '#FA2A2D' }
}) { Text('消息') }

// ❌ 没有给子组件设置宽高，Badge 标记不显示
Badge({ count: 5, style: { badgeSize: 16, badgeColor: '#FA2A2D' } }) {
  Column() {}
}

// ❌ count 写死为字面量，没有绑定 @State，无法动态更新
Badge({ count: 10, style: { badgeSize: 16, badgeColor: '#FA2A2D' } }) {
  Text('消息')
}

// ❌ 使用 position 的 Position 类型设置百分比（不支持百分比）
Badge({
  count: 1,
  position: { x: '50%', y: '50%' },
  style: { badgeSize: 16, badgeColor: '#FA2A2D' }
}) { Text('消息') }
```

## 9. API 速查

| API | 说明 |
|-----|------|
| `Badge({ count: number, maxCount?: number, position?, style })` | 根据数字创建标记，count <= 0 时隐藏 |
| `Badge({ value: string, position?, style })` | 根据字符串创建标记，如 'New'、'Hot' |
| `BadgePosition.RightTop` | 标记显示在右上角（默认值） |
| `BadgePosition.Right` | 标记显示在右侧纵向居中 |
| `BadgePosition.Left` | 标记显示在左侧纵向居中 |
| `style.color` | 文本颜色，默认 Color.White |
| `style.fontSize` | 文本大小，默认 10vp |
| `style.badgeSize` | Badge 大小，默认 16vp |
| `style.badgeColor` | Badge 背景色，默认 Color.Red |
| `style.fontWeight` | 文本字体粗细（API 10+） |
| `style.borderColor` | 底板描边颜色（API 10+） |
| `style.borderWidth` | 底板描边粗细（API 10+） |
