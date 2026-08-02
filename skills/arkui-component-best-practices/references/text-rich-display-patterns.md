# Text / Span / RichText 文本展示模式

## 什么时候使用

用户提到这些问题时读本文件：

- `Text` 换行、省略、无限长不换行、垂直文字
- `Span`、`ImageSpan`、`RichText` 图文混排或局部样式
- 文本在 Row/Column/Stack 中溢出、对齐、四角分布
- `TextTimer` 倒计时/计时文本

图片资源读 `image-resource-fit-patterns.md`；视频读 `video-playback-fullscreen-patterns.md`。

## 状态模型

```ts
@State title: string = '';
@State expanded: boolean = false;
@State remainingSeconds: number = 0;
```

文本展示状态通常是内容、展开态、计时值。不要让布局状态藏在字符串里。

## 常用骨架

```ts
Text(this.title)
  .width('100%')
  .maxLines(this.expanded ? undefined : 2)
  .textOverflow({ overflow: TextOverflow.Ellipsis })
```

Row 中的文本要给剩余空间：

```ts
Row({ space: 8 }) {
  Text(this.title)
    .layoutWeight(1)
    .maxLines(1)
    .textOverflow({ overflow: TextOverflow.Ellipsis })
}
.width('100%')
```

## 实践要点

- Text 溢出先查父容器宽度，再查 `maxLines` 和 `textOverflow`。
- Row 里左图右文时，文本要用 `layoutWeight(1)` 或明确宽度。
- 富文本或局部样式优先考虑 Span/RichText，不要拆成多个 Text 后硬凑基线。
- 文本覆盖角标或四角分布，通常要配合 Stack。
- 计时文本要处理页面销毁、暂停和恢复，避免定时器继续回写。

## 常见坑

- 只设置 `textOverflow` 不设置行数或宽度，省略不生效。
- 超长英文/数字不换行时，需要明确业务是滚动、截断还是缩放。
- RichText 内容来自外部时，先考虑安全和可控样式范围。
- TextTimer 和业务倒计时混用时，要明确谁是时间源。

## 回答用户时应包含

1. 文本是单行、多行、富文本、计时还是覆盖布局。
2. 父容器宽度和行数约束。
3. 展开/收起或计时状态。
4. Text 与 Row/Column/Stack 的组合理由。
