# Picker / Select / Menu 选择器菜单模式

## 什么时候使用

当用户提到以下需求时读本文件：

- `Select` 下拉菜单、自定义按钮样式和内容
- `Menu` 弹出菜单、上下文菜单
- `DatePicker`、`TimePicker`、`TextPicker`
- `PatternLock` 图案锁或手势密码

如果问题是 Select 导致 TextInput 失焦，优先读 `input-focus-keyboard-patterns.md`。

来源示例：

- 《Select如何自定义按钮样式和内容》
- DatePicker、TimePicker、TextPicker 选择器类文章
- PatternLock 低频交互文章
- 检索更多：`node scripts/search-practices.mjs TextPicker`

## 组件判断

| 需求 | 组件 |
|---|---|
| 少量固定选项 | `Select` |
| 操作命令列表 | `Menu` |
| 日期 | `DatePicker` |
| 时间 | `TimePicker` |
| 文本滚轮选择 | `TextPicker` |
| 手势密码 | `PatternLock` |

## 状态模型

```ts
@State selectedValue: string = '';
@State menuOpen: boolean = false;
@State pickerValue: Date = new Date();
```

选择器状态要区分“当前选中值”和“弹层是否打开”。如果选择后还要提交表单，提交态单独维护。

## Select / Menu

- Select 展示文案可由选中值推导，不要保存两份。
- 自定义 Select 按钮时，按钮样式、菜单项样式、禁用态要统一。
- Menu 用于命令时，菜单项回调应只派发命令，不直接塞大量业务逻辑。
- 菜单关闭、选择提交、焦点恢复是三个事件，不要混成一个回调。

## Picker

Picker 类组件先定义数据模型：

```ts
interface PickerOption {
  value: string;
  label: string;
}
```

实践要点：

- TextPicker 展示 label，业务保存 value。
- 日期/时间要明确时区、格式化和最小/最大值。
- 选择器弹窗里先暂存草稿值，用户确认后再写入业务状态。

## PatternLock

- 图案锁是手势输入，不是普通密码输入。
- 需要区分设置、确认、验证三种模式。
- 错误次数、重试间隔、清空手势轨迹要由状态驱动。

## 常见坑

- Select 与 TextInput 混用时，失焦可能是正常焦点转移；不要在 blur 中清空用户输入。
- Picker 值和展示文案重复存储会导致切换语言或数据刷新后不一致。
- 菜单项动态变化时，选中值可能已经不存在，要做回退。

## 回答用户时应包含

1. 这是值选择、命令菜单，还是手势验证。
2. 选中值、弹层开关、草稿值如何拆分。
3. 确认/取消/失焦/提交的事件边界。
4. 数据刷新后如何校正选中值。
