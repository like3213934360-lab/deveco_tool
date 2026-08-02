# Slider / Progress 反馈与数值控件模式

## 什么时候使用

当用户提到以下需求时读本文件：

- `Slider` 滑块、分段、范围、拖动同步
- `Progress` 进度条、加载进度、环形进度
- `DataPanel` 数据占比展示
- `Rating` 星级评分
- `Badge` 角标、红点、未读数

来源示例：

- Slider 拖动、样式和数值同步类文章
- Progress 展示和状态反馈类文章
- DataPanel、Rating、Badge 低频反馈组件文章
- 检索更多：`node scripts/search-practices.mjs Slider`

## 组件判断

| 需求 | 组件 |
|---|---|
| 用户可拖动改变数值 | `Slider` |
| 只展示任务进度 | `Progress` |
| 多段占比或仪表盘 | `DataPanel` |
| 星级打分 | `Rating` |
| 未读数、红点、角标 | `Badge` |

## 状态模型

```ts
@State value: number = 0;
@State dragging: boolean = false;
@State submitting: boolean = false;
```

对可拖动数值，区分“拖动中的临时值”和“提交后的业务值”。频繁拖动时不要每一帧都请求接口。

## Slider 骨架

```ts
Slider({
  value: this.value,
  min: 0,
  max: 100,
  step: 1
})
  .onChange((value: number, mode: SliderChangeMode) => {
    this.value = value;
    if (mode === SliderChangeMode.End) {
      this.commitValue(value);
    }
  })
```

## Progress / Badge

- Progress 值应限制在合法范围内，例如 0 到 100。
- 加载失败、暂停、完成不要只靠颜色表达，最好有文本或状态辅助。
- Badge 未读数超过上限时统一格式，如 `99+`。
- Badge 放在图标右上角时，优先用稳定容器尺寸，避免数字变化撑动布局。

## 常见坑

- Slider `onChange` 中直接做重任务会拖慢手势；提交动作放到结束态。
- Progress 进度来自异步任务时，要处理任务取消和组件销毁后的回写。
- DataPanel 百分比总和不等于 100 时，先决定是归一化还是展示原始值。
- Rating 和业务评分通常需要半星、只读、可编辑三种模式，不要混成一个布尔值。

## 回答用户时应包含

1. 这是输入型数值控件还是展示型反馈控件。
2. 数值范围、步长、格式化方式。
3. 拖动中和提交后的状态边界。
4. 异步更新、取消、越界值的处理。
