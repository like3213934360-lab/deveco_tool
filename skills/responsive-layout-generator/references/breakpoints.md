# 响应式断点定义

本文档定义了响应式布局的断点体系，用于自适应布局。断点面向窗口而非设备类型，相同断点区间的窗口展示相同的页面布局。

## 断点设计原理

提升全场景体验，需考虑多设备连续性。应用页面布局设计时推荐遵循以下原则：

- **原则一**：两个宽度相近的窗口，页面布局相同，断点归一。
- **原则二**：高度相对宽度较小的窗口，呈现横向窗口或类方形窗口时，页面布局进行差异化设计，增加断点。

因此，系统设计了横向和纵向断点分别代表窗口的不同特征，作为判断页面布局和交互体验的条件：

- **横向断点**：以窗口宽度值区分，代表窗口宽度。
- **纵向断点**：以窗口高宽比区分，代表窗口相对高度，表示横向、方形或纵向窗口。

## 断点分类

### 1. 横向断点

横向断点以应用窗口宽度为判断条件，建议划分为如下几个区间：

| 断点名称 | 窗口宽度（vp） | 描述 | 典型设备类型 |
|---------|---------------|------|-------------|
| xs | (0, 320) | 超小屏幕 | 智能穿戴设备 |
| sm | [320, 600) | 小屏幕 | 手机竖屏 |
| md | [600, 840) | 中等屏幕 | 折叠屏展开态 |
| lg | [840, 1440) | 大屏幕 | 平板、智慧屏 |
| xl | [1440, +∞) | 超大屏幕 | 电脑 |

> **注意**：
> 1. 断点区间采用**左闭右开**，即 `[minWidth, maxWidth)`，xs为左开右开 `(0, 320)`。
> 2. 断点面向窗口而非设备类型。同一设备上的不同窗口形态（如全屏、分屏、自由窗口等）可能落入不同的断点区间。
> 3. xs断点对应的一般是智能穿戴类设备，如果确定某页面不会在智能穿戴设备上显示，则可以不适配xs断点。
> 4. 可以根据实际业务场景需要在lg断点后面新增xl、xxl等断点。

### 2. 纵向断点

纵向断点根据应用窗口的高宽比进行判断，建议划分为如下几个区间：

| 断点名称 | 高宽比 | 描述 | 典型场景 |
|---------|-------|------|---------|
| sm | (0, 0.8) | 横向窗口 | 平板横屏、电脑 |
| md | [0.8, 1.2) | 类方形窗口 | 折叠屏展开态 |
| lg | [1.2, +∞) | 纵向窗口 | 手机竖屏 |

> **纵向断点使用场景**：
> - **横向窗口**（纵向断点为sm）：窗口高宽比小于0.8，如平板横屏、电脑。
> - **类方形窗口**（纵向断点为md）：窗口高宽比在[0.8, 1.2)之间。
> - **纵向窗口**（纵向断点为lg）：窗口高宽比大于等于1.2，如手机竖屏。

## 断点配置格式

### DSL中的断点定义

```json
{
  "breakpoints": [
    {
      "name": "xs",
      "minWidth": 0,
      "maxWidth": 320,
      "layoutAdjustments": {
        "columns": 2,
        "direction": "column",
        "gap": 8,
        "margin": 12,
        "padding": 12
      },
      "componentAdjustments": [
        {
          "id": "all",
          "adjustments": {
            "iconSize": 40,
            "labelFontSize": 10
          }
        }
      ]
    },
    {
      "name": "sm",
      "minWidth": 320,
      "maxWidth": 600,
      "layoutAdjustments": {
        "columns": 4,
        "direction": "column",
        "gap": 10,
        "margin": 16,
        "padding": 16
      },
      "componentAdjustments": [
        {
          "id": "all",
          "adjustments": {
            "iconSize": 44,
            "labelFontSize": 12
          }
        }
      ]
    },
    {
      "name": "md",
      "minWidth": 600,
      "maxWidth": 840,
      "layoutAdjustments": {
        "columns": 4,
        "direction": "row",
        "gap": 12,
        "margin": 20,
        "padding": 20
      },
      "componentAdjustments": [
        {
          "id": "all",
          "adjustments": {
            "iconSize": 48,
            "labelFontSize": 14
          }
        }
      ]
    },
    {
      "name": "lg",
      "minWidth": 840,
      "maxWidth": 1440,
      "layoutAdjustments": {
        "columns": 8,
        "direction": "row",
        "gap": 16,
        "margin": 24,
        "padding": 24
      },
      "componentAdjustments": [
        {
          "id": "all",
          "adjustments": {
            "iconSize": 48,
            "labelFontSize": 14
          }
        }
      ]
    },
    {
      "name": "xl",
      "minWidth": 1440,
      "maxWidth": null,
      "layoutAdjustments": {
        "columns": 12,
        "direction": "row",
        "gap": 20,
        "margin": 32,
        "padding": 32
      },
      "componentAdjustments": [
        {
          "id": "all",
          "adjustments": {
            "iconSize": 52,
            "labelFontSize": 16
          }
        }
      ]
    }
  ]
}
```

## 断点检测

### 检测方法

```typescript
// 横向断点枚举
enum WidthBreakpoint {
  WIDTH_XS = 'xs',
  WIDTH_SM = 'sm',
  WIDTH_MD = 'md',
  WIDTH_LG = 'lg',
  WIDTH_XL = 'xl'
}

// 纵向断点枚举
enum HeightBreakpoint {
  HEIGHT_SM = 'sm',
  HEIGHT_MD = 'md',
  HEIGHT_LG = 'lg'
}

// 根据窗口宽度（vp）判断横向断点
function detectWidthBreakpoint(windowWidth: number): WidthBreakpoint {
  if (windowWidth < 320) {
    return WidthBreakpoint.WIDTH_XS;
  } else if (windowWidth < 600) {
    return WidthBreakpoint.WIDTH_SM;
  } else if (windowWidth < 840) {
    return WidthBreakpoint.WIDTH_MD;
  } else if (windowWidth < 1440) {
    return WidthBreakpoint.WIDTH_LG;
  } else {
    return WidthBreakpoint.WIDTH_XL;
  }
}

// 根据窗口高宽比判断纵向断点
function detectHeightBreakpoint(heightWidthRatio: number): HeightBreakpoint {
  if (heightWidthRatio < 0.8) {
    return HeightBreakpoint.HEIGHT_SM;
  } else if (heightWidthRatio < 1.2) {
    return HeightBreakpoint.HEIGHT_MD;
  } else {
    return HeightBreakpoint.HEIGHT_LG;
  }
}
```

## 断点适配规则

### 布局方向切换

| 屏幕分类 | 横向断点 | 纵向断点条件 | 推荐布局方向 |
|---------|---------|------------|------------|
| 超小屏 | xs | - | column（垂直） |
| 小屏 | sm | 纵向断点为lg | column（垂直） |
| 小屏横向 | sm | 纵向断点为sm | row（水平） |
| 类方形窗口 | sm | 纵向断点为md | 视组件数量决定 |
| 中屏 | md | - | row（水平） |
| 大屏 | lg | - | row（水平） |
| 超大屏 | xl | - | row（水平） |

### 组件尺寸调整

| 属性 | xs | sm | md | lg | xl |
|------|-----|-----|-----|-----|-----|
| 图标尺寸 | 40vp | 44vp | 48vp | 48vp | 52vp |
| 标签字号 | 10fp | 12fp | 14fp | 14fp | 16fp |
| 按钮高度 | 40vp | 44vp | 48vp | 48vp | 52vp |
| 容器padding | 12vp | 16vp | 20vp | 24vp | 32vp |
| 组件间距 | 8vp | 10vp | 12vp | 16vp | 20vp |

### 网格列数适配

| 设计稿列数 | xs | sm | md | lg | xl |
|-----------|-----|-----|-----|-----|-----|
| 2列 | 1列 | 2列 | 2列 | 3列 | 4列 |
| 3列 | 2列 | 2列 | 3列 | 4列 | 5列 |
| 4列 | 2列 | 3列 | 4列 | 6列 | 8列 |
| 5列 | 2列 | 3列 | 4列 | 7列 | 10列 |

## 用户确认场景

在生成响应式布局时，遇到以下不确定事项，应主动向用户确认：

| 场景 | 需确认内容 | 确认问题示例 |
|------|-----------|-------------|
| 网格列数 | 不同断点下的具体列数 | "列表在sm/md/lg断点下分别是2/3/4列？" |
| 布局方向 | 小屏幕下的主布局方向 | "小屏幕下按钮组应该垂直排列还是水平排列？" |
| 内容显隐 | 某些组件在不同断点是否显示 | "是否需要在sm断点下隐藏副标题？" |
| 间距/边距 | 具体的gap/margin/padding值 | "各断点下的组件间距分别用多少？" |
| 组件优先级 | 小屏幕下保留哪些组件 | "哪些组件应在xs断点下隐藏？" |
| 断点范围 | 是否需要适配特定断点 | "该页面是否需要适配xs断点（智能穿戴）？" |

## 注意事项

1. **断点区间不重叠**：每个断点的宽度范围互不重叠，采用左闭右开区间 `[minWidth, maxWidth)`，xs为左开右开 `(0, 320)`
2. **单位统一使用vp**：断点宽度、组件尺寸、间距等均使用vp（虚拟像素）为单位，字体使用fp
3. **断点面向窗口**：相同断点区间的窗口展示相同的页面布局，与设备类型无关
4. **纵向断点辅助判断**：当仅用横向断点无法区分时（如手机横屏与折叠屏展开态），结合纵向断点进行判断
5. **显示缩放影响**：用户修改显示缩放会导致dpi变化，从而使vp值变化，可能影响断点区间
6. **动态变化**：支持分屏、旋转、折叠等场景下的断点动态切换
7. **性能考虑**：避免频繁的断点切换触发重绘，建议添加防抖
8. **默认断点**：未匹配到任何断点时，使用最接近的较小断点