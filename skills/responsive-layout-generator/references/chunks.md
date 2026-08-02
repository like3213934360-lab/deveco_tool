# 分块生成策略

## 概述
当输入组件数量较多时，一次性生成完整的响应式DSL会导致输出过长，超出模型生成能力限制而产生截断或失败。分块生成策略通过将长输出拆分为多个小块，逐块生成后再合并，确保生成过程的稳定性。

## 1. 触发阈值

| 组件数量 | 生成模式 | 说明 |
|---------|---------|------|
| 1-7 | 单次生成 | 输出长度可控，一次性生成完整DSL |
| 8-14 | 分块生成（2块） | 每块约4-7个组件 |
| 15-21 | 分块生成（3块） | 每块约5-7个组件 |
| 22-28 | 分块生成（4块） | 每块约5-7个组件 |
| 29-35 | 分块生成（5块） | 每块约5-7个组件 |
| 36+ | 分块生成（⌈N/7⌉块） | 每块不超过7个组件 |

**判断公式**：
- 如果组件数 < 8：单次生成
- 如果组件数 ≥ 8：分块数 = ⌈组件数 / 7⌉（向上取整，确保每块不超过8个组件）

## 2. 分块原则

### 2.1 分块维度：按组件分组
- **优先按布局分组（Y坐标分组）分块**：同一行/同一布局组的组件放入同一块，避免割裂布局语义
- **组内组件数限制**：每块不超过 7 个组件
- **组间合并**：如果某组组件数不足 3 个，与相邻组合并（合并后不超过 7 个）

### 2.2 分块内容
每个分块文件包含以下结构：
```typescript
interface ChunkDSL {
  // 分块元数据
  chunkMeta: {
    chunkIndex: number;      // 当前块序号（从1开始）
    totalChunks: number;     // 总块数
    componentIds: string[];  // 本块包含的组件id列表
    sourceGroup: string;     // 来源布局分组名称（如"row1", "grid-group"）
  };

  // 本块的组件配置
  components: Array<ComponentConfig>;

  // 本块涉及的断点组件调整（仅包含本块组件的调整）
  breakpointAdjustments: Array<{
    breakpointName: string;
    componentAdjustments: Array<{
      id: string;
      adjustments: Partial<ComponentConfig['responsive']>;
    }>;
  }>;
}
```

### 2.3 骨架文件
首次分块时，先生成 DSL 骨架文件 `{projectRoot}/.codegenie/{saveName}/skeleton.json`，包含除 components 之外的所有结构：
```typescript
interface SkeletonDSL {
  metadata: {
    version: string;
    generator: string;
    timestamp: string;
    source: string;
  };
  container: {
    width: number;
    height: number;
    padding: { top: number; bottom: number; left: number; right: number; };
    safeArea: { top: number; bottom: number; left: number; right: number; };
  };
  layoutStrategy: LayoutStrategy;
  breakpoints: Array<BreakpointConfig>;  // 不含 componentAdjustments
  warnings: string[];
  suggestions: string[];
  // 占位：标记需要合并填充的位置
  _mergeSlots: {
    components: true;                    // 需要合并 components
    breakpointAdjustments: true;         // 需要合并 componentAdjustments
  };
}
```

## 3. 分块生成工作流

```
输入DSL（N个组件，N≥8）
  │
  ├─ 步骤4a：判断分块数量 → ⌈N/7⌉ 块
  │
  ├─ 步骤4b：按Y坐标分组，确定每块包含的组件
  │
  ├─ 步骤4c：生成骨架文件 skeleton.json
  │   （metadata + container + layoutStrategy + breakpoints框架）
  │
  ├─ 步骤4d：逐块生成 chunk_1.json
  │   → 仅输出第1块组件的 ComponentConfig 和 breakpointAdjustments
│   → 写入 .codegenie/{saveName}/chunks/chunk_1.json
   │   → 更新 skill_state.md 标记 chunk_1 完成
   │
   ├─ 步骤4d：逐块生成 chunk_2.json
   │   → 仅输出第2块组件的 ComponentConfig 和 breakpointAdjustments
   │   → 写入 .codegenie/{saveName}/chunks/chunk_2.json
  │   → 更新 skill_state.md 标记 chunk_2 完成
  │
  ├─ ...（重复直到所有分块完成）
  │
  └─ 步骤4e：所有分块完成 → 进入步骤5

步骤5：断点适配优化（对每个 chunk 独立优化或整体优化）

步骤6a：读取 skeleton.json + 所有 chunk_N.json
步骤6b：合并 components 数组（按分块顺序追加）
步骤6c：合并 breakpointAdjustments 到对应断点
步骤6d：验证合并结果完整性
步骤6e：输出最终 responsive-dsl.json
步骤6f：清理 .codegenie/{saveName}/chunks/ 目录
```

## 4. 分块生成关键约束

### 4.1 每块输出的严格限制
- **每块仅包含本块组件的配置**，不重复输出骨架信息
- **每块输出格式**：必须是合法的 ChunkDSL JSON，可直接写入文件
- **每块组件数上限**：不超过 7 个组件，超出则需进一步拆分
- **组件 id 唯一性**：不同分块的组件 id 不可重复
- **引用完整性**：分块中的 breakpointOverrides 引用的断点名称必须与骨架中的 breakpoints 一致

### 4.2 上下文保持
- 生成每个分块时，必须提供以下上下文信息（通过 skill_state.md 或直接传递）：
  - 骨架的 layoutStrategy（确保组件 responsive 配置与布局策略一致）
  - 容器尺寸信息（用于计算百分比等响应式值）
  - 已生成分块的组件 id 列表（避免重复）
  - 本块组件在原始输入 DSL 中的绝对位置信息

### 4.3 容错与恢复
- 如果某块生成失败（截断/格式错误），仅重新生成该块，不影响已完成的其他分块
- 通过 `skill_state.md` 中记录的完成状态，支持从断点恢复
- 每块生成后立即做 JSON 格式验证，确保可解析

## 5. 合并规则

### 5.1 components 合并
- 按分块序号（chunk_1, chunk_2, ...）顺序，将各块的 `components` 数组追加到骨架的 `components` 字段
- 保持组件在原始 DSL 中的出现顺序

### 5.2 breakpointAdjustments 合并
- 遍历所有分块的 `breakpointAdjustments`
- 对于同一断点名称的 componentAdjustments，合并为一个数组
- 合并后的结构写入对应 BreakpointConfig 的 `componentAdjustments` 字段

### 5.3 warnings 和 suggestions 合并
- 各分块可能产生各自的 warnings 和 suggestions
- 合并时去重后追加到骨架对应字段

### 5.4 合并验证
- [ ] 合并后组件总数 == 原始输入组件总数
- [ ] 所有组件 id 无重复
- [ ] 所有断点引用有效（breakpointOverrides 中的断点名称在 breakpoints 中存在）
- [ ] JSON 格式合法

## 6. 中间文件结构

```
{projectRoot}/.codegenie/{saveName}/
├── skill_state.md              # 状态追踪文件
├── skeleton.json               # DSL骨架
├── chunks/
│   ├── chunk_1.json            # 分块1
│   ├── chunk_2.json            # 分块2
│   └── ...
└── output/
    └── responsive-dsl.json     # 最终合并输出
```

## 7. skill_state.md 分块状态格式

```markdown
# Adaptive Layout Generator 状态

## 当前步骤
步骤4 - 分块生成响应式布局DSL

## 分块进度
- 总块数: 3
- 已完成块: [1, 2]
- 待生成块: [3]
- 当前块: 3

## 组件分配
- chunk_1: [btnSubmit, btnCancel, btnConfirm, inputName] (4个组件)
- chunk_2: [card1, card2, card3, card4, card5] (5个组件)
- chunk_3: [footer1, footer2, footer3] (3个组件)

## 骨架信息
- layoutStrategy.type: flex
- layoutStrategy.direction: column
- container.width: 375
- container.height: 667

## 文件清单
- skeleton.json ✓
- chunk_1.json ✓
- chunk_2.json ✓
- chunk_3.json (待生成)
```
