# 依赖管理

> **说明**：本文档介绍 HarmonyOS ArkTS 工程中的依赖管理，包括 oh-package.json5 的配置方法和依赖检查清单。

## 1. oh-package.json5 作用

`oh-package.json5` 是 HarmonyOS 工程的依赖管理文件，用于声明模块之间的依赖关系。

### 1.1 文件位置

| 模块类型 | 文件位置 |
|---------|---------|
| Entry 模块 | `product/phone/oh-package.json5` |
| HAR/Shared 模块 | `{module}/oh-package.json5` |

### 1.2 文件结构

```json5
{
  "name": "module_name",           // 模块名称
  "version": "1.0.0",              // 模块版本
  "description": "Module desc",    // 模块描述
  "main": "index.ets",             // 入口文件
  "dependencies": {                // 依赖列表
    "@ohos/xxx": "file:../../feature/xxx",
    "@myorg/xxx": "1.8.1"
  }
}
```

## 2. 依赖类型

### 2.1 路径依赖（file:）

引用本地模块，使用相对路径。

**格式**：
```json5
{
  "dependencies": {
    "@ohos/timeline": "file:../../feature/timeline",
    "@ohos/highlight": "file:../../feature/highlight"
  }
}
```

**适用场景**：
- 引用项目内的 feature 模块
- 引用项目内的公共模块

### 2.2 版本号依赖

引用 ohpm 仓库中的包，使用版本号。

**格式**：
```json5
{
  "dependencies": {
    "@myorg/common": "1.8.1",
    "@myorg/featurelib": "1.8.1"
  }
}
```

**适用场景**：
- 引用公共库
- 引用第三方包

## 3. 添加模块依赖的步骤

### 3.1 确认被引用模块的包名

查看被引用模块的 `oh-package.json5` 文件，确认其 `name` 字段。

**示例**：查看 `feature/creation/oh-package.json5`
```json5
{
  "name": "creation",
  "version": "1.0.0",
  ...
}
```

**注意**：实际的包名可能是 `@ohos/creation`，需要结合项目规范确定。

### 3.2 在引用模块的 oh-package.json5 中添加依赖

**示例**：在 `product/phone/oh-package.json5` 中添加
```json5
{
  "dependencies": {
    "@ohos/creation": "file:../../feature/creation"
  }
}
```

### 3.3 在代码中导入组件

```typescript
import { CreationPage } from '@ohos/creation/src/main/ets/view/CreationPage';
```

## 4. 多模块工程依赖示例

### 4.1 Entry 模块依赖

`product/phone/oh-package.json5`:
```json5
{
  "name": "phone_app",
  "dependencies": {
    "@myorg/tools": "1.8.1",
    "@myorg/common": "1.8.1",
    "@ohos/featureA": "file:../../feature/featureA",
    "@ohos/featureB": "file:../../feature/featureB",
    "@myorg/corelib": "1.8.1",
    "@ohos/search": "file:../../feature/search"
  }
}
```

### 4.2 feature 模块依赖

`feature/highlight/oh-package.json5`:
```json5
{
  "name": "@ohos/highlight",
  "dependencies": {
    "@myorg/common": "1.8.1",
    "@myorg/tools": "1.8.1",
    "@myorg/corelib": "1.8.1",
    "@ohos/featureA": "file:../featureA",
    "@ohos/lottie": "2.0.23"
  }
}
```

## 5. 常见依赖问题

### 5.1 模块找不到错误

**错误信息**：
```
Cannot find module '@ohos/xxx/src/main/ets/view/XXXPage' or its corresponding type declarations.
```

**原因**：
- 未在 `oh-package.json5` 中声明依赖
- 依赖路径不正确
- 被引用模块的包名不正确

**解决方案**：
1. 检查 `oh-package.json5` 中是否已添加依赖
2. 确认依赖路径正确
3. 确认被引用模块的包名

### 5.2 循环依赖

**错误信息**：
```
Circular dependency detected
```

**原因**：
- 模块 A 依赖模块 B，模块 B 又依赖模块 A

**解决方案**：
- 重构代码，提取公共模块
- 调整模块依赖关系

### 5.3 版本冲突

**错误信息**：
```
Version conflict detected
```

**原因**：
- 不同模块依赖同一包的不同版本

**解决方案**：
- 统一使用相同版本的依赖
- 使用 `oh-package.json5` 的 `overrides` 字段指定版本

## 6. 依赖管理检查清单

添加新功能引用新模块时，必须检查：

- [ ] 确认被引用模块的 `oh-package.json5` 中的 `name` 字段
- [ ] 在引用模块的 `oh-package.json5` 中添加对应依赖
- [ ] 确认依赖路径正确（相对路径或版本号）
- [ ] 确认依赖类型正确（`file:` 路径依赖或版本号依赖）
- [ ] 运行编译验证依赖配置正确

## 7. 最佳实践

1. **明确依赖关系**：在添加新功能前，先梳理需要依赖哪些模块
2. **最小化依赖**：只添加必要的依赖，避免引入不必要的模块
3. **统一版本**：同一包在不同模块中应使用相同版本
4. **文档记录**：在设计文档中记录模块依赖关系
5. **定期审查**：定期检查和清理不再使用的依赖