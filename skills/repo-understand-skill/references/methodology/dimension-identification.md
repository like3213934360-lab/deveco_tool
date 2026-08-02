# 功能维度识别与索引查询

> 本文件定义 Skill 执行流程的 Step 1-3 详细规则。

## Step 1：识别输入类型

判断输入内容是以下四种之一：

- **A. 功能描述文本** - 需要先进行维度识别
- **B. UX-DSL文件** - 从DSL中提取功能类型维度
- **C. 功能描述+DSL** - 混合输入，结合功能描述和DSL进行理解
- **D. 直接查询** - 用户明确指定查询类型（界面/路由与通信/逻辑/数据）

DSL部分可能为空或占位符，此时仅基于功能描述进行理解。

## Step 2：功能维度识别

### 维度识别规则

| 识别维度 | 识别规则 | 触发条件 |
|---------|---------|---------|
| 界面类型 | DSL包含组件树定义或功能描述提到UI | DSL有components字段或描述包含"页面"、"界面"、"展示"、"组件"等 |
| 路由与通信类型 | 功能描述提到路由、导航、跨模块通信 | 描述包含"路由"、"导航"、"Want"、"Navigation"、"跳转"、"通信"、"CommonEvent"等 |
| 逻辑类型 | 功能描述提到业务流程或状态管理 | 描述包含"逻辑"、"流程"、"状态"、"规则"、"ViewModel"、"Controller"等 |
| 数据类型 | 功能描述提到数据模型或存储 | 描述包含"数据"、"模型"、"存储"、"数据库"、"实体"、"@Observed"、"DataSource"等 |

### 多维度识别

输入可能包含多个维度，需根据实际情况进行组合：

```yaml
多维度识别规则:
  界面+路由与通信:
    典型场景: 页面触发的导航跳转
    处理方式: 先理解界面结构，再追踪路由调用链

  界面+逻辑:
    典型场景: 页面交互触发的业务逻辑
    处理方式: 先理解界面结构，再分析业务逻辑流程

  界面+数据:
    典型场景: 页面展示的数据模型
    处理方式: 先理解界面结构，再追踪数据模型

  路由与通信+逻辑:
    典型场景: 路由背后的业务处理
    处理方式: 先理解路由定义，再分析业务逻辑

  路由与通信+数据:
    典型场景: 路由传参的数据流转
    处理方式: 先理解路由参数，再追踪数据访问

  逻辑+数据:
    典型场景: 业务逻辑的数据操作
    处理方式: 先理解业务逻辑，再分析数据访问

  全维度:
    典型场景: 完整功能理解
    处理方式: 界面→路由与通信→逻辑→数据全链路追踪
```

## Step 3：代码仓索引查询

### 索引文件结构

代码仓索引存储在 `.codeagent/` 目录：

| 索引文件 | 内容 | 查询方式 | Reference文件 |
|---------|------|---------|-------------|
| `ui-components.map.json` | UI组件位置映射 | 组件名 → 文件路径:行号 | `architecture-patterns/ui-architecture.md` |
| `want-endpoints.map.json` | Want路由/Action/事件映射 | 路由路径/事件名 → 处理方法 | `architecture-patterns/api-architecture.md` |
| `business-logic.map.json` | 业务逻辑映射 | 功能名 → VM/Controller方法 | `architecture-patterns/logic-architecture.md` |
| `data-models.map.json` | 数据模型映射 | 实体名 → Model文件 | `architecture-patterns/data-architecture.md` |

### 索引构建策略

如果索引文件不存在，需要动态构建：

```yaml
索引构建规则:
  UI组件索引:
    搜索模式: "**/*.ets"
    提取规则: @Component装饰的类
    索引字段: 组件名、文件路径、行号、类型(Page/Component)、子组件、可复用性

  Want路由端点索引:
    搜索模式: "**/*.ets"
    提取规则:
      - NavPathStack.pushPathByName / router.pushUrl / router.replaceUrl调用
      - Action常量定义
      - CommonEvent订阅和发布
    索引字段:
      routes: 路由路径、文件路径、行号、导航方式(NavPathStack/Router/Want)、参数
      actions: Action名称、文件路径、行号、值、类型(AbilityAction/ServiceAction)
      events: 事件名、文件路径、行号、CommonEvent标识、类型

  业务逻辑索引:
    搜索模式: "**/*VM.ets", "**/*Controller.ets", "**/*Manager.ets", "**/*Helper.ets"
    提取规则: public方法定义
    累引字段: 方法名、类名、文件路径、类型(ViewModel/Controller/Manager/DataSource/Helper)、功能描述

  数据模型索引:
    搜索模式: "**/*Model.ets", "**/*DataSource.ets"
    提取规则: @Observed class定义、IDataSource实现类、enum定义
    累引字段: 类名、文件路径、类型(Model/DataSource/DataType)、装饰器(@Observed/@Track)、字段列表、关系
```

### 索引查询示例

```json
// ui-components.map.json 示例
{
  "HomePage": {
    "file": "src/pages/HomePage.ets",
    "line": 15,
    "type": "Page",
    "children": ["Header", "ContentList", "Footer"]
  },
  "UserItem": {
    "file": "src/components/UserItem.ets",
    "line": 8,
    "type": "Component",
    "reusable": true
  }
}

// want-endpoints.map.json 示例
{
  "routes": {
    "pages/DetailPage": {
      "file": "src/pages/DetailPage.ets",
      "line": 120,
      "method": "NavPathStack.pushPathByName",
      "params": ["itemId", "mode"],
      "constant": "NAVIGATION_DESTINATION_DETAIL"
    }
  },
  "actions": {
    "ACTION_VIEW": {
      "file": "src/constants/Constants.ets",
      "line": 45,
      "value": "ohos.action.VIEW",
      "type": "AbilityAction"
    }
  },
  "events": {
    "DATA_UPDATED": {
      "file": "src/utils/EventManager.ets",
      "line": 78,
      "event": "common.event.DATA_UPDATED",
      "type": "CommonEvent"
    }
  }
}
```