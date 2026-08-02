# 响应式布局

## 概述

响应式设计的核心思想是页面根据不同屏幕尺寸自动调整布局，提供更舒适的界面和更好的用户体验。HarmonyOS为此提供了一系列的响应式布局能力和工具，用来实现多端布局。

| 响应式布局能力 | 简介 |
| --- | --- |
| 断点 | 将窗口宽度划分为不同的范围（即断点），监听窗口尺寸变化，当断点改变时同步调整页面布局。 |
| 媒体查询 | 媒体查询支持监听窗口宽度、横竖屏、深浅色、设备类型等多种媒体特征，当媒体特征发生改变时同步调整页面布局。 |
| 栅格 | 栅格组件将其所在的区域划分为有规律的多列，通过调整不同断点下的栅格组件的参数以及其子组件占据的列数等，实现不同的布局效果。 |
| 响应式组件 | HarmonyOS提供的一些组件支持响应式布局，例如：Tabs、Swiper、Grid、List、GridRow，通过断点设置可以实现不同的展示效果。 |

## 断点

> 详细的断点定义、设备类型映射和检测方法请参考 [breakpoints.md](breakpoints.md)。

### 断点的设计原理
提升全场景体验，需考虑多设备连续性。应用页面布局设计时推荐遵循以下原则：

- 原则一：两个宽度相近的窗口，页面布局相同，断点归一。
- 原则二：高度相对宽度较小的窗口，呈现横向窗口或类方形窗口时，页面布局进行差异化设计，增加断点。

### 断点定义速查

**横向断点**：

| 断点名称 | 窗口宽度（vp） | 典型设备类型 |
| --- | --- | --- |
| xs | (0, 320） | 智能穿戴设备 |
| sm | [320, 600) | 手机竖屏 |
| md | [600, 840) | 折叠屏展开态 |
| lg | [840, 1440) | 平板/智慧屏 |
| xl | [1440, +∞) | 电脑 |

**纵向断点**：

| 断点名称 | 高宽比 | 含义 |
| --- | --- | --- |
| sm | (0, 0.8) | 横向窗口 |
| md | [0.8, 1.2) | 类方形窗口 |
| lg | [1.2, +∞) | 纵向窗口 |

说明

1. 断点面向窗口而非设备类型，相同断点区间的窗口展示相同的页面布局。
2. 开发者可以根据实际使用场景决定适配哪些断点。
3. 可以根据实际业务场景需要在lg断点后面新增xl、xxl等断点。

### 通过断点刷新UI

**通过断点环境变量刷新UI**

从API version 22起，开发者可利用响应式系统环境变量装饰器@Env读取断点信息。当组件所在窗口尺寸发生变化时，@Env装饰的断点环境变量将更新，并触发与该断点环境变量关联的组件刷新，从而实现界面内容的同步更新。

**通过主动监听断点变化刷新UI**

1. 使用自定义窗口信息类WindowInfo保存窗口断点信息。
```
@Observed
export class WindowInfo {
  public widthBp: WidthBreakpoint = WidthBreakpoint.WIDTH_SM;
  public heightBp: HeightBreakpoint = HeightBreakpoint.HEIGHT_SM;
}
```

2. 使用`getWindowWidthBreakpoint()`与`getWindowHeightBreakpoint()`获取当前窗口断点。通过`on('windowSizeChange')`开启窗口尺寸变化的监听。

3. 在EntryAbility的`onWindowStageCreate()`生命周期中初始化，保存至AppStorage中。

4. 在页面组件中使用@StorageLink/@ObjectLink获取断点信息，根据断点进行差异化布局。

### 横向断点的使用案例

在实际应用开发中，可能不会涉及到全部的横向断点。开发者可以根据应用的实际需求，灵活选用并整理工具类，为响应式布局的属性赋值。

```typescript
// 工具类示例
export class WidthBreakpointType<T> {
  sm: T;
  md: T;
  lg: T;
  xl: T;

  constructor(sm: T, md: T, lg: T, xl: T) {
    this.sm = sm;
    this.md = md;
    this.lg = lg;
    this.xl = xl;
  }

  getValue(widthBp: WidthBreakpoint): T {
    if (widthBp === WidthBreakpoint.WIDTH_XS || widthBp === WidthBreakpoint.WIDTH_SM) {
      return this.sm;
    }
    if (widthBp === WidthBreakpoint.WIDTH_MD) {
      return this.md;
    }
    if (widthBp === WidthBreakpoint.WIDTH_LG) {
      return this.lg;
    }
    return this.xl;
  }
}
```

### 纵向断点的使用案例

针对高度相对宽度较小的窗口（如横向窗口或类方形窗口），需结合横向断点和纵向断点进行特殊布局设计。

| 窗口类型 | 判断条件 | 典型场景 |
| --- | --- | --- |
| 横向窗口 | 纵向断点为sm或高宽比 < 0.8 | 平板横屏、电脑 |
| 类方形窗口 | 纵向断点为md或高宽比 ∈ [0.8, 1.2) | 折叠屏展开态 |

**纵向断点典型应用场景**：当仅用横向断点无法区分时（如手机横屏与折叠屏展开态横向断点相同），需结合纵向断点进行差异化布局。

## 媒体查询

媒体查询提供了丰富的媒体特征监听能力，可以监听应用显示区域变化、横竖屏、深浅色、设备类型等。

> 详细的媒体查询断点系统封装代码请参考 [breakpoint_code_spec.md](../../harmonyos-ui-spec/reference/responsive/breakpoint_code_spec.md)。

### 断点系统核心封装

```typescript
import { mediaquery } from '@kit.ArkUI';

export type BreakpointType = 'xs' | 'sm' | 'md' | 'lg' | 'xl';

export class BreakpointSystem {
  // 单例模式，通过媒体查询监听断点变化
  // 详见 breakpoint_code_spec.md
}

export class BreakpointState<T extends Object> {
  // 根据当前断点返回对应值
  // 详见 breakpoint_code_spec.md
}
```

## 常见问题

### 常见的触发断点变化的场景有哪些？

- 设备旋转
- 折叠屏开合
- 窗口模式改变
- 自由窗口模式调节窗口大小

### 显示缩放对断点的影响

vp具体计算公式为：vp = px /（DPI/160）

用户变更缩放比例后dpi会随之变化，从而导致vp变化，需要考虑vp变化后对断点区间的影响。

**解决方案**：
- 若需要应用随dpi改变刷新布局，可使用`on('densityUpdate')`监听。
- 若不希望应用受显示缩放影响布局，可以使用`setDefaultDensityEnabled()`设置应用使用系统默认Density。

### 如何区分设备类型

- 手机/折叠屏/平板/电脑设备，可通过横向断点和纵向断点组合判断。
- 智慧屏设备，可参考系统设备类型判断API。
- 智能穿戴设备，可通过xs断点识别。

## 用户确认场景

在生成响应式布局代码时，遇到以下不确定事项，应主动向用户确认：

| 场景 | 确认问题示例 |
|------|-------------|
| 断点适配范围 | "该页面是否需要适配xs断点（智能穿戴）？" |
| 纵向断点处理 | "类方形窗口下是否需要特殊布局？" |
| 设备方向策略 | "全屏播放时是否支持旋转？" |
| 媒体查询实现方式 | "项目是否已有断点监听系统？使用媒体查询还是Window监听？" |