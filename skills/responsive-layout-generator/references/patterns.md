# 响应式布局模式识别规则

## 概述

本文档定义了从绝对位置DSL推断响应式布局模式的4种核心布局类型。详细的识别条件请参考 `rules.md`。

## 4种核心布局模式

### 1. flex（线性布局）

**适用场景**：单行/单列的有序排列

**DSL模板**：

```json
{
  "layoutStrategy": {
    "type": "flex",
    "direction": "row | column",
    "alignment": {
      "horizontal": "start | center | end | space-between | space-around | space-evenly",
      "vertical": "top | center | bottom | space-between | space-around"
    },
    "wrap": true | false,
    "gap": number
  }
}
```

### 2. grid（网格布局）

**适用场景**：等分规则排列，组件严格对齐

**DSL模板**：

```json
{
  "layoutStrategy": {
    "type": "grid",
    "gridConfig": {
      "columns": "repeat(N, 1fr) | repeat(auto-fill, minmax(100px, 1fr))",
      "rows": "auto | repeat(N, 1fr)",
      "columnGap": number,
      "rowGap": number
    }
  }
}
```

### 3. stack（堆叠布局）

**适用场景**：组件重叠，需要z轴层级控制

**DSL模板**：

```json
{
  "layoutStrategy": {
    "type": "stack",
    "stackConfig": {
      "zIndex": [number, number, ...],
      "alignment": {
        "horizontal": "start | center | end",
        "vertical": "top | center | bottom"
      }
    }
  }
}
```

### 4. mixed（混合布局）

**适用场景**：同一容器内存在多种布局模式

**DSL模板**：

```json
{
  "layoutStrategy": {
    "type": "mixed",
    "groups": [
      {
        "yRange": [number, number],
        "strategy": { /* flex | grid | stack */ }
      }
    ]
  }
}
```

## 组件尺寸策略

| 策略类型 | 含义 | DSL模板 |
|---------|------|--------|
| fixed | 固定值 | `{ "type": "fixed", "value": number }` |
| percentage | 百分比 | `{ "type": "percentage", "value": "N%" }` |
| flex | 弹性增长 | `{ "type": "flex", "value": number }` |
| auto | 自动尺寸 | `{ "type": "auto" }` |
| minmax | 最小-最大约束 | `{ "type": "minmax", "min": N, "max": M }` |

## 响应式断点处理

### 断点配置模板

```json
{
  "breakpoints": [
    { "name": "xs", "minWidth": 0, "maxWidth": 320, "layoutAdjustments": { "columns": 2, "direction": "column", "gap": 8 } },
    { "name": "sm", "minWidth": 320, "maxWidth": 600, "layoutAdjustments": { "columns": 4, "direction": "column", "gap": 10 } },
    { "name": "md", "minWidth": 600, "maxWidth": 840, "layoutAdjustments": { "columns": 4, "direction": "row", "gap": 12 } },
    { "name": "lg", "minWidth": 840, "maxWidth": 1440, "layoutAdjustments": { "columns": 8, "direction": "row", "gap": 16 } },
    { "name": "xl", "minWidth": 1440, "maxWidth": null, "layoutAdjustments": { "columns": 12, "direction": "row", "gap": 20 } }
  ]
}
```

### 断点适配策略

| 策略 | 适用场景 |
|------|---------|
| 布局方向切换 | 小屏幕column，大屏幕row |
| 网格列数变化 | sm单列，md双列，lg三列+ |
| 组件尺寸调整 | 图标/字号/间距随断点缩放 |
| 内容显隐控制 | 小屏幕隐藏非核心组件 |

## 用户确认场景

遇到以下情况时，应主动向用户确认：

| 场景 | 确认问题示例 |
|------|-------------|
| 布局模式不确定 | "组件分布既像网格又像线性布局，请问优先哪种？" |
| 列数选择 | "网格在sm/md/lg断点下分别是2/3/4列？" |
| 间距值 | "各断点下的组件间距分别用多少？" |
| 内容显隐 | "是否需要在xs断点下隐藏某些组件？" |

## 典型场景示例

### 场景1：服务网格布局

**输入DSL（嵌套树格式）**：

```json
{
  "page": { "name": "ServicePage", "width": 375, "height": 667 },
  "ui": {
    "styles": { "padding": 16 },
    "children": [
      { "id": "item_0", "componentName": "Column", "meta": { "bbox": [16, 16, 84.6, 191.2] }, "children": [] },
      { "id": "item_1", "componentName": "Column", "meta": { "bbox": [88.6, 16, 157.2, 191.2] }, "children": [] },
      { "id": "item_2", "componentName": "Column", "meta": { "bbox": [161.2, 16, 229.8, 191.2] }, "children": [] },
      { "id": "item_3", "componentName": "Column", "meta": { "bbox": [233.8, 16, 302.4, 191.2] }, "children": [] },
      { "id": "item_4", "componentName": "Column", "meta": { "bbox": [306.4, 16, 375, 191.2] }, "children": [] }
    ]
  }
}
```

**推断结果**：

- 布局类型：grid（等宽等间距排列）
- 列数：5列
- 行数：自动

**输出响应式DSL（嵌套树）**：

```json
{
  "layoutStrategy": {
    "type": "grid",
    "gridConfig": { "columns": "repeat(5, 1fr)", "columnGap": 4, "rowGap": 4 }
  },
  "ui": {
    "children": [
      {
        "id": "item_0",
        "componentName": "Column",
        "meta": { "bbox": [16, 16, 84.6, 191.2] },
        "responsive": { "width": { "type": "flex", "value": 1 } },
        "children": []
      },
      {
        "id": "item_1",
        "componentName": "Column",
        "meta": { "bbox": [88.6, 16, 157.2, 191.2] },
        "responsive": { "width": { "type": "flex", "value": 1 } },
        "children": []
      },
      {
        "id": "item_2",
        "componentName": "Column",
        "meta": { "bbox": [161.2, 16, 229.8, 191.2] },
        "responsive": { "width": { "type": "flex", "value": 1 } },
        "children": []
      },
      {
        "id": "item_3",
        "componentName": "Column",
        "meta": { "bbox": [233.8, 16, 302.4, 191.2] },
        "responsive": { "width": { "type": "flex", "value": 1 } },
        "children": []
      },
      {
        "id": "item_4",
        "componentName": "Column",
        "meta": { "bbox": [306.4, 16, 375, 191.2] },
        "responsive": { "width": { "type": "flex", "value": 1 } },
        "children": []
      }
    ]
  },
  "breakpoints": [
    { "name": "xs", "layoutAdjustments": { "columns": 2 } },
    { "name": "sm", "layoutAdjustments": { "columns": 3 } },
    { "name": "md", "layoutAdjustments": { "columns": 4 } },
    { "name": "lg", "layoutAdjustments": { "columns": 5 } },
    { "name": "xl", "layoutAdjustments": { "columns": 6 } }
  ]
}
```

### 场景2：按钮组布局

**输入DSL（嵌套树格式）**：

```json
{
  "page": { "name": "ButtonGroup", "width": 375, "height": 667 },
  "ui": {
    "styles": { "padding": 16 },
    "children": [
      { "id": "btnCancel", "componentName": "Button", "meta": { "bbox": [16, 500, 176, 548] }, "children": [] },
      { "id": "btnConfirm", "componentName": "Button", "meta": { "bbox": [199, 500, 359, 548] }, "children": [] }
    ]
  }
}
```

**推断结果**：

- 布局类型：flex
- 方向：row
- 对齐：space-between（两端对齐）

**输出响应式DSL（嵌套树）**：

```json
{
  "layoutStrategy": {
    "type": "flex",
    "direction": "row",
    "alignment": { "horizontal": "space-between", "vertical": "center" }
  },
  "ui": {
    "children": [
      {
        "id": "btnCancel",
        "componentName": "Button",
        "meta": { "bbox": [16, 500, 176, 548] },
        "responsive": { "width": { "type": "percentage", "value": "45%" } },
        "children": []
      },
      {
        "id": "btnConfirm",
        "componentName": "Button",
        "meta": { "bbox": [199, 500, 359, 548] },
        "responsive": { "width": { "type": "percentage", "value": "45%" } },
        "children": []
      }
    ]
  },
  "breakpoints": [
    { "name": "xs", "layoutAdjustments": { "direction": "column", "gap": 16 } },
    { "name": "sm", "layoutAdjustments": { "direction": "row", "gap": 12 } }
  ]
}
```

## 使用说明

### 如何应用响应式DSL

1. **解析DSL**：读取响应式DSL文件，提取布局策略和组件配置
2. **应用布局策略**：根据layoutStrategy生成对应的布局容器
3. **配置组件**：为每个组件应用responsive配置
4. **处理断点**：根据当前屏幕尺寸应用breakpointOverrides
5. **生成最终布局**：将DSL转换为具体的UI框架代码

### 最佳实践

1. **优先使用百分比和flex布局**：确保布局在不同屏幕尺寸下的适应性
2. **设置最小和最大尺寸**：防止组件在极端尺寸下变形
3. **合理使用断点**：根据实际业务需求设置断点，避免过度设计
4. **保持布局简单**：复杂的布局应拆分为多个简单的子布局
5. **测试多种设备**：在实际设备上测试布局效果，确保响应式设计有效
