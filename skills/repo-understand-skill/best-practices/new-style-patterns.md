# 新风格模式合集

> ArkTS最佳实践样例 —— 6种 HarmonyOS 新风格 UI 模式的概念说明、关键代码、适用场景与选择策略

## 模式一: backdropBlur / backgroundBlurStyle 模糊效果

**适用场景**: 沉浸式工具栏悬浮在内容上方、弹窗/菜单需要毛玻璃背景、组件背景需要让背后内容模糊透出
**核心实现**: backdropBlur 用于组件级模糊（精确控制半径），backgroundBlurStyle 用于系统组件级模糊（使用系统预定义枚举）

### 关键实现方法

**backdropBlur**: 直接施加在组件上，让该组件背后的内容产生模糊效果。适用于需要精确控制模糊程度的场景。

```typescript
// 来源: TopToolbar.ets
// 条件式 backdropBlur：仅在非裁剪模式且支持沉浸式时启用
.backdropBlur(
  this.editor.tabIndex !== TabName.TabCrop && IMMERSIVE_ONLY_MODE_SUPPORTED ?
    IMMERSIVE_BACKDROP_BLUR_RADIUS : undefined
)
```

**backgroundBlurStyle**: 用于系统级组件（bindMenu、bindPopup、bindSheet、CustomDialogController），使用 BlurStyle 枚举。

```typescript
// 来源: TopToolbar.ets - bindMenu 中使用 backgroundBlurStyle
.bindMenu(this.menuBuilder, {
  backgroundColor: NEW_MATERIAL_SUPPORTED ? Color.Transparent : undefined,
  backgroundBlurStyle: NEW_MATERIAL_SUPPORTED ? BlurStyle.NONE : undefined,
})

// 来源: GridPageView.ets - bindSheet 中使用 blurStyle
.bindSheet(this.sheetStateController.isShow, this.buildSheetContent(), {
  backgroundColor: Color.Transparent,
  blurStyle: BlurStyle.COMPONENT_ULTRA_THICK,
})
```

### 选择策略

| 场景 | 选择 | 原因 |
|------|------|------|
| 悬浮工具栏/操作栏 | backdropBlur | 需要精确控制模糊半径，让内容图片透出 |
| 系统弹窗/菜单/Popup | backgroundBlurStyle | 系统组件自动适配深浅色，使用枚举更规范 |
| 新材质模式下的弹窗 | BlurStyle.NONE + systemMaterial | 新材质统一管理视觉，模糊由材质系统控制 |
| 裁剪/绘制等精确操作场景 | undefined（不施加模糊） | 避免模糊干扰操作精确性 |

## 模式二: Flex 横竖屏自适应布局

**适用场景**: 底部/顶部工具栏需要横竖屏排列方向切换、菜单面板需要纵向/横向自适应、侧边栏与底部栏的动态切换
**核心实现**: 使用 Flex 容器 + isScreenPortrait 状态驱动 FlexDirection 切换

### 关键实现方法

核心模式是 `Flex({ direction: portrait ? Column : Row })`，配合条件式的 height/width/margin 赋值。

```typescript
// 来源: ImmersiveBottomToolbar.ets - 底部工具栏主体
build() {
  Flex({
    direction: this.isScreenPortrait ? FlexDirection.Column : FlexDirection.Row,
    alignItems: ItemAlign.Center,
  }) {
    this.switchTabsContent(); // 二三级菜单
    this.tabsBuilder()        // 一级菜单
  }
  .height(this.isScreenPortrait ? BOTTOM_HEIGHT_SPLIT : `calc(100% - ${this.avoidBottom}vp)`)
  .width(this.isScreenPortrait ? '100%' : this.getToolbarWidth())
  .margin({ bottom: this.screenClass.avoidBottom })
}

// 来源: ImmersiveBottomToolbar.ets - AI 面板内部
Flex({
  direction: this.isScreenPortrait ? FlexDirection.Column : FlexDirection.Row,
  alignItems: ItemAlign.Center,
  justifyContent: FlexAlign.End,
}) {
  // AI 操作面板内容...
}
```

### 选择策略

| 场景 | 选择 | 原因 |
|------|------|------|
| 工具栏横竖屏切换 | Flex + FlexDirection | 方向切换只需改变一个属性，布局自动重排 |
| 固定方向布局 | Column/Row | 方向不变时使用更简单的容器组件 |
| 复杂自适应网格 | Grid | 需要多行多列自适应时使用 Grid 组件 |
| 流式排列 | Flex + FlexWrap.Wrap | 需要换行排列时启用 wrap 属性 |

**设计要点**: Flex 方向切换时，height/width/margin 必须同步条件赋值，否则尺寸不匹配。横屏时底部工具栏变为侧边工具栏，宽度固定、高度占满可用区域。

## 模式三: bindSheet 半模态弹窗

**适用场景**: 从底部或居中弹出的选择面板、封面选择器、排序选择器、需要手势关闭的交互面板
**核心实现**: 使用 bindSheet + SheetType 配合动态尺寸计算

### 关键实现方法

bindSheet 的关键在于尺寸根据设备类型动态计算，而非固定值。

```typescript
// 来源: GridPageView.ets - 半模态尺寸计算
private bindSheetWidthAndHeight(): void {
  if (getScreen().isSplitMode()) {
    this.bindSheetHeight = getScreen().getWinHeight() > getScreen().getWinWidth() ?
      getScreen().getWinHeight() : getScreen().getWinWidth();
    this.bindSheetWidth = SheetSize.LARGE;
    return;
  }
  if (DeviceInfo.isFoldable() || DeviceInfo.isTablet()) {
    this.bindSheetHeight = '560vp';
    this.bindSheetWidth = '480vp';
    return;
  }
  if (isOrientationHorizontal()) {
    this.bindSheetHeight = getScreen().getWinHeight() - 8;
    this.bindSheetWidth = '480vp';
    return;
  }
  // 直板机竖屏
  this.bindSheetHeight = getScreen().getWinHeight() - getScreen().getStatusBarHeight() - 8;
  this.bindSheetWidth = '100%';
}

// bindSheet 使用
.bindSheet(this.sheetStateController.isShow, this.buildSheetContent(), {
  showClose: false,
  preferType: SheetType.CENTER,     // 居中弹出（而非底部）
  height: this.bindSheetHeight,
  width: this.bindSheetWidth,
  backgroundColor: Color.Transparent,
  blurStyle: BlurStyle.COMPONENT_ULTRA_THICK,  // 模糊背景
  onDisappear: () => {
    this.navPathStackBindSheet.clear();
    this.sheetStateController.isShow = false;
  }
})
.onAreaChange((_old, _new) => {
  this.bindSheetWidthAndHeight(); // 窗口变化时重新计算尺寸
})
```

**SheetStateController 状态管理**（来源: `GridPageView.ets`）:

```typescript
@Observed
export class SheetStateController {
  public static readonly KEY_SHEET_CONTROLLER: string = 'com.example.app.sheet_controller';
  public isShow: boolean = false;
}
```

### 选择策略

| 场景 | 选择 | 原因 |
|------|------|------|
| 复杂交互选择面板 | bindSheet + SheetType.CENTER | 支持手势关闭、模糊背景、居中/底部弹出 |
| 简单确认/警告弹窗 | CustomDialogController / AlertDialog | 标准化视觉，无需复杂布局 |
| 从底部滑出的设置面板 | bindSheet + SheetType.BOTTOM | 半模态底部弹出，用户可下拉关闭 |
| 需要完全自定义内容的弹窗 | @CustomDialog struct | 内容完全可控，但需自行适配设备 |

**设计要点**: bindSheet 的尺寸必须在 `onAreaChange` 中动态重算，确保横竖屏切换时尺寸适配。使用 `@Observed` 的 SheetStateController 类管理 isShow 状态，避免直接操作 boolean 导致状态丢失。

## 模式四: interpolatingSpring 弹簧动画

**适用场景**: 拖拽回弹、缩放反馈、需要自然收敛的交互反馈动画、避免生硬的线性/减速动画
**核心实现**: 使用 Curves.interpolatingSpring 或 @ohos.curves.interpolatingSpring 作为动画曲线

### 关键实现方法

interpolatingSpring 四参数: velocity(初速度)、mass(质量)、stiffness(刚度)、damping(阻尼)。

```typescript
// 来源: DragController.ets - 拖拽目标区域缩放弹簧动画
public dragOrderAnimate(item: GroupInfo): string | Curve | ICurve {
  if (this.insertScaleUri !== item?.uri) {
    return Curve.Sharp; // 非目标区域：快速减速曲线
  } else {
    return Curves.interpolatingSpring(
      Constants.DRAG_ITEM_SCALE_ANIMATION_VELOCITY,   // 初速度
      Constants.DRAG_ITEM_SCALE_ANIMATION_MASS,       // 质量
      Constants.DRAG_ITEM_SCALE_ANIMATION_STIFFNESS,  // 刚度
      Constants.DRAG_ITEM_SCALE_ANIMATION_DAMPING     // 阻尼
    );
  }
}

// 来源: DragController.ets - 拖拽结束回弹动画
public initDragEndController(): void {
  animateTo({
    curve: Curves.interpolatingSpring(
      Constants.ENTER_ITEM_SCALE_ANIMATION_VELOCITY,
      Constants.DRAG_ITEM_SCALE_ANIMATION_MASS,
      Constants.ENTER_ITEM_SCALE_ANIMATION_STIFFNESS,
      Constants.ENTER_ITEM_SCALE_ANIMATION_DAMPING
    )
  }, () => {
    this.dragGridItemOriginGroup = new GroupInfo();
  })
}
```

### 选择策略

| 场景 | 选择 | 原因 |
|------|------|------|
| 拖拽回弹/缩放反馈 | interpolatingSpring | 自然收敛，无需指定 duration |
| 状态切换（显隐/位置） | animateTo + Curve.Sharp | 需要精确控制 duration |
| 页面入场/出场 | animateTo + 'standard' | 标准过渡曲线，视觉统一 |
| 长时间连续动画 | AnimatorResult | 需要精确控制帧和暂停/恢复 |

**设计要点**: interpolatingSpring 不需要指定 duration，动画时长由弹簧参数自然决定。参数值应作为常量统一管理，便于全局调优。不同交互场景可使用不同参数组——缩放反馈需要较高 stiffness，回弹需要较高 damping。

## 模式五: TransitionEffect 非对称过渡

**适用场景**: 页面/组件出场入场需要不同动画效果、多效果组合过渡、设备差异化过渡策略
**核心实现**: TransitionEffect.asymmetric 定义进出差异化 + TransitionEffect.combine 组合多种效果

### 关键实现方法

```typescript
// 来源: GridPageView.ets
.transition(
  DeviceInfo.isTablet() ?
    // 平板：非对称过渡（进入带延迟，退出无延迟）
    TransitionEffect.asymmetric(
      TransitionEffect.OPACITY.animation({
        duration: 200,
        delay: 50,
        curve: Curve.Sharp,
      }),
      TransitionEffect.OPACITY.animation({
        duration: 200,
        curve: Curve.Sharp,
      })
    )
    : // 手机：对称过渡 + 条件式缩放组合
    TransitionEffect.OPACITY.animation({ duration: 300, curve: 'standard' })
      .combine(this.needCombineScaleAnimation ?
        TransitionEffect.scale({ x: 0.9, y: 0.9, z: 0.9 }) :
        TransitionEffect.IDENTITY
      )
)
```

### 选择策略

| 场景 | 选择 | 原因 |
|------|------|------|
| 重要页面过渡 | asymmetric | 进出场差异化，视觉更精致 |
| 简单组件过渡 | 对称 OPACITY | 简洁统一，代码量少 |
| 需要叠加缩放效果 | OPACITY.combine(scale) | 多效果组合增强视觉冲击 |
| 无需额外效果 | OPACITY.combine(IDENTITY) | 保持 combine 链完整性但无额外效果 |

**设计要点**: `asymmetric` 的进入效果可加 delay 让出场动画先完成，避免视觉冲突。`combine` 组合多个效果时，每个效果应有独立控制开关（如 `needCombineScaleAnimation`），避免不必要的效果叠加。`IDENTITY` 是"无效果"占位符，保持代码结构一致。

## 模式六: parallelGesture 手势冲突解决

**适用场景**: 网格页需要同时支持捏合缩放和拖拽多选、长按和点击需要区分、父子组件手势需要协调
**核心实现**: 使用 parallelGesture 或 .gesture() 的优先级机制解决手势冲突

### 关键实现方法

HarmonyOS 手势系统有两种绑定方式:
- `.gesture()`: 正常优先级，子组件手势优先触发
- `.parallelGesture()`: 并行优先级，父组件手势可与子组件手势同时触发

当需要父子组件手势同时响应（如网格项的长按选择 + 网格容器的捏合缩放），使用 parallelGesture。

```typescript
// 通用模式：网格容器绑定捏合手势（并行优先级）
.parallelGesture(
  PinchGesture({ fingers: 2 })
    .onActionStart((event: GestureEvent) => { /* 开始缩放 */ })
    .onActionUpdate((event: GestureEvent) => { /* 更新缩放 */ })
    .onActionEnd(() => { /* 结束缩放 */ })
)

// 网格项绑定长按手势（正常优先级，子组件优先）
.gesture(
  LongPressGesture({ fingers: 1, duration: 500 })
    .onAction((event: GestureEvent) => { /* 进入多选 */ })
)
```

### 选择策略

| 场景 | 选择 | 原因 |
|------|------|------|
| 父子手势需同时触发 | parallelGesture | 并行触发，不互斥 |
| 父子手势互斥（子优先） | .gesture() | 子组件手势优先，父组件不触发 |
| 需要手势互斥并可控 | TapGesture + LongPressGesture 组合 | 通过 fingers/duration 区分 |
| 全局手势拦截 | .priorityGesture() | 父组件手势优先，覆盖子组件 |

**设计要点**: 网格页典型手势冲突场景：捏合缩放(2指) vs 拖拽选择(1指) vs 长按进入多选(1指500ms)。解决方案: 捏合用 parallelGesture（可与选择手势并行），长按和点击通过 duration 参数区分。避免在父子组件间使用相同类型的手势绑定方式，否则会产生不可预期的冲突行为。

### 通用设计原则总结

1. **新风格模式组合使用**: 沉浸式工具栏 = backdropBlur + Flex 自适应 + 条件式背景色；半模态弹窗 = bindSheet + 动态尺寸 + backgroundBlurStyle
2. **设备差异化**: 所有视觉效果和尺寸计算都需要覆盖直板机竖屏/横屏、折叠屏展开/折叠、平板、分栏模式
3. **条件式控制**: 模糊、动画、过渡效果都应有开关控制，不同场景（裁剪/浏览/多选）使用不同配置
4. **常量统一管理**: 动画参数(弹簧参数/duration)、模糊半径、尺寸阈值都应作为常量，便于全局调优
