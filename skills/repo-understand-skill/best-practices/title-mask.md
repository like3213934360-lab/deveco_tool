# 标题遮罩模式

> 图片上文字可读性的渐变遮罩方案 + AttributeUpdater 增量更新 + compositingFilter 渐变模糊

---

## 关键实现方法

### 1. MaskAttributeUpdater — linearGradient + compositingFilter 双层遮罩

**源码**: `MaskAttributeUpdater.ets` (collection 模块)

```typescript
export class MaskAttributeUpdater extends AttributeUpdater<ColumnAttribute> {
  private filter: uiEffect.Filter = uiEffect.createFilter();
  private linearGradient: LinearGradientOptions = { direction: GradientDirection.Bottom, colors: [] };
  private height: number = 0;
  private opacity: number = 1;

  constructor(uiContext: UIContext) {
    super();
    // 构造时预计算深色/浅色两套渐变数组（贝塞尔曲线插值21个color stop）
    this.darkMaskGradientColors = MaskAttributeUpdater.buildGradientColors(0, 0, 0, this.curve2, 0.3);
    this.lightMaskGradientColors = MaskAttributeUpdater.buildGradientColors(229, 229, 229, this.curve2, 0.3);
  }

  // 贝塞尔曲线插值渐变颜色 — 避免运行时重复计算
  protected static buildGradientColors(r: number, g: number, b: number,
    curve: ICurve, colorAlpha: number): [ResourceColor, number][] {
    const colors: [ResourceColor, number][] = [];
    for (let i = 0; i <= 20; i++) {
      const fraction = i / 20;
      const alpha = (1 - curve.interpolate(fraction)) * colorAlpha;
      colors.push([`rgba(${r}, ${g}, ${b}, ${alpha})`, fraction]);
    }
    colors.push(['#00000000', 0.999]);  // 末端全透明
    return colors;
  }

  initializeModifier(instance: ColumnAttribute): void {
    instance
      .zIndex(2)
      .height(this.height)
      .width('100%')
      .opacity(this.opacity)
      .compositingFilter(this.getBlurCompositingFilter(this.filter))  // 渐变模糊层
      .linearGradient(this.linearGradient)                             // 渐变遮罩层
      .hitTestBehavior(HitTestMode.Transparent)
  }

  // 渐变模糊 — radiusGradientBlur 使图片本身在遮罩区域模糊
  private getBlurCompositingFilter(filter: uiEffect.Filter): Filter | undefined {
    return filter.radiusGradientBlur(HEAD_BLUR_RADIUS, {
      fractionStops: [...],  // 另一条贝塞尔曲线控制模糊强度衰减
      direction: GradientDirection.Bottom
    });
  }
}
```

**要点**: 三层叠加确保文字可读性：1) linearGradient 渐变遮罩（21个贝塞尔曲线插值color stop）；2) compositingFilter radiusGradientBlur 渐变模糊（使图片本身模糊）；3) 两层共用 AttributeUpdater 增量更新，避免全量重建。

---

### 2. 双向遮罩 — 顶部+底部同时遮罩

**源码**: `DualMaskAttributeUpdater.ets` (common 模块)

```typescript
export class DualMaskAttributeUpdater extends AttributeUpdater<ColumnAttribute> {
  private isTop: boolean = true;  // true=顶部遮罩(Bottom方向), false=底部遮罩(Top方向)
  private isLightMask: boolean = false;

  constructor(uiContext: UIContext, isTop: boolean) {
    super();
    this.isTop = isTop;
    // 维护四套渐变颜色：light/dark × top/bottom
    this.lightMaskColorTop = DualMaskAttributeUpdater.buildGradientColors(241, 243, 245, ...);
    this.darkMaskColorTop = DualMaskAttributeUpdater.buildGradientColors(0, 0, 0, ...);
    this.lightMaskColorBottom = ...;
    this.darkMaskColorBottom = ...;
  }

  // 动态切换深色/浅色模式
  public updateLightMaskMode(isLightMask: boolean): void {
    this.isLightMask = isLightMask;
    this.updateGradientAndFilter();
  }

  initializeModifier(instance: ColumnAttribute): void {
    instance.linearGradient(this.getCurrentGradient());
    if (this.isTop) {
      instance.compositingFilter(this.getBlurCompositingFilter(...));  // 仅顶部加模糊
    }
  }
}
```

**使用方式** (GroupCoverSelectPage):

```typescript
// 创建两个遮罩更新器：顶部 + 底部
this.titleMaskAttribute = new DualMaskAttributeUpdater(this.getUIContext(), true);
this.bottomMaskAttribute = new DualMaskAttributeUpdater(this.getUIContext(), false);

// 挂载到对应 Column
Column().attributeModifier(this.titleMaskAttribute);   // 顶部标题遮罩
Column().attributeModifier(this.bottomMaskAttribute);  // 底部按钮遮罩
```

**要点**: isTop 控制渐变方向和是否叠加模糊；底部遮罩仅用 linearGradient 不加 compositingFilter（降低 GPU 负载）。

---

### 3. SemiMaskAttributeUpdater — 抛滑降功耗

**源码**: `MaskAttributeUpdater.ets` (collection 模块)

```typescript
export class SemiMaskAttributeUpdater extends AttributeUpdater<ColumnAttribute> {
  // 抛滑/快速滚动时替换完整遮罩，去掉 compositingFilter，仅保留 linearGradient
  initializeModifier(instance: ColumnAttribute): void {
    instance
      .zIndex(2)
      .height(this.height)
      .linearGradient(this.linearGradient)
      .hitTestBehavior(HitTestMode.Transparent)
  }
}
```

**切换逻辑** (GridTitleBarMaskVc):

```typescript
// 滚动开始 → 降功耗遮罩
animateToImmediately({ duration: 100, curve: Curve.Sharp }, () => {
  this.semiMaskAttribute.updateOpacity(1);   // SemiMask 仅渐变
  this.maskAttribute.updateOpacity(0);        // 完整遮罩隐藏
});
// 滚动停止 → 恢复完整遮罩
animateToImmediately({ duration: 100, curve: Curve.Sharp }, () => {
  this.semiMaskAttribute.updateOpacity(0);
  this.maskAttribute.updateOpacity(1);
});
```

**要点**: 抛滑时 compositingFilter 的 GPU 开销大，用纯渐变 SemiMask 替代；100ms Sharp 曲线切换，用户几乎无感知。

---

### 4. 滚动遮罩控制器 — TitleMaskScrollController

**源码**: `TitleMaskScrollController.ets`

```typescript
export class TitleMaskScrollController {
  private totalScrollOffset: number = 0;

  onScroll(offset: number): void {
    this.totalScrollOffset += offset;
    if (this.totalScrollOffset > 0) {
      this.showMask();   // animateToImmediately 显示遮罩
    } else {
      this.hideMask();   // animateToImmediately 隐藏遮罩
    }
  }

  showMask(): void {
    animateToImmediately({ duration: 100, curve: Curve.Sharp }, () => {
      this.maskAttribute.updateOpacity(1);
    });
  }
}
```

**要点**: 监听滚动偏移量，正偏移显示遮罩，零偏移隐藏遮罩；支持 startOffset 修正初始偏移。

---

## 适用场景

- 内容网格页顶部标题栏遮罩（滚动时标题浮于图片之上）
- 收藏集页顶部标题+底部按钮双向遮罩
- 分组封面页标题+操作栏遮罩
- 下载列表页遮罩
- 任何需要在图片/视频上叠加可读文字的场景
