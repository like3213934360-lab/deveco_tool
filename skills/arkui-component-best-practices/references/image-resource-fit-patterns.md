# Image 资源加载与适配模式

## 什么时候使用

用户提到这些问题时读本文件：

- `Image` 本地图片、网络图片、SVG 加载异常
- 图片按宽度填充、高度裁剪、变成正方形
- `objectFit`、圆角、旋转、颜色矩阵、colorFilter
- 长按图片拖动、点击区域、特殊字符路径
- Swiper 嵌套 Image 显示问题

文本读 `text-rich-display-patterns.md`；视频读 `video-playback-fullscreen-patterns.md`。

## 资源判断

| 来源 | 重点 |
|---|---|
| `$r('app.media.xxx')` | 资源名、目录、构建产物 |
| 网络 URL | 权限、可访问性、占位、失败态 |
| SVG | 兼容性、尺寸、特殊字符、填充策略 |
| 用户图片 | EXIF、方向、裁剪、权限 |

## 推荐骨架

```ts
Image(this.image)
  .width('100%')
  .height(180)
  .objectFit(ImageFit.Cover)
  .borderRadius(8)
```

如果要求完整显示：

```ts
Image(this.image)
  .width('100%')
  .height(180)
  .objectFit(ImageFit.Contain)
```

## 实践要点

- 图片变形或正方形，先查父容器宽高和 `objectFit`。
- 按宽度填充但高度裁剪，通常是 `Cover` 和固定高度共同导致。
- SVG 加载异常要检查特殊字符、资源路径、尺寸声明和平台兼容。
- 圆角、阴影、点击态建议放在稳定外层容器上，避免裁剪和点击区域不一致。
- 图片拖动时，Image 自身长按行为可能抢事件，手势挂外层更稳。

## 常见坑

- 只设置宽度不设置高度，图片依赖原始比例，布局可能抖动。
- 网络图没有占位/失败态，会让列表项高度突然变化。
- colorFilter 颜色矩阵难读，封装成命名函数并注明输入输出。
- Swiper 中图片显示失败时，同时检查 Swiper 页项尺寸和 Image 资源。

## 回答用户时应包含

1. 图片来源和失败态。
2. 展示框尺寸和 `objectFit` 选择。
3. 是否需要裁剪、圆角、颜色处理、拖动。
4. 父容器如何保证布局稳定。
