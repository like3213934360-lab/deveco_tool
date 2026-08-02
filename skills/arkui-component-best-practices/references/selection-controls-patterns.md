# Selection / Button 选择与按钮控件模式

## 什么时候使用

当用户提到以下需求时读本文件：

- `Checkbox` 多选、反选、全选、样式修改
- `Radio` 单选、互斥选项
- `Toggle` 开关状态
- `Button`、`SaveButton`、`DownloadFileButton` 点击、状态样式、安全按钮

来源示例：

- 《Checkbox多选、反选、全选场景实现方案》
- 《Checkbox更改样式》
- 《Select如何自定义按钮样式和内容》
- 检索更多：`node scripts/search-practices.mjs Checkbox`

## 状态模型

选择控件不要把 UI 是否选中散落在每个 item 组件里。推荐外层持有选择集合：

```ts
@State selectedIds: string[] = [];

isSelected(id: string): boolean {
  return this.selectedIds.includes(id);
}
```

多选操作拆成：

- 单项切换：`toggleOne(id)`
- 全选：`selectAll()`
- 清空：`clearAll()`
- 反选：`invertSelection()`

## Checkbox 多选骨架

```ts
ForEach(this.items, (item: OptionItem) => {
  Row({ space: 8 }) {
    Checkbox()
      .select(this.isSelected(item.id))
      .onChange((checked: boolean) => {
        this.toggleOne(item.id, checked);
      })

    Text(item.label)
      .layoutWeight(1)
  }
  .width('100%')
}, (item: OptionItem) => item.id)
```

## Radio / Toggle / Button

- Radio 用单个 `selectedId`，不要用多个布尔值。
- Toggle 用布尔状态，但业务提交时要映射成明确枚举或配置项。
- Button 点击后涉及异步提交时，至少拆出 `loading` 和 `disabled`，避免重复提交。
- SaveButton/DownloadFileButton 属于系统安全相关按钮，先确认使用约束，再封装业务回调。

## 常见坑

- 全选状态应由 `selectedIds.length === items.length` 推导，不要再单独维护一个可能失真的 `allChecked`。
- 列表数据变化后，要清理不存在的已选 id。
- Checkbox 样式修改不要牺牲可点击区域；视觉图标和真实控件状态要一致。
- Button 禁用态、加载态、点击态要有清晰优先级：`disabled` 通常高于 `loading`，`loading` 高于普通点击。

## 回答用户时应包含

1. 单选、多选、布尔开关还是按钮命令。
2. 状态由父组件还是子组件持有。
3. 全选/反选/禁用/加载态如何推导。
4. 列表 key 和点击区域如何保持稳定。
