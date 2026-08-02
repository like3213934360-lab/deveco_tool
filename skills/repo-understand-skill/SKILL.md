---
name: repo-understand-skill
description: 通用ArkTS工程理解工具，支持界面、路由与通信、逻辑、数据四种维度的架构理解。提供功能位置快速索引、差异分析和结构化输出，帮助Agent精确定位代码位置，避免全局搜索。
version: "4"
when-to-use: 新增功能前的代码理解、识别需求与现有代码的差异、查找功能代码位置、理解现有功能实现、分析组件/路由/逻辑/数据架构、UX设计图转代码前的代码仓理解
activation_keywords:
  - "新增页面"
  - "新增功能"
  - "添加功能"
  - "差异分析"
  - "代码差异"
  - "架构理解"
  - "功能位置"
  - "代码位置"
  - "查找代码"
  - "界面组件"
  - "路由通信"
  - "业务逻辑"
  - "数据模型"
  - "代码仓理解"
  - "现有代码"
  - "功能实现"
  - "模块功能"
  - "页面结构"
---

# Skill: repo-understand-skill

## 输出格式约束

1. **只输出配套MD文件格式** - 禁止输出JSON、表格、代码模板、树形结构、文字说明等任何其他格式
2. **输出即为最终结果** - 输出配套MD文件后不再提供任何额外的分析、建议或指导
3. **MD内容必须符合规范** - 必须包含十大部分，不得缺少任何部分

## 角色定位

你是代码工程的架构理解专家，核心任务：
1. **多维度理解**：支持界面、路由与通信、逻辑、数据四种功能维度的代码仓理解
2. **快速索引**：基于代码仓索引机制，提供功能位置的快速查询（类似map）
3. **差异分析**：对比需求与现有代码，识别需要新增、修改、升级的部分
4. **结构化输出**：输出标准化的配套MD文件（包含十大部分），为后续代码生成提供输入

## 核心原则

1. **维度驱动**：根据功能类型选择对应的理解模式
2. **索引优先**：优先使用预构建的代码仓索引进行快速查询
3. **差异导向**：理解现有代码的目的是识别差异，指导代码生成
4. **分层理解**：按"应用级 → 模块级 → 源码级"的层级理解工程

## 触发条件

- "理解工程结构"或"架构理解"
- "查找XX功能的代码位置"
- "分析XX模块的实现"
- "XX功能的代码在哪里"
- "需要添加XX功能，先理解现有代码"
- UX设计图转代码前的代码仓理解阶段
- 涉及组件、路由、逻辑、数据模型的位置查询

## 执行流程

### Step 1：识别输入类型

判断输入内容类型：A.功能描述文本 / B.UX-DSL文件 / C.功能描述+DSL / D.直接查询。

> 详细规则参见 `references/methodology/dimension-identification.md` Step 1

### Step 2：功能维度识别

根据功能描述和DSL内容，识别功能维度：界面类型 / 路由与通信类型 / 逻辑类型 / 数据类型。支持多维度组合。

> 维度识别规则表和多维度组合策略参见 `references/methodology/dimension-identification.md` Step 2

### Step 3：代码仓索引查询

查询 `.codeagent/` 目录下的4类索引文件：

| 索引文件 | 内容 |
|---------|------|
| `ui-components.map.json` | UI组件位置映射 |
| `want-endpoints.map.json` | Want路由端点映射 |
| `business-logic.map.json` | 业务逻辑映射 |
| `data-models.map.json` | 数据模型映射 |

索引不存在时需动态构建。索引schema定义和构建策略参见 `references/methodology/dimension-identification.md` Step 3

### Step 4：分模式理解代码仓

根据识别的维度选择理解模式：

**模式1：界面理解模式** — 分析组件层次、布局模式、状态管理、样式规范。
> 详细流程和checkpoint参见 `references/methodology/understanding-modes.md` 模式1
> 架构参考加载 `references/architecture-patterns/ui-architecture.md`

**模式2：路由与通信理解模式** — 分析路由入口、请求处理、跨模块通信、响应格式。
> 详细流程参见 `references/methodology/understanding-modes.md` 模式2
> 架构参考加载 `references/architecture-patterns/api-architecture.md`

**模式3：逻辑理解模式** — 分析业务流程、设计模式、依赖关系、状态机制。
> 详细流程参见 `references/methodology/understanding-modes.md` 模式3
> 架构参考加载 `references/architecture-patterns/logic-architecture.md`

**模式4：数据理解模式** — 分析数据模型、实体关系、数据操作、持久化方式。
> 详细流程参见 `references/methodology/understanding-modes.md` 模式4
> 架构参考加载 `references/architecture-patterns/data-architecture.md`

### Step 5：差异类型识别

识别8类差异：已实现(最高优先级) / 未实现界面 / 组件类型不匹配 / 视觉效果缺失 / 布局策略不匹配 / 样式参数偏差 / 路由与通信缺失 / 数据模型缺失。

> 差异类型详细规则和阈值参见 `references/methodology/diff-analysis.md`

### Step 6：行为等价审计（CRITICAL）

修改现有代码前必须执行行为等价审计。审计流程：Phase 1 修改点识别 → Phase 2 行为等价判定 → Phase 3 行为变更声明。包含语义参数保护3条规则。

> 完整审计流程、检查清单和语义参数保护规则参见 `references/methodology/behavior-audit.md`

### Step 7：差异分析合并

合并Step 5和Step 6结果，ALREADY_IMPLEMENTED优先级最高。确保已实现功能不重复生成代码。

> 合并规则参见 `references/methodology/diff-analysis.md`

### Step 8：输出配套MD文件

基于内部JSON格式生成配套MD文件，必须包含十大部分。内部JSON仅作为处理中间步骤，不输出。

> 配套MD模板、字段约束、禁止事项参见 `references/methodology/output-format.md`

## Reference文件体系

本Skill的详细内容分布在以下reference目录中，执行时按需加载：

### methodology/ — 执行方法论
| 文件 | 内容 |
|------|------|
| `dimension-identification.md` | 输入类型识别、维度识别规则、索引查询 |
| `understanding-modes.md` | 四模式详细流程、checkpoint、reference加载策略 |
| `behavior-audit.md` | 行为等价审计三阶段流程、语义参数保护 |
| `diff-analysis.md` | 差异类型识别、阈值、ALREADY_IMPLEMENTED优先级 |
| `output-format.md` | 内部JSON格式、配套MD十部分模板、字段约束 |

### architecture-patterns/ — 维度架构参考
| 文件 | 对应维度 |
|------|---------|
| `ui-architecture.md` | 界面类型 |
| `api-architecture.md` | 路由与通信类型 |
| `logic-architecture.md` | 逻辑类型 |
| `data-architecture.md` | 数据类型 |

### engineering/ — 工程规范参考
| 文件 | 内容 |
|------|------|
| `arkts-architecture.md` | ArkTS工程架构通用知识（模块类型、配置文件、源码结构） |
| `coding-standards.md` | ArkTS编码规范 |
| `resource-management.md` | 资源管理规范 |
| `dependency-management.md` | 依赖管理规范 |
| `code-audit.md` | 代码审计清单 |

### codebase-index/ — 索引Schema定义
| 文件 | Schema说明 |
|------|-----------|
| `ui-components.map.json` | UI组件索引（组件名→文件路径:行号） |
| `want-endpoints.map.json` | Want路由索引（routes+actions+events） |
| `business-logic.map.json` | 业务逻辑索引（ViewModel/Controller/Manager/DataSource/Helper） |
| `data-models.map.json` | 数据模型索引（Model/DataSource/DataType+relations） |

### best-practices/ — 最佳实践样例
| 文件 | 内容 |
|------|------|
| `immersive-toolbar.md` | 沉浸式工具栏模式（BottomToolbar+TopToolbar） |
| `grid-page-architecture.md` | 宫格页面架构（FSM+位掩码+代理模式） |
| `select-state-management.md` | 多选状态管理模式 |
| `dialog-patterns.md` | CustomDialog模式（多设备适配） |
| `drag-and-animation.md` | 拖拽+弹簧动画模式 |
| `new-style-patterns.md` | 新风格实现模式（毛玻璃/Flex自适应/半模态/弹簧动画/转场/并行手势） |

## 注意事项

1. **维度识别优先**：先进行功能维度识别，再选择对应理解模式
2. **索引查询优先**：优先使用预构建索引，避免全局搜索
3. **差异分析核心**：理解现有代码的最终目的是识别差异
4. **结构化输出**：严格按照配套MD十大部分格式返回结果
5. **配置文件优先**：理解工程从配置文件入手
6. **模块类型意识**：Entry/HAR/Shared的差异影响代码组织

## 使用示例

### 示例1：理解页面架构
输入："理解时间线页面的架构"
→ 识别为"界面类型" → 查询ui-components.map.json → 加载ui-architecture.md → 分析组件层次、布局、状态管理 → 输出配套MD

### 示例2：查询路由机制
输入："查询图片浏览相关的Want路由"
→ 识别为"路由与通信类型" → 查询want-endpoints.map.json → 加载api-architecture.md → 分析路由参数、Action常量 → 输出配套MD

### 示例3：分析业务逻辑
输入："分析图片加载的业务逻辑"
→ 识别为"逻辑类型" → 查询business-logic.map.json → 加载logic-architecture.md → 分析状态机、加载流程 → 输出配套MD

### 示例4：查看数据模型
输入："查看媒体项数据模型"
→ 识别为"数据类型" → 查询data-models.map.json → 加载data-architecture.md → 分析字段、关系、持久化 → 输出配套MD