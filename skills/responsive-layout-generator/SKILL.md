---
name: responsive-layout-generator
description: 将包含绝对位置信息的DSL转换为响应式布局DSL，符合公司UI规范。根据组件绝对位置推断布局策略，生成自适应布局代码。
version: 2.0.0
author: AI Assistant
---

# DSL转响应式布局DSL技能

## 概述

此技能帮助你将包含绝对位置信息的DSL（设计稿输出）转换为响应式布局DSL，生成符合公司UI规范的自适应布局描述。

**适用场景**：

- 从设计工具导出的绝对位置DSL转换为响应式布局DSL
- 将设计稿中的静态布局转换为自适应布局描述
- 生成符合公司UI规范的响应式组件配置

**前置条件**：

- 输入DSL包含容器尺寸和组件绝对位置信息
- 项目使用HarmonyOS ArkUI框架

## 核心概念

### 输入DSL格式（嵌套树结构）

```typescript
// ArkUI 嵌套树格式的输入DSL
interface NestedInputDSL {
  page: {
    name: string // 页面名称
    width: number // 页面宽度
    height: number // 页面高度
  }
  ui: {
    styles?: {
      // 容器样式（可选）
      width?: number | string
      height?: number | string
      padding?: number | string | PaddingValue
      margin?: number | string | MarginValue
      backgroundColor?: string
    }
    children: Array<ComponentNode> // 组件嵌套树
  }
}

interface ComponentNode {
  id?: string // 组件标识（可选，若无则按"深度-序号"自动生成）
  componentName: string // 组件类型（Text, Button, Image, Column, Row等）
  meta?: {
    bbox?: [number, number, number, number] // [x1, y1, x2, y2] 绝对位置
    octoId?: string // 原始ID
    mergedFrom?: object // 多模态合并来源
  }
  styles?: Record<string, any> // 样式属性（fontColor, backgroundColor等）
  content?: string // 文本内容
  src?: string // 图片路径
  children?: Array<ComponentNode> // 子组件（容器组件）
}
```

### 响应式DSL输出格式（嵌套树结构）

```typescript
interface ResponsiveNestedDSL {
  metadata: { version: string; generator: string; timestamp: string; source: string }
  page: { name: string; width: number; height: number }
  layoutStrategy: LayoutStrategy // 根容器的布局策略
  ui: {
    styles?: { width?: any; height?: any; padding?: any; margin?: any; backgroundColor?: string }
    children: Array<ResponsiveComponentNode> // 响应式增强后的组件树
  }
  breakpoints: Array<BreakpointConfig>
  warnings: Array<string>
  suggestions: Array<string>
}

interface ResponsiveComponentNode {
  id: string // 唯一标识（自动生成）
  componentName: string // 组件类型
  meta?: { bbox?: [number, number, number, number]; octoId?: string }
  styles?: Record<string, any> // 原始样式保留
  content?: string
  src?: string
  layoutStrategy?: LayoutStrategy // 仅容器组件（Column/Row/Grid/Stack等）有
  responsive?: {
    // 响应式配置
    width: DimensionStrategy
    height: DimensionStrategy
    position?: PositionStrategy
    margin?: MarginStrategy
    padding?: PaddingStrategy
    breakpointOverrides?: Record<string, Partial<ResponsiveComponentNode["responsive"]>>
  }
  children?: Array<ResponsiveComponentNode> // 子组件
}

interface LayoutStrategy {
  type: "flex" | "grid" | "stack" | "mixed"
  direction?: "row" | "column"
  alignment?: { horizontal: string; vertical: string }
  wrap?: boolean
  gap?: number
  gridConfig?: { columns: string; rows: string; columnGap: number; rowGap: number }
}
```

## 执行模式

- **一次性执行**：完整执行所有步骤，不再等待用户逐步确认
- **状态持久化**：在项目根目录创建 `.codegenie/{saveName}/` 目录，存储中间文件（如分块生成的 chunk_N.json）
- **断点确认**：步骤2.5 不确定事项确认仍通过 `question` 工具向用户确认，但其他步骤自动执行

## 步骤定义

### 步骤1：解析输入嵌套树DSL

- **目标**：解析嵌套树结构的DSL，递归提取所有组件节点及其绝对位置
- **输入**：ArkUI嵌套树DSL（page + ui.children[] 递归结构）
- **处理逻辑**：
  1. 读取 page 信息（页面名称、尺寸）
  2. 递归遍历 ui.children[] 嵌套树
  3. 为每个节点生成唯一 id（如无 id 则按"深度-序号"生成，如 `L0-0`, `L1-2`）
  4. 收集每个节点的 bbox 绝对位置
  5. 记录父子关系和嵌套层级
- **输出**：
  - 扁平化的组件列表（用于布局分析）
  - 原始嵌套树结构（用于输出重组）
  - 节点映射表（id ↔ 树路径）
- **验证方式**：检查 bbox 是否完整，嵌套层级是否合理

### 步骤2：分析组件位置关系

- **目标**：分析组件之间的位置关系，识别布局模式
- **输入**：步骤1递归遍历后的组件节点列表
- **输出**：组件关系分析报告，包括：
  - 水平/垂直对齐关系
  - 间距分布模式
  - 网格结构检测
  - 重叠区域检测
- **依赖**：参考文件 [references/rules.md](references/rules.md)

### 步骤2.5：不确定事项确认（重要）

- **目标**：识别并确认可能存在多种解释的布局决策
- **触发条件**：布局推断结果置信度 < 0.8 或 存在多种等效方案
- **处理方式**：调用 `question` 工具向用户确认
- **需确认的典型场景**：
  | 场景 | 确认问题示例 |
  |------|-------------|
  | 布局模式不确定 | "组件分布既像网格又像线性布局，请问优先哪种？" |
  | 断点值模糊 | "按钮高度在各断点下是否固定为48vp？" |
  | 布局方向冲突 | "小屏幕下按钮组应该垂直排列还是水平排列？" |
  | 内容显隐 | "是否需要在sm断点下隐藏副标题？" |
  | 间距/边距 | "各断点下的组件间距分别用多少？" |
  | 网格列数 | "瀑布流在sm/md/lg断点下分别是2/3/4列？" |
  | 组件优先级 | "哪些组件应在xs断点下隐藏？" |
- **输出**：确认后的布局决策

### 步骤3：推断布局策略

- **目标**：根据位置关系和已确认的决策推断最佳布局策略
- **输入**：步骤2的分析结果 + 步骤2.5的确认结果
- **输出**：布局策略建议，包括：
  - 布局类型（Flex、Grid、Stack、Mixed）
  - 对齐方式
  - 间距配置
  - 响应式断点
- **处理逻辑**：为每个容器节点（根节点及含有 children 的节点）分别推断布局策略
- **依赖**：参考文件 [references/patterns.md](references/patterns.md)

### 步骤4：生成响应式布局DSL

- **目标**：根据布局策略生成响应式布局DSL，输出嵌套树结构
- **输入**：步骤3的布局策略 + 步骤1的原始嵌套树
- **输出**：嵌套树结构的 ResponsiveNestedDSL，每个节点携带 responsive 配置
- **验证方式**：DSL结构验证，布局策略合理性检查
- **依赖**：参考文件 [references/patterns.md](references/patterns.md)
- **分块生成机制**：
  - **触发条件**：当组件数量 ≥ 8 时，必须启用分块生成模式
    - **分块策略**：参考文件 [references/chunks.md](references/chunks.md)
  - **分块模式执行流程**：
    1. 首先生成 DSL 骨架（仅包含 metadata、page、layoutStrategy、breakpoints 框架，ui.children 为空数组）
    2. 将组件按分组结果分成若干块（每块 5-7 个组件）
    3. 逐块生成各组件的完整 responsive 配置，追加到嵌套树中对应节点
    4. 每块生成完毕后写入中间文件 `{projectRoot}/.codegenie/{saveName}/chunk_N.json`
    5. 所有分块完成后进入步骤5
  - **非分块模式**：组件数量 < 8 时，一次性生成完整 DSL

### 步骤5：断点适配优化

- **目标**：优化DSL在不同断点下的布局表现
- **输入**：步骤4生成的嵌套树响应式DSL
- **输出**：优化后的嵌套树响应式DSL，包含：
  - 各断点下的布局调整
  - 组件响应式属性优化
  - 断点特定的配置覆盖
- **处理逻辑**：为每个组件节点添加 breakpointOverrides，按 id 精确指定
- **依赖**：参考文件 [references/breakpoints.md](references/breakpoints.md)

### 步骤6：生成最终响应式DSL文件

- **目标**：生成完整的响应式布局DSL文件（嵌套树结构）
- **输入**：步骤5优化后的嵌套树响应式DSL
- **输出**：JSON格式的嵌套树响应式布局DSL文件

## 布局推断规则

### 1. 水平对齐识别

- **居中识别**：组件x坐标 ≈ (容器宽度 - 组件宽度) / 2（容差±5px或±2%）
- **左对齐识别**：组件x坐标 ≈ 容器padding（容差±5px）
- **右对齐识别**：组件x坐标 ≈ 容器宽度 - 组件宽度 - padding（容差±5px）
- **两端对齐识别**：多个组件分别靠近左右边界
- **均匀分布识别**：多个组件间距大致相等（间距差异<5%容器宽度）

### 2. 垂直对齐识别

- **垂直居中识别**：组件y坐标 ≈ (容器高度 - 组件高度) / 2（容差±5px或±2%）
- **顶部对齐识别**：组件y坐标 ≈ 容器padding（容差±5px）
- **底部对齐识别**：组件y坐标 ≈ 容器高度 - 组件高度 - padding（容差±5px）
- **垂直分布识别**：多个组件垂直间距相等（间距差异<5%容器高度）

### 3. 网格布局识别

**规则网格识别条件**：

1. 组件数量 ≥ 4
2. 所有组件宽度一致（容差10%）
3. 所有组件高度一致（容差10%）
4. 横向间距一致（容差15%）
5. 纵向间距一致（容差15%）

### 4. 混合布局识别

- **场景**：同一容器内存在多种布局模式
- **处理策略**：
  1. 按Y坐标分组组件（容差20px）
  2. 每组独立推断布局策略
  3. 使用Flex Column包裹不同组

## 边界情况处理

### 1. 单组件满屏

- **识别规则**：组件宽度 ≈ 容器宽度 - 2×padding（容差±10px）
- **处理方式**：`width: { "type": "percentage", "value": "100%" }`

### 2. 单组件固定宽度居中

- **识别规则**：组件宽度远小于容器宽度（< 70%容器宽度）且居中
- **处理方式**：保持固定宽度，`margin: { "left": "auto", "right": "auto" }`

### 3. 固定+自适应混合

- **识别规则**：部分组件固定宽度，部分自适应宽度
- **处理方式**：固定组件设 `width`，自适应组件设 `flex: 1`

### 4. 重叠组件

- **识别规则**：组件区域重叠
- **处理方式**：使用 `Stack` 布局，根据z-index排序

## 响应式DSL生成规范

### 1. DSL结构规范

- 必须包含完整的metadata信息（版本、生成器、时间戳、来源）
- 页面信息必须包含 page.name、page.width、page.height
- 组件配置必须保留原始嵌套树结构，每个节点包含 responsive 属性
- 断点配置必须覆盖所有支持的屏幕尺寸
- 原始字段（children[]、meta.bbox、content、src、styles等）必须保留，不得丢失

### 2. 响应式属性规范

- 尺寸策略必须指定类型（fixed、percentage、flex、auto、minmax）
- 百分比值使用字符串格式（如 `"100%"`）
- 固定值使用数字格式（如 `48`）
- 位置策略必须明确指定类型（absolute、relative、sticky、static）

### 3. 断点配置规范

- 断点名称使用标准命名（xs、sm、md、lg、xl）
- 必须定义minWidth，可选定义maxWidth
- 组件调整通过 breakpointOverrides 按节点 id 精确指定

### 4. 命名和标识规范

- 组件id必须唯一且具有描述性
- 组件componentName使用标准ArkUI类型名称
- 断点名称使用小写字母
- 属性名使用camelCase命名法

## 参考文件

| 文件 | 用途 |
|------|------|
| [references/rules.md](references/rules.md) | 布局推断详细规则 |
| [references/breakpoints.md](references/breakpoints.md) | 断点定义和适配规则 |
| [references/patterns.md](references/patterns.md) | 布局模式识别和DSL模板 |
| [references/chunks.md](references/chunks.md) | 响应式布局 DSL 分块生成机制 |
| [references/multi-device-responsive-layout.md](references/multi-device-responsive-layout.md) | 多设备响应式布局详解 |

## 检查清单

### 布局推断检查

- [ ] 组件位置关系分析完成
- [ ] 布局策略识别正确
- [ ] 边界情况处理妥当
- [ ] 响应式断点考虑周全

### DSL生成检查

- [ ] 生成的DSL结构完整且符合规范
- [ ] 布局策略正确实现推断结果
- [ ] 响应式断点配置合理
- [ ] 组件响应式属性配置正确
- [ ] DSL通过JSON Schema验证

### 输出验证检查

- [ ] 生成的DSL包含完整布局信息
- [ ] 断点配置覆盖所有目标设备
- [ ] 警告和建议信息清晰明确
- [ ] 元数据信息完整准确
- [ ] DSL文件格式正确可解析

## 错误处理

### 1. DSL解析错误

- **错误类型**：JSON格式错误、缺少必需字段（page/width/height/ui/children）、数据类型错误
- **处理方式**：提供详细错误信息，指导用户修正DSL

### 2. 布局推断错误

- **错误类型**：无法识别布局模式、组件位置异常、嵌套层级过深
- **处理方式**：提供备选布局策略，记录警告信息

### 3. DSL生成错误

- **错误类型**：JSON格式错误、类型错误、结构错误
- **处理方式**：使用JSON Schema验证，提供修正建议

### 4. 断点适配错误

- **错误类型**：布局在某个断点下显示异常
- **处理方式**：调整布局策略，记录警告信息

## 扩展性考虑

### 1. 自定义布局规则

支持通过配置文件自定义布局识别规则：

```json
{
  "customRules": {
    "horizontalAlignment": { "tolerance": 5, "padding": 16 },
    "gridDetection": { "minColumns": 2, "minRows": 2, "spacingTolerance": 0.1 }
  }
}
```

### 2. 插件系统

支持第三方插件扩展布局识别能力：

- 自定义组件类型识别
- 特殊布局模式识别
- 行业特定布局规则

### 3. 模板系统

支持自定义代码模板：

- 公司特定的UI组件库
- 项目特定的布局模式
- 团队约定的代码风格

## 更新日志

### v3.0.0 (2026-05-15)
- **重大变更**：输入/输出格式从扁平列表改为嵌套树结构
- 输入DSL改为 `page + ui.children[]` 递归嵌套格式，直接接收 ArkUI DSL
- 输出DSL改为嵌套树结构，每个节点携带 responsive 属性
- 删除了"格式转换"中间步骤（不再需要将嵌套树转换为扁平列表）
- 删除了状态恢复机制，改为一次性执行模式
- 布局推断为每个容器节点分别生成 layoutStrategy
- 断点配置通过 breakpointOverrides 按节点 id 精确指定

### v2.0.0 (2026-05-09)
- 精简核心规则，删除过度细节的设备和边界case
- 统一5个标准断点（xs/sm/md/lg/xl）
- 新增步骤2.5：不确定事项用户确认机制
- 删除3个完整示例代码
- 删除分块生成机制细节
- 整合断点定义到breakpoints.md

### v1.1.0 (2025-04-14)
- 新增分块生成策略
- 步骤4和步骤6支持分块生成与合并

### v1.0.0 (2024-01-01)
- 初始版本发布
- 支持基本布局策略识别
- 生成响应式ArkUI布局代码
