# CheckboxGroup 组件功能逻辑规格

## 1. 功能定位

CheckboxGroup 是多选框群组组件，用于控制同组 Checkbox 的全选或取消全选状态。当界面需要提供批量选择能力（如列表全选、权限批量勾选）时使用。

## 2. 典型场景

- 列表页顶部的"全选"按钮，勾选后所有列表项被选中
- 权限管理页面中按类别全选权限
- 购物车中全选商品进行结算
- 任务清单批量标记完成

## 3. 状态声明

```typescript
// 全选状态
@State isSelectAll: boolean = false

// 选项列表（数据驱动）
@State items: CheckItem[] = [
  { name: 'item1', label: '选项一', isChecked: false },
  { name: 'item2', label: '选项二', isChecked: false },
  { name: 'item3', label: '选项三', isChecked: false }
]
```

## 4. 事件与交互逻辑

### onChange 核心事件

CheckboxGroup 的 onChange 返回 `CheckboxGroupResult`，包含选中项名称列表和选中状态：

```typescript
CheckboxGroup({ group: 'myGroup' })
  .onChange((result: CheckboxGroupResult): void => {
    // result.name: 被选中的 Checkbox 名称数组
    // result.status: SelectStatus.All | Part | None
    if (result.status === SelectStatus.All) {
      this.isSelectAll = true
    } else if (result.status === SelectStatus.None) {
      this.isSelectAll = false
    }
  })
```

### 与 Checkbox 配合

```typescript
Checkbox({ name: 'item1', group: 'myGroup' })
  .select(this.items[0].isChecked)
  .onChange((value: boolean): void => {
    this.items[0].isChecked = value
    this.isSelectAll = this.items.every((item: CheckItem): boolean => item.isChecked)
  })
```

## 5. 数据结构

```typescript
interface CheckItem {
  name: string
  label: string
  isChecked: boolean
  disabled?: boolean
}
```

## 6. 联动说明

- CheckboxGroup 全选 → 所有同组 Checkbox 变为选中
- CheckboxGroup 取消全选 → 所有同组 Checkbox 取消选中
- 单个 Checkbox 变化 → CheckboxGroup 自动计算状态（All / Part / None）
- 结合 LazyForEach 使用时，未创建的 Checkbox 选中状态需手动控制

## 7. 完整代码示例

```typescript
interface CheckItem {
  name: string
  label: string
  isChecked: boolean
}

@Entry
@Component
struct BatchSelectPage {
  @State isSelectAll: boolean = false
  @State items: CheckItem[] = [
    { name: 'apple', label: '苹果', isChecked: false },
    { name: 'banana', label: '香蕉', isChecked: false },
    { name: 'orange', label: '橙子', isChecked: false }
  ]

  updateSelectAll(): void {
    this.isSelectAll = this.items.every((item: CheckItem): boolean => item.isChecked)
  }

  build() {
    Column({ space: 12 }) {
      Row() {
        CheckboxGroup({ group: 'fruitGroup' })
          .selectAll(this.isSelectAll)
          .selectedColor('#007DFF')
          .onChange((result: CheckboxGroupResult): void => {
            if (result.status === SelectStatus.All) {
              this.isSelectAll = true
            } else if (result.status === SelectStatus.None) {
              this.isSelectAll = false
            }
          })
        Text('全选')
          .fontSize(16)
          .fontWeight(FontWeight.Medium)
      }
      .width('100%')
      .padding(16)

      ForEach(this.items, (item: CheckItem, index: number) => {
        Row() {
          Checkbox({ name: item.name, group: 'fruitGroup' })
            .select(item.isChecked)
            .selectedColor('#007DFF')
            .onChange((value: boolean): void => {
              this.items[index] = {
                name: item.name,
                label: item.label,
                isChecked: value
              }
              this.updateSelectAll()
            })
          Text(item.label)
            .fontSize(14)
        }
        .width('100%')
        .padding({ left: 32, top: 8, bottom: 8 })
      })

      Text(`已选 ${this.items.filter((item: CheckItem): boolean => item.isChecked).length} / ${this.items.length}`)
        .fontSize(14)
        .fontColor('#999999')
        .padding(16)
    }
  }
}
```

## 8. 反面示例

```typescript
// ❌ CheckboxGroup 和 Checkbox 的 group 名称不一致，无法联动
CheckboxGroup({ group: 'groupA' })
Checkbox({ name: 'item1', group: 'groupB' })

// ❌ 没有 onChange 处理，全选状态无法同步
CheckboxGroup({ group: 'myGroup' })

// ❌ LazyForEach 场景下没有手动管理未创建 Checkbox 的选中状态
// 只有可见的 Checkbox 被选中，滚出屏幕的恢复为未选中

// ❌ 用对象展开更新数组项（ArkTS 禁止）
this.items[index] = { ...item, isChecked: value }
```

## 9. API 速查

| API | 说明 |
|-----|------|
| `CheckboxGroup({ group?: string })` | 创建多选框群组，group 用于关联同组 Checkbox |
| `.selectAll(boolean)` | 设置是否全选，支持 $$ 双向绑定（API 10+） |
| `.selectedColor(ResourceColor)` | 被选中或部分选中状态的颜色 |
| `.unselectedColor(ResourceColor)` | 非选中状态边框颜色（API 10+） |
| `.mark(MarkStyle)` | 内部图标样式（API 10+） |
| `.checkboxShape(CheckBoxShape)` | 组件形状：CIRCLE / ROUNDED_SQUARE（API 12+） |
| `.onChange((result: CheckboxGroupResult) => void)` | 选中状态变化回调，返回 name 数组和 SelectStatus |
| `SelectStatus.All / Part / None` | 全选 / 部分选中 / 全不选 |
