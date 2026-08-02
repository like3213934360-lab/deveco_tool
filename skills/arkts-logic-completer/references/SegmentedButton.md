# SegmentButton 组件功能逻辑规格

## 1. 功能定位

SegmentButton 是分段按钮组件，包含页签类（tab）和胶囊类（capsule）两种形态。页签类用于页面/内容区域切换，胶囊类用于单选或多选场景。支持 2~5 个按钮，支持纯文字、纯图标、图标+文字三种按钮样式。

## 2. 典型场景

- 页面顶部 Tab 切换（推荐/热门/最新）
- 筛选条件单选（全部/进行中/已完成）
- 多选标签过滤（按类别筛选内容）
- 视图模式切换（列表视图/网格视图，图标形式）
- 图标+文字组合的功能入口切换

## 3. 状态声明

```typescript
import {
  SegmentButton,
  SegmentButtonOptions,
  SegmentButtonItemOptionsArray,
  SegmentButtonItemTuple,
  ItemRestriction,
  SegmentButtonTextItem
} from '@kit.ArkUI'

// 页签类分段按钮选项
@State tabOptions: SegmentButtonOptions = SegmentButtonOptions.tab({
  buttons: [{ text: '推荐' }, { text: '热门' }, { text: '最新' }] as ItemRestriction<SegmentButtonTextItem>
})

// 胶囊类单选
@State capsuleOptions: SegmentButtonOptions = SegmentButtonOptions.capsule({
  buttons: [{ text: '全部' }, { text: '进行中' }, { text: '已完成' }] as SegmentButtonItemTuple,
  multiply: false
})

// 胶囊类多选
@State multiOptions: SegmentButtonOptions = SegmentButtonOptions.capsule({
  buttons: [{ text: '标签A' }, { text: '标签B' }, { text: '标签C' }] as SegmentButtonItemTuple,
  multiply: true
})

// 选中索引（@Link 双向同步）
@State tabSelectedIndexes: number[] = [0]
@State capsuleSelectedIndexes: number[] = [0]
@State multiSelectedIndexes: number[] = []
```

## 4. 事件与交互逻辑

### selectedIndexes 双向同步

SegmentButton 通过 `@Link` 绑定 `selectedIndexes`，选中变化自动回写到父组件。

### 场景一：页签切换内容区

```typescript
@State tabSelectedIndexes: number[] = [0]

SegmentButton({
  options: this.tabOptions,
  selectedIndexes: $tabSelectedIndexes
})

if (this.tabSelectedIndexes[0] === 0) {
  // 推荐内容
} else if (this.tabSelectedIndexes[0] === 1) {
  // 热门内容
} else {
  // 最新内容
}
```

### 场景二：胶囊单选筛选

```typescript
@State filterIndexes: number[] = [0]

SegmentButton({
  options: this.capsuleOptions,
  selectedIndexes: $filterIndexes,
  onItemClicked: (index: number): void => {
    this.loadDataByFilter(index)
  }
})
```

### 场景三：多选标签过滤

```typescript
@State tagIndexes: number[] = []

SegmentButton({
  options: this.multiOptions,
  selectedIndexes: $tagIndexes
})
// tagIndexes 变化时重新筛选数据
```

## 5. 数据结构

```typescript
// 文字按钮项
interface SegmentTextItem {
  text: ResourceStr
}

// 图标按钮项（icon 和 selectedIcon 必须同时设置）
interface SegmentIconItem {
  icon: ResourceStr
  selectedIcon: ResourceStr
}

// 图标+文字按钮项
interface SegmentIconTextItem {
  text: ResourceStr
  icon: ResourceStr
  selectedIcon: ResourceStr
}

// 页签类构造选项
interface TabSegmentConfig {
  buttons: ItemRestriction<SegmentButtonTextItem>
  backgroundColor?: ResourceColor
  selectedBackgroundColor?: ResourceColor
  fontSize?: number
  selectedFontSize?: number
}

// 胶囊类构造选项
interface CapsuleSegmentConfig {
  buttons: SegmentButtonItemTuple
  multiply?: boolean
  backgroundColor?: ResourceColor
  selectedBackgroundColor?: ResourceColor
}
```

## 6. 联动说明

- `selectedIndexes` 变化 → 页面内容区域/列表切换到对应 Tab
- 胶囊单选选中变化 → 重新加载筛选后的数据
- 胶囊多选选中变化 → 根据组合标签过滤列表
- 页签类仅支持单选，设置 `multiply: true` 不生效
- 按钮数量限制 2~5 个，超出 push 操作静默失败
- `onItemClicked`（API 13+）回调接收被点击选项下标，适合触发副作用操作

## 7. 完整代码示例

```typescript
import {
  SegmentButton,
  SegmentButtonOptions,
  SegmentButtonItemTuple,
  ItemRestriction,
  SegmentButtonTextItem
} from '@kit.ArkUI'

interface TaskItem {
  title: string
  status: string  // 'todo' | 'doing' | 'done'
}

@Entry
@Component
struct TaskFilterPage {
  @State filterOptions: SegmentButtonOptions = SegmentButtonOptions.capsule({
    buttons: [
      { text: '全部' },
      { text: '待办' },
      { text: '进行中' },
      { text: '已完成' }
    ] as SegmentButtonItemTuple,
    multiply: false
  })
  @State selectedIndexes: number[] = [0]

  private allTasks: TaskItem[] = [
    { title: '完成需求文档', status: 'done' },
    { title: '开发登录模块', status: 'doing' },
    { title: '编写单元测试', status: 'todo' },
    { title: '代码审查', status: 'todo' },
    { title: 'UI 适配', status: 'doing' }
  ]

  getFilteredTasks(): TaskItem[] {
    const index = this.selectedIndexes[0]
    if (index === 0) return this.allTasks
    const statusMap: string[] = ['', 'todo', 'doing', 'done']
    return this.allTasks.filter((t: TaskItem): boolean => t.status === statusMap[index])
  }

  build() {
    Column({ space: 16 }) {
      SegmentButton({
        options: this.filterOptions,
        selectedIndexes: $selectedIndexes
      })

      List({ space: 8 }) {
        ForEach(this.getFilteredTasks(), (task: TaskItem) => {
          ListItem() {
            Row() {
              Text(task.title)
                .fontSize(16)
                .layoutWeight(1)
              Text(task.status)
                .fontSize(12)
                .fontColor('#999')
            }
            .width('100%')
            .padding(16)
            .backgroundColor('#F5F5F5')
            .borderRadius(8)
          }
        }, (task: TaskItem): string => task.title)
      }
      .width('100%')
      .layoutWeight(1)
    }
    .width('100%')
    .height('100%')
    .padding(16)
  }
}
```

## 8. 反面示例

```typescript
// ❌ 按钮数量不在 2~5 范围内
SegmentButtonOptions.tab({
  buttons: [{ text: '仅一个' }] as ItemRestriction<SegmentButtonTextItem>
})

// ❌ selectedIndexes 未使用 $ 双向绑定语法
SegmentButton({
  options: this.tabOptions,
  selectedIndexes: this.tabSelectedIndexes  // 少了 $ 前缀，无法回写
})

// ❌ 图标按钮只设了 icon 没设 selectedIcon，图标不显示
SegmentButtonOptions.capsule({
  buttons: [
    { icon: $r('sys.media.ohos_ic_public_email') },  // 缺少 selectedIcon
    { icon: $r('sys.media.ohos_ic_public_email') }
  ] as SegmentButtonItemTuple
})

// ❌ 页签类设置 multiply: true 不生效，页签类只支持单选
SegmentButtonOptions.tab({
  buttons: [...],
  multiply: true  // tab 类型不支持此属性
})

// ❌ 使用扩展运算符创建选项（ArkTS 禁止 object spread）
const base = { fontSize: 14 }
SegmentButtonOptions.capsule({ ...base, buttons: [...] })
```

## 9. API 速查

| API | 说明 |
|-----|------|
| `SegmentButton({ options, selectedIndexes })` | 创建分段按钮，selectedIndexes 需 @Link 绑定 |
| `SegmentButtonOptions.tab({ buttons, ... })` | 创建页签类选项（仅支持文字按钮） |
| `SegmentButtonOptions.capsule({ buttons, multiply?, ... })` | 创建胶囊类选项（文字/图标/图标+文字） |
| `multiply` | 是否可多选（仅 capsule 类型），默认 false |
| `onItemClicked` | 按钮被点击时回调下标（API 13+） |
| `buttons` | 2~5 个按钮的元组，支持 push/pop/shift/unshift/splice 动态操作 |
| `SegmentButtonItemOptionsArray.create(tuple)` | 静态创建按钮信息数组 |
| `backgroundColor / selectedBackgroundColor` | 背景板颜色 / 选中态背景板颜色 |
| `fontColor / selectedFontColor` | 未选中 / 选中态文本颜色 |
| `fontSize / selectedFontSize` | 未选中 / 选中态字体大小 |
| `fontWeight / selectedFontWeight` | 未选中 / 选中态字体粗细 |
| `imageSize` | 图标尺寸，默认 { width: 24, height: 24 } |
| `direction` | 布局方向（API 12+），支持 RTL 镜像 |
| `backgroundBlurStyle` | 背景模糊材质 |
| `enableStateAnimation` | 修改 selectedIndexes 时是否开启切换动画（API 24+），默认 false |

> **注意**：分段按钮仅支持 2~5 个按钮。页签类只支持单选，胶囊类通过 `multiply` 控制单选/多选。`selectedIndexes` 必须使用 `$` 双向绑定语法。导入时需要从 `'@kit.ArkUI'` 引入 SegmentButton 及相关类型。
