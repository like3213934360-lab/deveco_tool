# 配套MD输出格式规范

> 本文件定义 Skill 执行流程的 Step 8 详细规则——内部JSON格式、配套MD文件模板、字段约束和禁止事项。

## 输出格式约束

**本Skill必须严格遵守以下输出规范**：

1. **只输出配套MD文件格式** - 禁止输出JSON、表格、代码模板、树形结构、文字说明等任何其他格式
2. **输出即为最终结果** - 输出配套MD文件后不再提供任何额外的分析、建议或指导
3. **MD内容必须符合规范** - 必须包含十大部分，不得缺少任何部分

## 内部处理格式（JSON，不输出）

首先在内部生成架构理解JSON格式（仅作为内部处理中间步骤，不输出）：

```json
{
  "functionType": "界面类型|路由与通信类型|逻辑类型|数据类型（必须选择其一，禁止组合）",
  "entryFile": "入口文件路径",
  "architecture": {
    "pattern": "架构模式（如MVVM、组件化、分层架构）",
    "layers": ["分层列表"],
    "framework": "框架类型（如ArkUI）"
  },
  "components": {
    "main": "主组件/主类",
    "children": ["子组件/子类列表"],
    "reusable": ["可复用组件/类列表"]
  },
  "layout": {
    "type": "布局类型",
    "direction": "方向",
    "adaptive": "是否自适应"
  },
  "stateManagement": {
    "type": "状态管理类型",
    "store": "存储方式"
  },
  "dependencies": {
    "internal": ["内部依赖"],
    "external": ["外部依赖"]
  },
  "conventions": {
    "naming": "命名规范",
    "fileStructure": "文件结构",
    "importOrder": "导入顺序"
  },
  "existingCode": {
    "files": ["已实现文件列表"],
    "components": ["已实现组件/类列表"],
    "features": ["已实现功能点列表"]
  },
  "differences": [
    {
      "type": "差异类型（已实现|未实现界面|组件类型不匹配|视觉效果缺失|布局策略不匹配|样式参数偏差|路由与通信缺失|数据模型缺失）",
      "description": "差异描述",
      "dslComponent": { "type": "需求组件类型", "props": {} },
      "existingComponent": { "type": "现有组件类型", "props": {} },
      "expected": "期望值",
      "actual": "实际值",
      "action": "处理动作",
      "existingImplementation": { "file": "现有实现文件路径", "line": "行号", "description": "现有实现描述" }
    }
  ],
  "behaviorAudit": {
    "status": "PASS|FAIL|EQUIVALENT_ONLY",
    "behaviorChangeCount": 0,
    "semanticReuseCount": 0,
    "behaviorChanges": [
      {
        "file": "文件路径", "line": "行号", "functionName": "函数名",
        "changeType": "REDIRECTIVE|REMOVING|REPLACING",
        "originalBehavior": "原始行为描述", "modifiedBehavior": "修改后行为描述",
        "userImpact": "用户体验影响描述", "userConfirmed": false
      }
    ],
    "semanticReuses": [
      {
        "parameterName": "参数名", "originalSemantics": "原始语义",
        "newSemantics": "新语义", "location": "文件路径:行号",
        "recommendation": "建议：新增参数XXX而不是复用现有参数"
      }
    ]
  },
  "summary": {
    "totalDifferences": 0,
    "alreadyImplemented": 0,
    "missingImplementations": 0,
    "visualEffectUpgrades": 0,
    "layoutAdjustments": 0,
    "styleAdjustments": 0
  }
}
```

## 最终输出格式（配套MD文件）

基于内部JSON格式，生成配套MD文件并输出。配套MD文件必须包含以下十大部分：

```markdown
# 代码生成约束规范

## 一、项目信息
- 项目名称：{projectName}
- 框架版本：{frameworkVersion}
- 编码规范：{codingStandard}

## 二、架构约束
- 架构模式：{architecturePattern}
- 分层结构：{layerStructure}
- 模块划分：{moduleStructure}

## 三、命名规范
- 文件命名：{fileNaming}
- 类命名：{classNaming}
- 方法命名：{methodNaming}
- 变量命名：{variableNaming}

## 四、代码风格
- 缩进：{indentation}
- 最大行宽：{maxLineWidth}
- 注释规范：{commentStandard}

## 五、当前代码仓相关代码

### 5.1 已实现文件列表
{existingFilesList}

### 5.2 已实现组件清单
{existingComponentsList}

### 5.3 已实现功能点
{existingFeaturesList}

## 六、需要补充实现的部分

### 6.1 新增界面
{newInterfaces}

### 6.2 新增组件
{newComponents}

### 6.3 视觉效果升级
{visualEffectUpgrades}

### 6.4 布局调整
{layoutAdjustments}

### 6.5 样式调整
{styleAdjustments}

## 七、差异分析摘要
- 总差异数：{totalDifferences}
- 已实现（最高优先级）：{alreadyImplemented}
- 未实现界面：{missingImplementations}
- 视觉效果升级：{visualEffectUpgradesCount}
- 布局调整：{layoutAdjustmentsCount}
- 样式调整：{styleAdjustmentsCount}

## 七点五、已实现功能确认（需求功能在代码中的对应实现）

> **这是最高优先级检查项。在说"需要实现什么"之前，必须先确认"什么已经实现了"。**

{alreadyImplementedList}
- 每个条目说明：需求功能 → 现有实现文件:行号 → 实现状态 ✅

## 七点六、行为变更日志

> **仅当存在行为变更时输出此章节。如果无行为变更，写"无行为变更"。**

{behaviorChangeLog}
- 每个行为变更包含：
  - 修改点: 文件路径:行号 函数名
  - 原始行为 → 修改后行为
  - 用户影响
  - 用户是否已确认（未确认时禁止实施）

## 七点七、语义参数保护检查

> **检查是否有参数被复用语义。**

{semanticProtectionCheck}
- 语义参数复用检查：✅ 无 / ❌ 发现N处
- 如有复用，每个条目说明：参数名、原始语义、被用于、新语义、建议

## 八、约束规则
1. {rule1}
2. {rule2}
...

## 九、禁止事项
1. {forbidden1}
2. {forbidden2}
...

## 十、代码生成行为规范

1. **已实现不重复**：需求功能在现有代码中已完整实现时，禁止生成新的重复代码。直接引用现有实现。
2. **行为等价优先**：修改现有代码时，必须证明修改后行为与原始行为等价。行为变更必须显式声明。
3. **语义参数保护**：禁止复用已有参数的语义来承担新的导航/传参职责。必须新增专门的参数。
4. **布局约束必填**：Stack容器中的组件必须有明确的位置约束（`.position()` 或 `alignContent`）。
```

## 配套MD生成示例

```markdown
# 代码生成约束规范

## 一、项目信息
- 项目名称：MyApp（示例应用）
- 框架版本：HarmonyOS SDK 5.0
- 编码规范：ArkTS编码规范

## 二、架构约束
- 架构模式：MVVM + 模块化架构
- 分层结构：View -> ViewModel -> Model
- 模块划分：entry/（入口模块）、feature/（特性模块）、common/（公共模块）

## 三、命名规范
- 文件命名：PascalCase（如DetailPage.ets）
- 类命名：PascalCase
- 方法命名：camelCase
- 变量命名：camelCase

## 四、代码风格
- 缩进：2空格
- 最大行宽：120字符
- 注释规范：JSDoc

## 五、当前代码仓相关代码

### 5.1 已实现文件列表
- entry/src/main/ets/pages/HomePage.ets（主页）
- feature/detail/src/main/ets/view/DetailView.ets（详情视图）
- common/src/main/ets/model/ItemModel.ets（数据模型）

### 5.2 已实现组件清单
- HomePage组件（主页容器）
- DetailView组件（详情展示）
- ItemCard组件（卡片项展示，可复用）

### 5.3 已实现功能点
- 列表浏览
- 详情查看
- 数据加载与分页

## 六、需要补充实现的部分

### 6.1 新增界面
- 筛选面板（需求定义了FilterPanel但代码仓未实现）

### 6.2 新增组件
- PullToRefresh组件（需求定义了下拉刷新）

### 6.3 视觉效果升级
- ItemCard组件：添加毛玻璃效果
  - 当前：backgroundColor = "#FFFFFF"
  - 目标：backgroundColor = "rgba(255,255,255,0.6)", backdropBlur = 20

### 6.4 布局调整
- 列表宫格：从左对齐改为水平两端对齐
  - 当前：justifyContent: FlexStart
  - 目标：justifyContent: SpaceBetween

### 6.5 样式调整
- 卡片圆角：从4dp调整为8dp
- 卡片间距：从2dp调整为4dp

## 七、差异分析摘要
- 总差异数：5
- 已实现（最高优先级）：2
- 未实现界面：1
- 新增组件：1
- 视觉效果升级：1
- 布局调整：1
- 样式调整：2

## 七点五、已实现功能确认
- 列表浏览 → HomePage.ets:15 → ✅ 已实现
- 详情查看 → DetailView.ets:20 → ✅ 已实现

## 七点六、行为变更日志
无行为变更。✅ 行为等价审计通过。

## 七点七、语义参数保护检查
语义参数复用检查：✅ 无

## 八、约束规则
1. 使用@State管理组件状态
2. 使用@Prop传递只读数据
3. 使用Navigation进行页面跳转
4. 组件命名使用PascalCase
5. 方法命名使用camelCase
6. 遵循模块化架构，禁止跨层依赖
7. 已实现功能不重复生成代码
8. 修改现有代码前必须通过行为等价审计

## 九、禁止事项
1. 禁止使用any类型
2. 禁止在组件中直接修改@Prop
3. 禁止硬编码样式值（使用系统资源$r）
4. 禁止跨层直接依赖
5. 禁止复用语义参数
6. 禁止把行为变更伪装为"恢复"或"增强"

## 十、代码生成行为规范
1. **已实现不重复**：需求功能在现有代码中已完整实现时，禁止生成新的重复代码。
2. **行为等价优先**：修改现有代码时，必须证明修改后行为与原始行为等价。
3. **语义参数保护**：禁止复用已有参数的语义来承担新的导航/传参职责。
4. **布局约束必填**：Stack容器中的组件必须有明确的位置约束。
```

## 字段约束说明

**必须严格遵守以下字段约束**：

| 字段路径 | 类型/格式 | 约束说明 | 错误示例 |
|---------|----------|---------|----------|
| functionType | 枚举值 | 必须是以下单一值之一：`界面类型`、`路由与通信类型`、`逻辑类型`、`数据类型`。**禁止组合值** | ❌ `"数据类型+路由与通信类型"` ✅ `"路由与通信类型"` |
| layout.type | 字符串 | 不适用时使用空字符串 `""`，**禁止使用"N/A"** | ❌ `"N/A"` ✅ `""` |
| layout.direction | 字符串 | 不适用时使用空字符串 `""` | ❌ `"N/A"` ✅ `""` |
| stateManagement.type | 字符串 | 不适用时使用空字符串 `""` | ❌ `"N/A"` ✅ `""` |
| stateManagement.store | 字符串 | 不适用时使用空字符串 `""` | ❌ `"N/A"` ✅ `""` |
| summary.totalDifferences | 数字 | **必须是数字类型** | ❌ `"2"` ✅ `2` |
| summary.missingImplementations | 数字 | **必须是数字类型** | ❌ `"1"` ✅ `1` |
| summary.visualEffectUpgrades | 数字 | **必须是数字类型** | ❌ `"0"` ✅ `0` |
| summary.layoutAdjustments | 数字 | **必须是数字类型** | ❌ `"0"` ✅ `0` |
| summary.styleAdjustments | 数字 | **必须是数字类型** | ❌ `"0"` ✅ `0` |

## 禁止事项

- ❌ 输出JSON
- ❌ 输出表格
- ❌ 输出代码模板
- ❌ 输出树形结构
- ❌ 添加MD模板中未定义的部分
- ❌ 输出配套MD文件之外的任何内容