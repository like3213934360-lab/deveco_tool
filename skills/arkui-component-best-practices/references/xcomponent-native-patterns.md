# XComponent 原生渲染桥接模式

## 什么时候使用

当用户提到以下需求时读本文件：

- `XComponent` 原生渲染、Native 侧绘制、Surface/纹理
- ArkTS 页面嵌入 C++/OpenGL/媒体渲染区域
- XComponent 生命周期、尺寸变化、触摸事件传递

来源示例：

- XComponent 相关组件实践文章
- 检索更多：`node scripts/search-practices.mjs XComponent`

## 核心判断

`XComponent` 是跨 ArkUI 与原生渲染的边界组件。它不应该作为普通布局容器使用；只有当渲染能力必须交给 Native、OpenGL、媒体引擎或三方底层能力时才使用。

## 状态边界

ArkTS 侧负责：

- 组件尺寸和布局位置
- 显示/隐藏
- 手势或触摸事件转发
- 与业务状态同步

Native 侧负责：

- Surface 创建与销毁
- 渲染资源初始化和释放
- 帧绘制
- 原生事件处理

## ArkTS 侧骨架

```ts
XComponent({
  id: 'nativeRender',
  type: XComponentType.SURFACE,
  controller: this.xComponentController
})
  .width('100%')
  .height(240)
  .onLoad(() => {
    this.nativeReady = true;
  })
  .onDestroy(() => {
    this.nativeReady = false;
  })
```

## 常见坑

- 组件销毁后 Native 侧仍持有 Surface，会导致资源泄漏或崩溃。
- 尺寸变化只改 ArkUI 宽高不通知 Native，渲染区域可能拉伸或裁剪。
- XComponent 被放进可滚动列表时，要特别注意复用、销毁和重建频率。
- 触摸事件同时被 ArkUI 和 Native 处理时，要明确谁拥有手势。

## 回答用户时应包含

1. 为什么这里必须用 XComponent。
2. ArkTS 与 Native 的职责边界。
3. 生命周期：加载、尺寸变化、销毁。
4. 资源释放和事件转发的注意点。
