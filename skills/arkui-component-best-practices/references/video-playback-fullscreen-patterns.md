# Video 播放控制与全屏模式

## 什么时候使用

用户提到这些问题时读本文件：

- `Video` 播放系统图库视频、网络视频、User-Agent
- 获取视频时长、播放进度、自定义控制栏
- 横竖屏切换、全屏播放、半模态尺寸同步
- 自动播放、播放前预览黑屏、Swiper 滑动控制暂停

图片读 `image-resource-fit-patterns.md`。

## 状态模型

```ts
@State isPlaying: boolean = false;
@State progress: number = 0;
@State duration: number = 0;
@State isFullscreen: boolean = false;
```

播放状态、进度、总时长、全屏态分开维护。控制栏只消费状态和派发命令。

## 推荐结构

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
    progress: this.progress,
    duration: this.duration
  })
}
```

## 实践要点

- 预览黑屏优先加封面图或首帧占位，不要只改播放器尺寸。
- 全屏要同步处理页面布局、安全区域、返回行为和横竖屏。
- 自定义控制栏封装成子组件，避免播放状态散落在页面里。
- Swiper/List 中的视频要处理页面切换、滚动离屏、组件销毁时暂停。
- 半模态尺寸变化时，Video 宽高由外层状态驱动。

## 常见坑

- 进度回调中频繁更新 UI 可能卡顿，控制更新频率。
- 页面销毁后播放器继续回调，会导致状态回写异常。
- 自动播放受系统策略、静音、资源准备状态影响，需提供手动播放路径。
- 全屏返回后没有恢复原尺寸，多半是 `isFullscreen` 和容器约束没有同步。

## 回答用户时应包含

1. 视频源和播放前占位。
2. 播放、进度、总时长、全屏态如何维护。
3. 控制栏和 Video 的组件边界。
4. 销毁、离屏、横竖屏、半模态的处理。
