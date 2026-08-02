# Input / Focus / Keyboard 输入焦点键盘模式

## 什么时候使用

当用户提到以下需求时优先读本文件：

- `TextInput`、`TextArea`、`Search`、`Select`
- 输入限制、验证码输入框、默认选中、错误提示、下划线颜色
- 获取焦点、失焦、点击外部收起键盘、软键盘避让
- 修改数据后光标位置重置、子组件输入变化监听
- 自定义键盘、键盘删除事件、Search 键盘沉浸式样式

来源示例：

- 《TextInput限制输入》
- 《TextInput修改数据后光标位置重置》
- 《TextInput、RichEditor、TextArea避让软键盘》
- 《如何解决点击Select下拉菜单会导致TextInput失焦的问题》
- 检索更多：`node scripts/search-practices.mjs "TextInput 软键盘"`

## 状态拆分

输入组件至少拆四类状态：

```ts
@State value: string = '';
@State focused: boolean = false;
@State errorText: string = '';
@State keyboardVisible: boolean = false;
```

不要把“显示值、校验状态、焦点状态、键盘状态”塞进一个字符串或一个布尔值里。

## TextInput / TextArea

基本结构：

```ts
TextInput({ text: this.value, placeholder: '请输入' })
  .onChange((value: string) => {
    this.value = value;
    this.errorText = this.validate(value);
  })
  .onFocus(() => {
    this.focused = true;
  })
  .onBlur(() => {
    this.focused = false;
  })
```

实践要点：

- 输入限制放在 `onChange` 的归一化逻辑里，避免 UI 展示值和真实值分裂。
- 子组件里有 TextInput 时，用 `@Link` 或回调把 value 传回父组件；不要让父子各持一份输入值。
- 修改绑定数据后光标重置，常见原因是父组件每次渲染都重写 text；应减少不必要的 value 覆盖。
- 密码模式图标、错误文本、下划线颜色属于输入框视觉状态，最好由 `focused/error/disabled` 推导。

## 焦点与键盘

焦点问题先画事件顺序：

1. 用户点击输入框。
2. 输入框获得焦点。
3. 软键盘弹出或保持隐藏。
4. 输入值变化。
5. 用户点击外部或提交。
6. 输入框失焦，必要时收起键盘。

实践要点：

- 用 `onFocus`/`onBlur` 更新焦点态，不要只靠点击事件猜。
- 点击外部收起键盘时，外层容器负责“取消焦点”；输入框自己只响应焦点变化。
- 需要获取焦点但不拉起键盘时，要确认系统版本和输入组件能力，再选择禁用软键盘或延迟请求焦点的方案。
- 软键盘避让要按页面结构处理：表单页、弹窗、半模态、列表内输入框的策略不同。

## Select 与输入框组合

点击 Select 后 TextInput 失焦并不一定是 bug；它可能符合焦点转移语义。需要保留输入态时：

- 把输入值和下拉选择值分开。
- 把 Select 弹层开关状态单独保存。
- 不要在 `onBlur` 里立即清空输入或提交表单。
- 如果业务必须保持输入框焦点，显式管理焦点恢复时机。

## 验证码输入框

推荐结构：

- 外层维护完整字符串。
- 每个格子只是显示切片。
- 输入事件集中处理粘贴、删除、长度限制。
- 光标或高亮格由 `value.length` 推导。

不要创建多个互相抢焦点的 TextInput，除非项目明确需要真实多输入框。

## 常见坑

- `onChange` 中异步写回旧值，会导致光标跳动或输入回退。
- 输入限制只限制显示不限制状态，会导致提交值和界面不一致。
- 点击外部收起键盘时，如果外层也触发表单提交，会出现“输入后立刻丢失”的错觉。
- ForEach 嵌套 TextArea 时，key 不稳定会导致输入后组件重建、键盘收起。

## 回答用户时应包含

1. value、focus、keyboard、error 分别由谁持有。
2. 输入、校验、提交、失焦的事件顺序。
3. 需要兼容的容器：页面、弹窗、半模态或列表。
4. 一个最小 ArkTS 骨架，并指出光标/键盘相关坑。
