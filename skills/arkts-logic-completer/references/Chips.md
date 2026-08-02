# Chips 操作块/标签组功能逻辑规格

## 1. 功能定位

Chips 是操作块组件（含 Chip 单个标签和 ChipGroup 标签组），用于搜索历史、标签筛选、属性选择等场景，支持单选/多选及可删除标签。

## 2. 典型场景

- 搜索页面的历史搜索标签（可删除）
- 商品筛选页的属性选择（颜色、尺码，单选/多选）
- 邮件发送页的收件人标签列表
- 内容分类标签（文章标签、文件类型筛选）

## 3. 状态声明

```typescript
import { Chip, ChipSize, ChipGroup } from '@kit.ArkUI'

// 单个 Chip 激活态
@State isChipActivated: boolean = false

// ChipGroup 选中索引
@State selectedIndexes: number[] = [0]

// 标签数据列表
@State chipLabels: ChipLabelItem[] = [
  { text: '全部' },
  { text: '美食' },
  { text: '旅行' },
  { text: '科技' }
]
```

装饰器选择：
- `@State`：标签组的选中状态
- `@Prop`：从父组件接收标签列表
- `@Link`：父子双向同步选中项

## 4. 事件与交互逻辑

### Chip 的 onClicked 和 onClose

```typescript
Chip({
  label: { text: '标签文字' },
  activated: this.isChipActivated,
  allowClose: true,
  onClicked: (): void => {
    this.isChipActivated = !this.isChipActivated
  },
  onClose: (): void => {
    this.removeChip()
  }
})
```

### ChipGroup 的 onChange

```typescript
ChipGroup({
  items: this.getChipGroupItems(),
  selectedIndexes: this.selectedIndexes,
  multiple: false,
  onChange: (indexes: number[]): void => {
    this.selectedIndexes = indexes
    this.onCategoryChange(indexes)
  }
})
```

## 5. 数据结构

```typescript
interface ChipLabelItem {
  text: string
  icon?: Resource
  closable?: boolean
}

interface FilterCategory {
  title: string
  chips: ChipLabelItem[]
  selectedIndexes: number[]
  multiple: boolean
}
```

## 6. 联动说明

- ChipGroup 选中变化 → 触发列表数据筛选/刷新
- Chip 关闭（onClose） → 从数据源中移除该标签，UI 更新
- 多选模式下全选/反选 → 批量更新 selectedIndexes
- 搜索关键词输入 → 动态增加 Chip 标签

## 7. 完整代码示例

```typescript
import { ChipSize, ChipGroup } from '@kit.ArkUI'

interface ChipLabelItem {
  text: string
}

@Entry
@Component
struct ChipsFilterDemo {
  @State categories: ChipLabelItem[] = [
    { text: '全部' },
    { text: '美食' },
    { text: '旅行' },
    { text: '科技' },
    { text: '音乐' },
    { text: '电影' }
  ]
  @State selectedIndexes: number[] = [0]
  @State currentCategory: string = '全部'

  build() {
    Column() {
      ChipGroup({
        items: this.categories.map((item: ChipLabelItem): object => {
          let result: object = { label: { text: item.text } } as object
          return result
        }),
        itemStyle: {
          size: ChipSize.NORMAL,
          backgroundColor: $r('sys.color.ohos_id_color_button_normal'),
          fontColor: $r('sys.color.ohos_id_color_text_primary'),
          selectedBackgroundColor: $r('sys.color.ohos_id_color_emphasize'),
          selectedFontColor: $r('sys.color.ohos_id_color_text_primary_contrary')
        },
        selectedIndexes: this.selectedIndexes,
        multiple: false,
        chipGroupSpace: { itemSpace: 8, startSpace: 16, endSpace: 16 },
        onChange: (indexes: number[]): void => {
          this.selectedIndexes = indexes
          if (indexes.length > 0) {
            this.currentCategory = this.categories[indexes[0]].text
          }
        }
      })

      Text('当前筛选: ' + this.currentCategory)
        .fontSize(16)
        .margin({ top: 20 })
        .padding(16)

      List() {
        ForEach(this.getMockData(), (item: string) => {
          ListItem() {
            Text(item)
              .width('100%')
              .padding(16)
              .borderRadius(8)
              .backgroundColor('#F5F5F5')
          }
          .margin({ bottom: 8, left: 16, right: 16 })
        })
      }
      .layoutWeight(1)
    }
    .width('100%')
    .height('100%')
  }

  getMockData(): string[] {
    if (this.currentCategory === '全部') {
      return ['美食推荐', '旅行攻略', '科技资讯', '音乐推荐']
    }
    return [this.currentCategory + '内容 1', this.currentCategory + '内容 2']
  }
}
```

## 8. 反面示例

```typescript
// ❌ ChipGroup 的 selectedIndexes 没有用 @State，选中不会响应式更新
let selectedIndexes = [0]
ChipGroup({ selectedIndexes: selectedIndexes })

// ❌ 单选模式下初始 selectedIndexes 传了多个索引，只有第一个生效
ChipGroup({ multiple: false, selectedIndexes: [0, 1, 2] })

// ❌ 用对象展开运算符构造 ChipGroupItemOptions（ArkTS 不支持）
// let newItem = { ...oldItem, label: { text: 'new' } }

// ❌ 没有处理 onChange 回调，选中状态不与业务数据同步
ChipGroup({
  items: [...],
  selectedIndexes: this.selectedIndexes
  // 缺少 onChange
})
```

## 9. API 速查

| API | 说明 |
|-----|------|
| `Chip({ label, prefixIcon?, suffixIcon?, activated?, allowClose?, onClicked?, onClose? })` | 创建单个操作块 |
| `ChipGroup({ items, itemStyle?, selectedIndexes?, multiple?, onChange? })` | 创建操作块群组 |
| `ChipSize.NORMAL / ChipSize.SMALL` | 操作块尺寸 |
| `.activated` | Chip 激活态（boolean） |
| `.allowClose` | 是否显示关闭图标 |
| `.onClicked` | Chip 点击回调 |
| `.onClose` | 关闭图标点击回调 |
| `ChipGroup.onChange` | 选中索引变化回调 `Callback<Array<number>>` |
| `ChipGroup.multiple` | 是否多选（默认 false） |
| `ChipGroup.chipGroupSpace` | 左右内边距及 Chip 间距 |
| `IconGroupSuffix({ items })` | ChipGroup 右侧自定义后缀组件 |
| `import { Chip, ChipSize, ChipGroup } from '@kit.ArkUI'` | 导入模块 |
