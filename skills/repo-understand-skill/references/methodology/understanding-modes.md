# 四模式理解流程

> 本文件定义 Skill 执行流程的 Step 4 详细规则——四种理解模式的流程、checkpoint 和 Reference 文件加载策略。

## 模式1：界面理解模式

**适用场景**：功能涉及UI界面、组件、页面

**理解流程**：

```yaml
steps:
  1.
    name: 识别界面入口
    action: |
      - 根据功能描述查找相关页面文件（*.ets）
      - 通过路由配置定位页面路径
      - 识别主入口组件
    checkpoint: 找到正确的页面入口文件

  2.
    name: 分析组件层次结构
    action: |
      - 解析组件树结构
      - 识别父子组件关系
      - 提取组件复用模式
    checkpoint: 组件层次结构完整

  3.
    name: 理解布局模式
    action: |
      - 识别使用的布局方式（Flex、Grid、Stack等）
      - 分析响应式布局实现
      - 提取布局复用模式
    checkpoint: 布局模式识别正确

  4.
    name: 分析状态管理
    action: |
      - 识别状态存储方式（@State、@Prop、@Link、@Provide/@Consume等）
      - 分析状态传递路径
      - 提取状态管理模式
    checkpoint: 状态管理理解正确

  5.
    name: 提取样式规范
    action: |
      - 分析样式定义方式（@Styles、内联样式、$r资源引用）
      - 识别主题变量使用
      - 提取样式复用模式
    checkpoint: 样式规范提取完整
```

**Reference文件加载策略**：

| 功能类型 | 入口文件 | Reference文件 | 触发条件 |
|---------|---------|--------------|---------|
| 界面类型 | `*.ets` | `architecture-patterns/ui-architecture.md` | 功能涉及UI界面 |

---

## 模式2：路由与通信理解模式

**适用场景**：功能涉及页面跳转、跨模块通信、导航、Want路由

**理解流程**：

```yaml
steps:
  1.
    name: 识别路由入口
    action: |
      - 查找路由定义文件（NavigationConstants、router调用）
      - 定位NavPathStack路由映射或main_pages.json页面注册
      - 识别Want Action常量和CommonEvent事件定义
    checkpoint: 找到正确的路由入口

  2.
    name: 分析路由类型与参数
    action: |
      - 识别路由类型（Navigation/Router/Want三种）
      - 追踪路由参数传递和类型安全
      - 分析路由参数的解析和校验
    checkpoint: 路由类型和参数理解正确

  3.
    name: 追踪跨模块通信链
    action: |
      - 识别CommonEvent发布/订阅链
      - 分析Action常量的跨Ability调用
      - 追踪ServiceExtensionAbility服务调用
    checkpoint: 通信链追踪完整

  4.
    name: 分析错误处理与响应
    action: |
      - 识别BusinessError标准错误处理
      - 分析路由跳转失败的回退策略
      - 提取错误码和响应格式规范
    checkpoint: 错误处理理解正确
```

**Reference文件加载策略**：

| 功能类型 | 入口文件 | Reference文件 | 触发条件 |
|---------|---------|--------------|---------|
| 路由与通信类型 | `*Constants.ets`, `*Page.ets` | `architecture-patterns/api-architecture.md` | 功能涉及路由跳转或跨模块通信 |

---

## 模式3：逻辑理解模式

**适用场景**：功能涉及业务逻辑、ViewModel、Controller、Manager、状态机

**理解流程**：

```yaml
steps:
  1.
    name: 识别业务逻辑入口
    action: |
      - 查找核心ViewModel/Controller类
      - 识别主要业务方法
      - 分析业务入口点（build()中的回调绑定）
    checkpoint: 找到正确的业务入口

  2.
    name: 分析业务流程
    action: |
      - 梳理业务处理步骤
      - 识别分支逻辑和状态转换
      - 分析FSM状态机模式
    checkpoint: 业务流程理解正确

  3.
    name: 识别设计模式
    action: |
      - 识别使用的ArkTS设计模式（观察者/策略/代理/工厂等）
      - 分析模式应用场景
      - 提取模式实现方式
    checkpoint: 设计模式识别准确

  4.
    name: 分析依赖关系
    action: |
      - 识别组件间依赖（@State/@Prop/@Link/@Provide/@Consume）
      - 分析模块间依赖（import lazy + oh-package.json5）
      - 提取依赖注入模式
    checkpoint: 依赖关系分析完整
```

**Reference文件加载策略**：

| 功能类型 | 入口文件 | Reference文件 | 触发条件 |
|---------|---------|--------------|---------|
| 逻辑类型 | `*VM.ets`, `*Controller.ets`, `*Manager.ets` | `architecture-patterns/logic-architecture.md` | 功能涉及业务逻辑 |

---

## 模式4：数据理解模式

**适用场景**：功能涉及数据模型、@Observed/@Track、DataSource、存储

**理解流程**：

```yaml
steps:
  1.
    name: 识别数据模型
    action: |
      - 查找@Observed class定义
      - 识别@Track标记的响应式字段
      - 分析IDataSource实现类
    checkpoint: 数据模型识别完整

  2.
    name: 分析实体关系
    action: |
      - 识别belongsTo/hasOne关系
      - 识别hasMany关系
      - 分析引用关联方式（通过ID引用 vs 直接对象引用）
    checkpoint: 实体关系理解正确

  3.
    name: 追踪数据操作
    action: |
      - 识别DataSource的加载/刷新/分页操作
      - 分析数据验证逻辑
      - 追踪数据持久化方式（Preferences/RDB/@StorageLink）
    checkpoint: 数据操作追踪完整

  4.
    name: 分析数据访问模式
    action: |
      - 识别DataSource + DataSourceManager协调模式
      - 分析LazyForEach数据消费方式
      - 提取数据访问规范
    checkpoint: 数据访问模式提取完整
```

**Reference文件加载策略**：

| 功能类型 | 入口文件 | Reference文件 | 触发条件 |
|---------|---------|--------------|---------|
| 数据类型 | `*Model.ets`, `*DataSource.ets` | `architecture-patterns/data-architecture.md` | 功能涉及数据模型 |