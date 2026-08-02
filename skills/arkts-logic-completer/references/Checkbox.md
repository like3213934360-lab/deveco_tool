# Checkbox 组件功能逻辑规格

## 1. 功能定位

Checkbox 是多选框组件，用于在一组选项中进行多项选择。当界面需要用户勾选一个或多个选项时使用。配合 CheckboxGroup 可实现全选/反选功能。

> **注意**：API 11 起 Checkbox 默认样式由圆角方形变为圆形。如需圆角方形，需显式设置 `.shape(CheckBoxShape.ROUNDED_SQUARE)`。

## 2. 典型场景

- 协议同意确认（单个 Checkbox + 文字说明）
- 多选列表（批量删除、批量操作）
- 表单多选项（兴趣爱好、标签选择）
- 带全选功能的列表管理

## 3. 状态声明

```typescript
// 单个勾选（协议同意）
@State isAgreed: boolean = false

// 多选列表
@State checkItems: CheckItem[] = [
  { id: '1', label: '选项A', checked: false },
  { id: '2', label: '选项B', checked: false },
  { id: '3', label: '选项C', checked: false }
]
@State isAllChecked: boolean = false

// 批量操作场景
@State isSelectMode: boolean = false
@State selectedIds: string[] = []
```

## 4. 事件与交互逻辑

### Checkbox onChange

```typescript
Checkbox({ name: 'agree', group: 'formGroup' })
  .select(this.isAgreed)
  .onChange((checked: boolean): void => {
    this.isAgreed = checked
  })
```

### CheckboxGroup onSelectAll（全选联动）

```typescript
// 全选框
CheckboxGroup({ group: 'listGroup' })
  .selectAll(this.isAllChecked)
  .onChange((event: CheckboxGroupResult): void => {
    this.isAllChecked = event.status === SelectStatus.All
    // 同步更新子项状态
    this.checkItems.forEach((item: CheckItem): void => {
      item.checked = this.isAllChecked
    })
  })

// 子项
ForEach(this.checkItems, (item: CheckItem): void => {
  Checkbox({ name: item.id, group: 'listGroup' })
    .select(item.checked)
    .onChange((checked: boolean): void => {
      item.checked = checked
      // 反向同步全选状态
      this.isAllChecked = this.checkItems.every((i: CheckItem): boolean => i.checked)
    })
})
```

## 5. 数据结构

```typescript
// 多选项数据模型
interface CheckItem {
  id: string
  label: string
  checked: boolean
  disabled?: boolean
}

// CheckboxGroup 回调结果
// SelectStatus: All | Part | None
interface CheckboxGroupResult {
  name: string[]     // 被选中的 Checkbox 的 name 列表
  status: SelectStatus
}
```

## 6. 联动说明

- 单个 Checkbox 变化 → 更新全选框状态（全选/部分/无）
- 全选框点击 → 所有子项同步选中/取消
- 选中项变化 → 更新底部操作栏（"已选 N 项" + 操作按钮）
- 协议 Checkbox 未勾选 → 提交按钮置灰不可点击
- 选中项列表 → 传递给批量操作接口

## 7. 完整代码示例

```typescript
interface TaskItem {
  id: string
  title: string
  checked: boolean
}

@Entry
@Component
struct TaskListPage {
  @State tasks: TaskItem[] = [
    { id: '1', title: '完成项目文档', checked: false },
    { id: '2', title: '代码审查', checked: false },
    { id: '3', title: '更新测试用例', checked: false },
    { id: '4', title: '部署上线', checked: false }
  ]
  @State isAllChecked: boolean = false

  private cloneTask(t: TaskItem, checked: boolean): TaskItem {
    const item: TaskItem = { id: t.id, title: t.title, checked: checked }
    return item
  }

  getCheckedCount(): number {
    return this.tasks.filter((t: TaskItem): boolean => t.checked).length
  }

  updateAllCheckedState(): void {
    this.isAllChecked = this.tasks.length > 0 && this.tasks.every((t: TaskItem): boolean => t.checked)
  }

  toggleAll(selectAll: boolean): void {
    this.tasks = this.tasks.map((t: TaskItem): TaskItem => this.cloneTask(t, selectAll))
    this.isAllChecked = selectAll
  }

  deleteChecked(): void {
    this.tasks = this.tasks.filter((t: TaskItem): boolean => !t.checked)
    this.isAllChecked = false
  }

  build() {
    Column() {
      // 全选栏
      Row() {
        Checkbox()
          .select(this.isAllChecked)
          .onChange((checked: boolean): void => {
            this.toggleAll(checked)
          })
        Text('全选')
          .margin({ left: 8 })
        Blank()
        Text(`已选 ${this.getCheckedCount()} 项`)
          .fontColor('#999')
      }
      .width('100%')
      .padding(16)

      // 任务列表
      List({ space: 1 }) {
        ForEach(this.tasks, (item: TaskItem): void => {
          ListItem() {
            Row() {
              Checkbox()
                .select(item.checked)
                .onChange((checked: boolean): void => {
                  const index = this.tasks.findIndex((t: TaskItem): boolean => t.id === item.id)
                  if (index >= 0) {
                    this.tasks[index] = this.cloneTask(item, checked)
                    this.updateAllCheckedState()
                  }
                })
              Text(item.title)
                .margin({ left: 12 })
                .decoration(item.checked
                  ? { type: TextDecorationType.LineThrough, color: '#999' }
                  : { type: TextDecorationType.None })
            }
            .width('100%')
            .padding(16)
          }
        }, (item: TaskItem): string => item.id)
      }
      .layoutWeight(1)

      // 底部操作栏（有选中项时显示）
      if (this.getCheckedCount() > 0) {
        Row() {
          Button('删除已选')
            .backgroundColor(Color.Red)
            .fontColor(Color.White)
            .onClick((): void => {
              this.deleteChecked()
            })
        }
        .width('100%')
        .padding(16)
        .justifyContent(FlexAlign.Center)
      }
    }
    .width('100%')
    .height('100%')
  }
}
```

## LazyForEach 全选陷阱

当 Checkbox 列表使用 LazyForEach（懒加载）渲染时，屏幕外的 Checkbox 未被创建，`CheckboxGroup.selectAll(true)` 只会选中已创建的项，未创建的不会被选中。

**正确做法**：不依赖 CheckboxGroup 的 selectAll 自动联动，而是手动管理数据源中每项的 `checked` 状态：

```typescript
// 全选按钮点击时，直接修改数据源
this.isSelectAll = !this.isSelectAll
this.dataSource.forEach((item: DataItem): void => { item.isCheck = this.isSelectAll })
// 通知 LazyForEach 数据变化
this.dataSource.notifyDataReload()
```

使用 ForEach（全量渲染）的短列表不受此限制，但超过 50 项的列表建议用 LazyForEach 并手动管理选中状态。

## 8. 反面示例

```typescript
// ❌ Checkbox 没有 select 绑定，勾选状态不受控
Checkbox()

// ❌ 有全选但没有和子项联动
CheckboxGroup({ group: 'g1' })
  .selectAll(true)
// 子项没有设置 group，全选不生效

// ❌ 子项变化没有反向更新全选状态
Checkbox()
  .onChange((checked) => {
    item.checked = checked
    // 缺少：this.isAllChecked = this.items.every(...)
  })

// ❌ 协议 Checkbox 没有和提交按钮联动
Checkbox().select(this.isAgreed).onChange(...)
Button('提交').onClick(() => this.submit())  // 没有判断 isAgreed
```

## 9. API 速查

| API | 说明 |
|-----|------|
| `Checkbox({ name?, group?, indicatorBuilder? })` | 创建多选框，indicatorBuilder 可自定义选中样式（API 12+） |
| `.select(boolean)` | 设置选中状态（支持 $$ 双向绑定） |
| `.shape(CheckBoxShape)` | 形状：CIRCLE（默认，API 11+）/ ROUNDED_SQUARE |
| `.selectedColor(color)` | 选中态颜色 |
| `.unselectedColor(color)` | 未选中态边框颜色（API 10+） |
| `.mark(MarkStyle)` | 自定义对勾样式：strokeColor / strokeWidth / size（API 10+） |
| `.onChange((checked: boolean) => void)` | 选中状态变化回调 |
| `CheckboxGroup({ group: string })` | 多选框组（全选控制） |
| `.selectAll(boolean)` | 是否全选 |
| `.checkboxShape(CheckBoxShape)` | 组内多选框形状 |
| `.onChange((event: CheckboxGroupResult) => void)` | 组选中状态变化 |
