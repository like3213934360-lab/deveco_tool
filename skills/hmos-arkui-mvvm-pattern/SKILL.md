---
name: "hmos-arkui-mvvm-pattern"
description: "HarmonyOS ArkUI MVVM 架构技能。适用于：(1) 项目分层设计 Model/ViewModel/View (2) 目录结构规划 (3) 组件职责与数据流规范 (4) 视图架构检视以及整改项目为MVVM模式等场景。在有以下请求时触发：1.在ArkUI中明确要求使用MVVM架构来添加或重构功能，并要求保持架构简洁。2.明确要求使用MVVM架构创建或改进视图模型，并将逻辑从视图中移出。3.修复状态管理混乱的问题。4.提升项目可测试性，通过拆分结构降低复杂度。5.将已有项目整改为 MVVM 架构。"
metadata:
  version: 1.0.0
  keywords:
    - ArkUI
    - MVVM
    - 状态管理V1版本下的MVVM架构
    - 状态管理V2版本下的MVVM架构
    - 架构分层
    - Model层
    - ViewModel层
    - View层
---

# ArkUI MVVM 架构模式

## 技能定义

| 字段 | 内容 |
| --- | --- |
| `skill_id` | `arkui-mvvm-pattern` |
| `skill_name` | `ArkUI MVVM 架构模式` |
| `one_line_purpose` | `MVVM架构模式开发或重构，包括状态管理V1和V2版本下的MVVM实现` |
| `device_scope` | `phone / tablet / 2in1` |
| `problem_scope` | `MVVM 三层分层、View、Model、ViewModel` |
| `not_in_scope` | `状态管理 V1/V2 装饰器用法、非 MVVM 的架构模式` |
| `primary_outputs` | `primary_scene`、`implementation_notes`、`code_touchpoints`、`verification_matrix` |

## 核心约束

1. **维持当前项目版本**：除非开发者明确表示迁移至V2，默认维持当前状态管理的版本，避免V1与V2混用
2. **单向数据流 (UDF)**：数据向下流动 Model → ViewModel → View，事件向上传递 View → ViewModel → Model
3. **单一数据源 (SSOT)**：数据修改只发生在数据层，ViewModel 是 UI 状态的唯一来源
4. **View 禁止直接访问 Model**：必须通过 ViewModel 间接访问
5. **减少 AppStorage使用**：不到万不得已不使用 AppStorage/AppStorageV2，ViewModel 应直接持有状态
6. **V1 @Observed + @Track 与 getter 不能共存**：V1 的 `@Observed` 类中，如果使用了 `@Track` 装饰属性，则不能在该类中定义 `get` 访问器（getter），否则运行时会闪退。getter 在 V1 `@Observed` 中必须与无 `@Track` 的类配合使用
7. **View 通过 ViewModel 类型访问数据**：View/Page 层禁止 import Model 类型。每种列表项都应有对应的 `@Observed` ViewModel 类（如 `CardViewModel`、`MessageItemViewModel`），在 ViewModel 层完成 Model → ViewModel 的转换。View 的 ForEach 回调中只能出现 ViewModel 类型，不出现 Model 接口类型

### 保持当前项目版本

接手一个项目时，先判断它用的是 V1 还是 V2，再决定后续操作：

**快速检测**：搜索项目中任意一个 `.ets` 文件，看 `@Component` 还是 `@ComponentV2`。如果项目中两者都有，说明已经混用，需要确定以哪个为主再统一。

### 状态变量原则

新建和整改都遵循。业界通称**状态提升**（State Hoisting）：状态就近持有，按需上提。

遇到一个状态变量时，按以下顺序判断归属：

```
这个值能从已有属性计算出来吗？
├─ 能 → 不存储，用 @Computed（V2）或 getter（V1）
│        例：canSubmit = inputContent.length === 11 && password.length > 0
│
└─ 不能，是独立数据源
    ├─ 只有一个组件关心？
    │   └─ 视图私有 → @Local（V2）/ @State（V1）
    │        例：Sheet 显示/隐藏、动画进度、输入框光标位置
    │
    ├─ 多个组件需要，但只涉及 UI 展示逻辑？
    │   └─ 提升到最近公共祖先 → 通过 @Param（V2）/ @Prop（V1）向下传递
    │        例：当前 Tab 索引（TabBar 和内容区都需要）、折叠/展开状态
    │
    └─ 涉及业务逻辑或数据访问？
        └─ ViewModel 属性 → @Trace（V2）/ @Track（V1）
             例：isLogin、isLoading、表单输入、列表数据
```

| 原则           | 说明                                                         | 反例（避免）                                         |
| -------------- | ------------------------------------------------------------ | ---------------------------------------------------- |
| 派生不存储     | 能从已有状态计算出的值，用 @Computed 或 getter，不存为独立字段 | 存 `allowClick: boolean` 再手动同步                  |
| 就近持有       | 状态放在最小的使用范围内，不提前上提                         | 只有一个组件用的 `isShowSheet` 放进 ViewModel       |
| 单一来源       | 同一份数据只在一个地方被管理，其他地方通过引用或 getter 获取 | `inputContent` 同时在 Page 和 ViewModel 各存一份    |
| 提升到公共祖先 | 多组件共享的状态放在它们最近公共祖先中，而非直接跳到 ViewModel | 兄弟组件共用的 `selectedIndex` 直接放进 ViewModel    |

### 代码文件原则

遇到"这段代码放哪个目录"时，依次回答：

```
1. 有业务数据实体吗？（用户、商品、订单）
   → 有 → Model（实体类 + Repository）

2. 有 UI 状态需要驱动渲染吗？
   → 有 → ViewModel（@Observed/@ObservedV2 属性）

3. 都没有，只是纯逻辑或系统能力封装？
   → 是 → Utility（common/ 或 util/）
```

| 误判 | 正确归属 | 原因 |
|------|---------|------|
| 网络监听封装放 model/ | **util/** | 没有对应业务数据实体，是系统能力封装 |
| 表单验证逻辑放 model/ | **ViewModel** | 验证的是 UI 输入，不是业务数据规则 |
| API 响应解析放 viewmodel/ | **Model Repository** | 数据转换属于数据层 |
| 全局常量放 model/ | **common/** | 无业务含义，纯配置 |
| 密码加密放 viewmodel/ | **util/** | 纯算法，无 UI 状态 |

### 目录结构推荐

```
ets/
├── model/           # 数据模型 + Repository
│   ├── TaskModel.ets
│   └── TaskRepository.ets
├── viewmodel/       # 视图模型
│   └── TaskListViewModel.ets
├── views/           # 业务组件
│   ├── TaskItem.ets
│   └── TaskListView.ets
├── pages/           # 页面入口
│   └── TaskPage.ets
├── utils/           # 工具类（纯逻辑、系统能力封装）
│   └── NetworkUtil.ets
└── common/          # 通用常量、通用组件
    └── Constants.ets
```

| 目录 | 判断依据 | 典型内容 |
|------|---------|---------|
| model/ | 有业务数据实体 | UserModel、OrderRepository |
| viewmodel/ | 有 UI 状态驱动渲染 | LoginViewModel、AuthViewModel |
| views/ | 可复用业务组件 | TaskListView、AddressPicker |
| pages/ | 页面入口，只做组装 | Index、Login |
| utils/ | 无状态、纯逻辑 | NetworkMonitor、DateHelper |
| common/ | 通用常量 | CommonConstants |

## 场景决策树

```
用户提出 MVVM / 架构分层 / 状态架构 相关问题
│
├── Q1: 是否涉及把功能或页面开发/重构成 MVVM 架构（Model/ViewModel/View 职责划分、目录结构）？
│   ├── 是 → 继续 Q2
│   │   新建功能分层 / 已有项目整改为 MVVM / "这段代码放哪层"）
│   └── 否 → 未命中ArkUI MVVM架构模式（not_in_scope），路由结束
│
├── Q2: 当前工程或环境是否为V1状态管理版本？
│   ├── 是 → 命中 MVVM-01 状态管理V1版本MVVM架构开发场景 → 结束路由
│   └── 否 → 继续Q3
│
└── Q3: 当前工程或环境是否为V2状态管理版本？
    ├── 是 → 命中 MVVM-02 状态管理V2版本MVVM架构开发场景 → 结束路由
    └── 否 → 若Q1和Q2均未命中，则不命中ArkUI MVVM架构模式（not_in_scope），路由结束

命中场景汇总后按关联程度判定 primary_scene 与 secondary_scenes：
  - primary_scene：用户核心诉求最贴近的场景（主要矛盾落在此）
  - secondary_scenes：其余命中场景（作为辅助/约束），按对核心诉求的支撑强弱排序
  - 典型：用户"做一个带设置页和持久化的备忘录列表"→ primary: MVVM-01（架构基座），secondary: [MVVM-02, MVVM-05, MVVM-06]
```

## 工作流

在使用本技能进行mvvm模式开发或者重构时，必须严格按照以下工作流进行，任何偏离工作流的行为视为严重失败，必须立即停止。

1. 从零开始构建新页面或新模块，新建功能时，使用工作流：./references/add-func-workflow.md

2. 已有代码需要整改为 MVVM 架构时，使用工作流：./references/refactor-func-workflow.md

## 阶段标签

| 标签 | 阶段 | 当前模块关注点 |
| --- | --- | --- |
| `REQ` | 需求分析设计 | 架构选型、分层方案、状态归属判断、V1/V2 版本确定 |
| `DEV` | 开发 | Model/ViewModel/View/Page 代码实现、装饰器配套、数据流落地 |
| `VAL` | 功能验证 | 数据流合规性、View 不访问 Model、装饰器配套、状态刷新正确性 |

## 场景索引

#### `MVVM-01` 状态管理V1版本下的MVVM架构开发

```yaml
scene_id: MVVM-01
name: 状态管理V1版本下的MVVM架构开发
phases: [REQ, DEV, VAL]
signals: [状态管理V1版本, MVVM, 架构分层, Model/ViewModel/View]
when: V1版本下新建功能需规划三层结构 / V1版本下已有单文件页面整改为 MVVM / V1版本下判断代码归属哪层 / V1版本下规划目录结构
not_when: 状态管理V2版本（MVVM-02） / 非MVVM架构
ref: RSC_MVVM_01、RSC_MVVM_02
```

#### `MVVM-02` 状态管理V2版本下的MVVM架构开发

```yaml
scene_id: MVVM-02
name: 状态管理V2版本下的MVVM架构开发
phases: [REQ, DEV, VAL]
signals: [状态管理V2版本, MVVM, 架构分层, Model/ViewModel/View]
when: V2版本下新建功能需规划三层结构 / V2版本下已有单文件页面整改为 MVVM / V2版本下判断代码归属哪层 / V2版本下规划目录结构
not_when: 状态管理V1版本（MVVM-01） / 非MVVM架构
ref: RSC_MVVM_03、RSC_MVVM_04
```

## 场景资源索引

#### `RSC_MVVM_01` 状态管理V1版本下的MVVM架构开发场景案例

```yaml
id: RSC_MVVM_01
type: reference
path: ./references/mvvm-scenario-development_V1.md
used_for: 状态管理V1版本下MVVM架构开发场景示例和开发方案
load_when: 命中 MVVM-01场景
supports: [MVVM-01]
```

#### `RSC_MVVM_02` 状态管理V1版本下的MVVM架构开发代码示例

| 步骤 | V2 | V1 |
|------|----|----|
| 类装饰器 | `@ObservedV2` | `@Observed` |
| 属性观测 | `@Trace` | 无（第一层自动）/ `@Track`（精确） |
| 状态监听 | `@Monitor` | `@Watch` |
| 计算属性 | `@Computed` | 无（手动实现 getter） |

### 3. 实现 View

| 步骤 | V2 | V1 |
|------|----|----|
| 组件装饰器 | `@ComponentV2` | `@Component` |
| 接收数据 | `@Param` | `@Prop`（单向）/ `@Link`（双向） |
| 输出事件 | `@Event` | `@Link` 或回调 |

View 只依赖 ViewModel，保持精简。

### 4. 组装 Page

Page 作为入口，创建 ViewModel 实例并传递给 View。Page 不含业务逻辑。

### 5. 编译验证

编写完成后必须执行编译，排查引入的错误：

> 前置：先 `devecocli --version` 确认已安装；未安装需向用户确认后 `npm install -g @deveco/deveco-cli@latest`（需 Node.js >= 18、DevEco Studio >= 6.1.0）再继续，用户拒绝则走人工走查。

1. 用 `devecocli build` 对修改过的 `.ets` 文件做编译检查（ArkTS 语法/类型检查；多模块用 `--modules <模块名>`）
2. 如有报错，修复后重新构建，直到全部通过
3. 必要时用 `devecocli build` 做完整构建验证

## 整改工作流：已有项目重构为 MVVM

适用于已有代码需要整改为 MVVM 架构。**逐页面推进，每改完一个 Page 就验证功能不变。**

### 0. 确定整改顺序

按风险由低到高排序：

```
1. 纯展示页面（只读，无交互）→ 最安全
2. 简单表单页（有提交，无复杂状态）
3. 列表页（有增删改，状态较复杂）
4. 多 Tab / 嵌套导航页（跨组件状态共享）
```

#### `RSC_MVVM_03` 状态管理V2版本下的MVVM架构开发场景案例

```yaml
id: RSC_MVVM_03
type: reference
path: ./references/mvvm-scenario-development_V2.md
used_for: 状态管理V1版本下MVVM架构开发场景示例和开发方案
load_when:  命中 MVVM-02场景
supports: [MVVM-02]
```

#### `RSC_MVVM_04` 状态管理V2版本下的MVVM架构开发代码示例

```yaml
id: RSC_MVVM_04
type: reference
path: ./assets/V2MVVM
used_for: 状态管理V2版本下MVVM架构分层完整示例代码
load_when: 命中 MVVM-02场景
supports: [MVVM-02]
```
ViewModel 中的代码：
├─ http.createHttp().request(...) → 移入 Repository
├─ preferences.get(...)          → 移入 Repository
├─ 数据结构定义（interface/class）→ 移入 Model 文件
├─ 纯算法、系统能力封装           → 移入 util/
└─ 纯业务逻辑（过滤、排序、计算）→ 保留在 ViewModel
```

### 4. 重组 View

将 Page 瘦身为纯组装角色：

```
整改后的 Page：
├─ 创建 ViewModel 实例（@Local/@State）
├─ aboutToAppear 中调用 ViewModel 初始化方法
└─ build() 中只做布局和子组件组装

整改后的 View：
├─ 通过 @Param/@Prop 接收 ViewModel 数据
├─ 通过 @Event/回调 向上传递用户操作
└─ 不直接 import Model 文件
```

### 5. 逐页验证

每完成一个页面的整改，立即验证：

> 前置：先 `devecocli --version` 确认已安装；未安装需向用户确认后 `npm install -g @deveco/deveco-cli@latest`（需 Node.js >= 18、DevEco Studio >= 6.1.0）再继续，用户拒绝则走人工走查。

1. 用 `devecocli build` 对修改过的 `.ets` 文件做编译检查，修复报错直到通过
2. 必要时用 `devecocli build` 做完整构建验证
3. 逐项检查数据流合规性：

| 验证项 | 方式 |
|--------|------|
| 功能不变 | 手动测试页面所有交互 |
| 数据流合规 | View 不直接访问 Model，事件通过 ViewModel 传递 |
| 装饰器配套 | V1/V2 未混用 |
| 无冗余状态 | 同一份数据只在一处管理 |

验证通过后再推进下一个页面。

## 参考文件

根据当前任务选择加载：

| 文件 | 内容 | 何时读取 |
|------|------|----------|
| [references/anti-patterns.md](references/anti-patterns.md) | 架构反模式（4项）+ 快速扫描清单 | 整改工作流步骤1扫描现状时 |
| [references/v1-nested-observation.md](references/v1-nested-observation.md) | V1 嵌套类观测 @Observed + @ObjectLink 四种场景     | V1 项目遇到嵌套对象/数组观测问题时              |
| [references/v1-v2-mapping.md](references/v1-v2-mapping.md) | V1/V2 数组更新行为差异 + 装饰器配套规则 | 处理 V1 数组 push/splice 不触发更新、检查混用时 |
| [references/v2-advanced.md](references/v2-advanced.md)       | AppStorageV2/PersistenceV2 API 签名与选择          | V2 项目使用全局状态时                           |
| [references/multi-module.md](references/multi-module.md) | 三层架构 + 多模块 + 多设备 MVVM | 多模块工程、跨模块数据共享、多设备部署时 |