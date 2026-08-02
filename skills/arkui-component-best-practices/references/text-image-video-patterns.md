# Text / Row / Column / Image / Video 原子组件模式

这是旧的大类概览入口。具体问题优先读取：

- `text-rich-display-patterns.md`：Text、Span、RichText、TextTimer、文本溢出。
- `image-resource-fit-patterns.md`：Image、SVG、本地/网络资源、objectFit、裁剪。
- `video-playback-fullscreen-patterns.md`：Video、播放进度、控制栏、全屏横竖屏。

## 什么时候使用

本 skill 的“原子组件”只包括：

- `Text`
- `Row`
- `Column`
- `Image`
- `Video`

当用户问文字、横纵布局、图片或视频的基础展示问题时读本文件。复杂列表、导航、输入类问题请转到对应 reference。

来源示例：

- 《Text组件如何实现文字垂直方向显示效果》
- 《实现Text文本无限长不换行》
- 《Image组件加载SVG图片异常》
- 《Video组件实现横竖屏切换和全屏播放》
- 检索更多：`node scripts/search-practices.mjs Text`、`Image`、`Video`

## Text

先判断需求是“文字内容”还是“布局效果”：

- 单行省略：限制 `maxLines(1)` 并设置 `textOverflow`。
- 多行展示：给父容器明确宽度，避免 Text 自己把布局撑开。
- 不换行长文本：确认是否真的要横向滚动，还是应该省略。
- 图文混排或局部样式：优先考虑 `Span`/富文本能力，不要拆成多个 Text 后再硬凑对齐。

骨架：

```ts
Text(this.title)
  .width('100%')
  .maxLines(1)
  .textOverflow({ overflow: TextOverflow.Ellipsis })
```

常见坑：

- Text 溢出通常不是 Text 单独的问题，而是父容器宽度、Row 的剩余空间或 `layoutWeight` 没定。
- 垂直文字、四角分布、覆盖角标这类视觉布局，通常要和 `Column`、`Row` 或 `Stack` 配合。

## Row / Column

`Row` 和 `Column` 只做基础排布，不负责业务状态。

实践要点：

- Row 用于横向主轴，Column 用于纵向主轴。
- 先确定主轴对齐，再确定交叉轴对齐。
- 宽高、间距和伸缩策略要显式；不要让子组件内容长度决定整体工具栏高度。
- 在列表项、卡片、工具栏中使用 Row/Column 时，给图标、按钮、文本设置稳定尺寸，避免 hover/选中态引起布局跳动。

骨架：

```ts
Row({ space: 8 }) {
  Image($r('app.media.icon'))
    .width(24)
    .height(24)

  Text(this.title)
    .layoutWeight(1)
    .maxLines(1)
    .textOverflow({ overflow: TextOverflow.Ellipsis })
}
.width('100%')
.alignItems(VerticalAlign.Center)
```

## Image

图片问题先确认资源来源：

- 本地资源：`$r('app.media.xxx')`
- 网络资源：URL 可访问性、权限、占位和失败态
- SVG：兼容性、特殊字符、尺寸和填充策略
- 用户图片：EXIF 方向、裁剪、圆角、点击区域

实践要点：

- 固定展示框时，明确 `width`、`height`、`objectFit`。
- 图片看起来变成正方形，多半是父容器或固定宽高约束导致。
- 按宽度填充但高度被裁剪，要检查 `objectFit` 和父容器高度。
- 颜色变换用 `colorFilter`/颜色矩阵时，要把原图和目标色都作为可调参数。

骨架：

```ts
Image(this.image)
  .width('100%')
  .height(180)
  .objectFit(ImageFit.Cover)
  .borderRadius(8)
```

## Video

视频问题先区分：播放源、控制栏、进度、全屏、横竖屏、预览。

实践要点：

- 播放状态、当前进度、总时长、是否全屏要拆成独立状态。
- 自定义控制栏不要直接散在 `Video` 周围；封装为一个控制组件更容易复用。
- 预览黑屏时，先检查首帧/封面图/播放前占位，而不是只改播放器尺寸。
- 全屏和横竖屏切换要同步处理页面布局、状态栏、安全区域和返回行为。
- 半模态或容器尺寸变化时，Video 尺寸应跟随外层状态，而不是写死。

骨架：

```ts
Column() {
  Video({
    src: this.src,
    controller: this.videoController
  })
    .width('100%')
    .height(this.isFullscreen ? '100%' : 220)

  VideoControls({
    isPlaying: this.isPlaying,
    progress: this.progress
  })
}
```

## 回答用户时应包含

1. 原子组件负责什么，不负责什么。
2. 父容器尺寸、对齐方式和资源来源。
3. 文本/图片/视频各自的状态拆分。
4. 一个能嵌入业务页面的最小 ArkTS 组件。
