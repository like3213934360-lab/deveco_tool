# 布局推断规则

本文档定义了从绝对位置推断布局策略的核心规则。

## 基本概念

- **容器**：包含组件的父级视图，具有宽度 `containerWidth` 和高度 `containerHeight`
- **组件**：具有绝对位置 `(x, y)` 和尺寸 `(width, height)` 的UI元素
- **padding**：容器内边距，默认为 `16dp`（可根据设计系统调整）
- **容差**：位置判断允许的误差范围，默认为 `5px` 或 `2%`

## 布局策略识别规则

### 1. 水平对齐策略

| 对齐方式 | 识别规则 | 容差 | 生成DSL |
|---------|---------|------|--------|
| 水平居中 | 组件x坐标 ≈ (容器宽度 - 组件宽度) / 2 | ±5px 或 ±2% | `alignment.horizontal: "center"` |
| 水平左对齐 | 组件x坐标 ≈ 容器padding | ±5px | `alignment.horizontal: "start"` |
| 水平右对齐 | 组件x坐标 ≈ 容器宽度 - 组件宽度 - padding | ±5px | `alignment.horizontal: "end"` |
| 水平两端对齐 | 首组件x≈padding，末组件x+width≈容器宽度-padding | - | `alignment.horizontal: "space-between"` |
| 水平均匀分布 | 组件数量≥3，相邻间距差值<5%容器宽度 | - | `alignment.horizontal: "space-evenly"` |

### 2. 垂直对齐策略

| 对齐方式 | 识别规则 | 容差 | 生成DSL |
|---------|---------|------|--------|
| 垂直居中 | 组件y坐标 ≈ (容器高度 - 组件高度) / 2 | ±5px 或 ±2% | `alignment.vertical: "center"` |
| 垂直顶部对齐 | 组件y坐标 ≈ 容器padding | ±5px | `alignment.vertical: "top"` |
| 垂直底部对齐 | 组件y坐标 ≈ 容器高度 - 组件高度 - padding | ±5px | `alignment.vertical: "bottom"` |
| 垂直两端对齐 | 首组件y≈padding，末组件y+height≈容器高度-padding | - | `alignment.vertical: "space-between"` |

### 3. 网格布局识别

**识别条件**（必须同时满足）：
1. 组件数量 ≥ 4
2. 同行组件宽度差异 < 10%
3. 同列组件高度差异 < 10%
4. 横向间距一致（差异 < 15%）
5. 纵向间距一致（差异 < 15%）

**网格参数计算**：

| 参数 | 计算方式 |
|------|---------|
| 列数 | 同一y坐标范围内的组件数量最大值 |
| 行数 | 组件总数 / 列数 |
| 列间距 | 相邻列组件x坐标差 - 组件宽度 |
| 行间距 | 相邻行组件y坐标差 - 组件高度 |

**生成DSL**：
```json
{
  "layoutStrategy": {
    "type": "grid",
    "gridConfig": {
      "columns": "repeat(N, 1fr)",
      "rows": "auto",
      "columnGap": <计算值>,
      "rowGap": <计算值>
    }
  }
}
```

### 4. 混合布局识别

**场景**：同一容器内存在多种布局模式

**识别步骤**：
1. 按Y坐标对组件分组（容差20px）
2. 每组独立推断布局策略
3. 使用Flex Column包裹不同组

**生成DSL**：
```json
{
  "layoutStrategy": {
    "type": "mixed",
    "groups": [
      { "yRange": [0, 100], "strategy": { "type": "flex", "direction": "row" } },
      { "yRange": [100, 200], "strategy": { "type": "grid", "gridConfig": { "columns": "repeat(3, 1fr)" } } }
    ]
  }
}
```

### 5. 弹性布局识别

| 布局类型 | 识别规则 | 生成DSL |
|---------|---------|--------|
| 等宽分布 | 多组件宽度相等（差异<10%），水平排列 | `type: "flex"`, `direction: "row"`, `flexGrow: 1` |
| 比例分布 | 组件宽度/高度呈简单比例关系（如1:2, 1:1:2） | `type: "flex"`, `layoutWeight: [1, 2]` |

### 6. 固定比例布局

**识别规则**：组件宽度/容器宽度 ≈ 简单分数，容差 ±3%

| 比例 | 识别条件 | 生成DSL |
|------|---------|--------|
| 1/2 | 宽度 ≈ 容器宽度 × 0.5 | `width: { "type": "percentage", "value": "50%" }` |
| 1/3 | 宽度 ≈ 容器宽度 × 0.333 | `width: { "type": "percentage", "value": "33.3%" }` |
| 2/3 | 宽度 ≈ 容器宽度 × 0.667 | `width: { "type": "percentage", "value": "66.7%" }` |
| 1/4 | 宽度 ≈ 容器宽度 × 0.25 | `width: { "type": "percentage", "value": "25%" }` |

## 核心边界情况处理

### 1. 单组件满屏
- 组件宽度 ≈ 容器宽度 - 2×padding（容差±10px）
- 生成：`width: { "type": "percentage", "value": "100%" }`

### 2. 单组件固定宽度居中
- 组件宽度 < 容器宽度×70%，且水平居中
- 生成：`width: { "type": "fixed" }, margin: { "left": "auto", "right": "auto" }`

### 3. 固定+自适应混合
- 部分组件固定宽度，部分自适应
- 生成：固定组件设 `width`，自适应组件设 `flex: 1`

### 4. 重叠组件
- 组件区域有重叠
- 生成：`layoutStrategy.type: "stack"`, `zIndex` 排序

## 用户确认场景

遇到以下情况时，应主动向用户确认：

| 场景 | 确认问题示例 |
|------|-------------|
| 布局模式不确定 | "组件分布既像网格又像线性布局，请问优先哪种？" |
| 对齐方式模糊 | "按钮组对齐方式应该是两端对齐还是均匀分布？" |
| 组件分组不确定 | "这些组件应该按几列网格还是按行分组？" |

## 配置参数

### 默认值
```typescript
const DEFAULT_CONFIG = {
  padding: 16,           // 默认内边距
  tolerance: 5,          // 位置容差（像素）
  tolerancePercent: 0.02, // 位置容差（百分比）
  minGridSize: 4,        // 最小网格组件数量
  gridTolerance: {
    width: 0.1,          // 宽度差异容差
    height: 0.1,         // 高度差异容差
    spacing: 0.15        // 间距差异容差
  }
};
```

## 注意事项

1. **单位转换**：设计稿中的像素需要转换为dp/vp
2. **屏幕密度**：考虑不同设备的屏幕密度
3. **安全区域**：考虑刘海屏、圆角等安全区域
4. **横竖屏**：布局需要适配横竖屏切换
5. **动态内容**：考虑内容动态变化时的布局表现