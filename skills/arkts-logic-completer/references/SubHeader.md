# SubHeader 组件功能逻辑规格

## 1. 功能定位

SubHeader 是子标题组件，用于列表项或内容项顶部，将列表或内容划分为一个区块，子标题名称用来概括该区块内容。左侧支持标题/副标题/图标/下拉选择器，右侧支持文本按钮、图标按钮组、加载动画等操作区。

## 2. 典型场景

- 列表分区标题（热门推荐、最近使用）
- 内容区块标题 + 右侧"更多"入口
- 左侧标题 + 右侧操作按钮（编辑、管理）
- 左侧下拉选择器 + 右侧图标操作按钮组
- 双行标题 + 右侧文字箭头跳转
- 自定义标题内容（通过 titleBuilder）

## 3. 状态声明

```typescript
import { SubHeader, OperationType } from '@kit.ArkUI'

// 子标题无需额外状态，配置项通过构造参数传入
// 若需要动态切换操作区内容，可声明：
@State currentOperationType: OperationType = OperationType.BUTTON
```

## 4. 事件与交互逻辑

### 场景一：标题 + 右侧文字箭头跳转

```typescript
import { SubHeader, OperationType, Prompt } from '@kit.ArkUI'

SubHeader({
  primaryTitle: '热门推荐',
  operationType: OperationType.TEXT_ARROW,
  operationItem: [{
    value: '更多',
    action: (): void => {
      Prompt.showToast({ message: '跳转更多页面' })
    }
  }]
})
```

### 场景二：图标 + 副标题 + 右侧按钮

```typescript
SubHeader({
  icon: $r('sys.media.ohos_ic_public_email'),
  secondaryTitle: '消息通知',
  operationType: OperationType.BUTTON,
  operationItem: [{
    value: '管理',
    action: (): void => {
      this.enterManageMode()
    }
  }]
})
```

### 场景三：左侧下拉选择器 + 右侧图标组

```typescript
SubHeader({
  select: {
    options: [{ value: '按时间' }, { value: '按名称' }, { value: '按大小' }],
    value: '排序方式',
    selected: 0,
    onSelect: (index: number, value?: string): void => {
      this.changeSortOrder(index)
    }
  },
  operationType: OperationType.ICON_GROUP,
  operationItem: [
    {
      value: $r('sys.media.ohos_ic_public_edit'),
      action: (): void => { this.onEdit() }
    },
    {
      value: $r('sys.media.ohos_ic_public_remove'),
      action: (): void => { this.onDelete() }
    }
  ]
})
```

### 场景四：自定义标题（API 12+）

```typescript
@Builder
CustomTitle(): void {
  Row({ space: 8 }) {
    Text('自定义')
      .fontSize(20)
      .fontWeight(FontWeight.Bold)
    Text('NEW')
      .fontSize(10)
      .fontColor(Color.White)
      .backgroundColor(Color.Red)
      .borderRadius(4)
      .padding({ left: 4, right: 4 })
  }
}

SubHeader({
  titleBuilder: (): void => {
    this.CustomTitle()
  },
  operationType: OperationType.TEXT_ARROW,
  operationItem: [{
    value: '查看全部',
    action: (): void => {}
  }]
})
```

## 5. 数据结构

```typescript
// 操作区按钮项
interface SubHeaderOperationItem {
  value: ResourceStr
  action?: () => void
}

// 下拉选择器选项
interface SubHeaderSelectConfig {
  options: Array<SelectOption>
  selected?: number
  value?: ResourceStr
  onSelect?: (index: number, value?: string) => void
}

// 操作区类型
// OperationType.TEXT_ARROW = 0  文本+箭头
// OperationType.BUTTON = 1     文本按钮
// OperationType.ICON_GROUP = 2 图标按钮组（最多3个）
// OperationType.LOADING = 3    加载动画
```

## 6. 联动说明

- 当同时设置 `primaryTitle`、`secondaryTitle`、`icon` 时，`primaryTitle` 不生效
- 当使用 `secondaryTitle` 时，设置 `icon` 才会生效
- `select` 下拉菜单选中 → 触发 `onSelect` 回调 → 更新列表排序/筛选
- 右侧按钮点击 → 执行 `operationItem[n].action` → 跳转/弹窗/进入编辑模式
- `operationType` 为 `ICON_GROUP` 时最多支持 3 个图标
- `titleBuilder` 会覆盖 `primaryTitle`/`secondaryTitle`/`icon` 的默认布局
- 不建议在 SubHeader 上设置通用属性和通用事件

## 7. 完整代码示例

```typescript
import { SubHeader, OperationType, Prompt, LengthMetrics } from '@kit.ArkUI'
import { router } from '@kit.ArkUI'

interface SectionItem {
  title: string
  items: string[]
}

@Entry
@Component
struct SubHeaderDemo {
  @State sections: SectionItem[] = [
    { title: '最近使用', items: ['文档A', '表格B', '演示C'] },
    { title: '收藏夹', items: ['项目计划', '会议记录'] }
  ]
  @State sortIndex: number = 0

  build() {
    List({ space: 0 }) {
      ForEach(this.sections, (section: SectionItem) => {
        ListItem() {
          SubHeader({
            primaryTitle: section.title,
            operationType: OperationType.TEXT_ARROW,
            operationItem: [{
              value: '更多',
              action: (): void => {
                Prompt.showToast({ message: `查看${section.title}全部` })
              }
            }],
            contentMargin: {
              start: LengthMetrics.vp(16),
              end: LengthMetrics.vp(16)
            }
          })
        }

        ForEach(section.items, (item: string) => {
          ListItem() {
            Text(item)
              .width('100%')
              .height(48)
              .padding({ left: 16, right: 16 })
              .fontSize(16)
          }
        }, (item: string): string => item)
      }, (section: SectionItem): string => section.title)
    }
    .width('100%')
    .height('100%')
  }
}
```

## 8. 反面示例

```typescript
// ❌ 同时设置 primaryTitle、secondaryTitle、icon，primaryTitle 不生效
SubHeader({
  primaryTitle: '一级标题',    // 不生效
  secondaryTitle: '二级标题',
  icon: $r('sys.media.ohos_ic_public_email')
})

// ❌ 没有 secondaryTitle 时设置 icon，icon 不会显示
SubHeader({
  primaryTitle: '标题',
  icon: $r('sys.media.ohos_ic_public_email')  // 无 secondaryTitle，icon 不显示
})

// ❌ operationType 为 ICON_GROUP 却配了超过 3 个图标
SubHeader({
  operationType: OperationType.ICON_GROUP,
  operationItem: [
    { value: $r('sys.media.ohos_ic_public_email'), action: (): void => {} },
    { value: $r('sys.media.ohos_ic_public_email'), action: (): void => {} },
    { value: $r('sys.media.ohos_ic_public_email'), action: (): void => {} },
    { value: $r('sys.media.ohos_ic_public_email'), action: (): void => {} }  // 第4个超出限制
  ]
})

// ❌ 在 SubHeader 上设置通用属性，可能不生效
SubHeader({ primaryTitle: '标题' })
  .backgroundColor(Color.Red)  // 不建议，可能不生效

// ❌ 没有设置 operationItem 的 action 回调，点击无反应
SubHeader({
  primaryTitle: '标题',
  operationType: OperationType.BUTTON,
  operationItem: [{ value: '操作' }]  // 缺少 action
})
```

## 9. API 速查

| API | 说明 |
|-----|------|
| `SubHeader({ ... })` | 创建子标题组件，需从 `'@kit.ArkUI'` 导入 |
| `primaryTitle` | 主标题文本 |
| `secondaryTitle` | 副标题文本 |
| `icon` | 左侧图标（需配合 secondaryTitle 使用） |
| `iconSymbolOptions` | icon 为 SymbolGlyph 时的样式设置（API 12+） |
| `select` | 左侧下拉选择器配置 |
| `operationType` | 右侧操作区类型：TEXT_ARROW / BUTTON / ICON_GROUP / LOADING |
| `operationItem` | 右侧操作区配置数组 |
| `operationSymbolOptions` | 右侧图标为 SymbolGlyph 时的样式（API 12+） |
| `primaryTitleModifier` | 主标题文本修饰器（API 12+） |
| `secondaryTitleModifier` | 副标题文本修饰器（API 12+） |
| `titleBuilder` | 自定义标题区内容 @Builder（API 12+） |
| `contentMargin` | 子标题外边距（API 12+） |
| `contentPadding` | 子标题内边距（API 12+） |

> **注意**：SubHeader 不支持通用属性和通用事件。当同时使用 primaryTitle + secondaryTitle + icon 时，primaryTitle 不生效。ICON_GROUP 最多支持 3 个图标。该组件仅可在 Stage 模型下使用。
