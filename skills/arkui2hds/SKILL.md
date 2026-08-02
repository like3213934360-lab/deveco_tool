---
name: arkui2hds
description: 帮助生态伙伴将ArkUI基础组件或自定义组件替换为HDS（UI Design Kit）组件。使用此技能当需要：(1) 识别代码仓中的标准ArkUI组件（Tabs、Navigation、ToolBar等）并替换为HDS组件，(2) 识别自定义组件实现并重构为HDS组件，(3) 配置HDS 6.1新特性（悬浮效果、材质效果、动态模糊等），(4) 支持通过开关切换原组件和HDS组件实现。
---

# ArkUI2HDS - AI辅助接入HDS组件

本Skill帮助外部应用将ArkUI基础组件或自定义组件替换为HDS（UI Design Kit）组件。

## 适用场景

| 生态伙伴实现方式 | 目标场景 | 场景详情 | 预估开发者场景比例 | 支持方案 |
| ---------------- | --------- | -------- | ------------------ | -------- |
| ArkUI实现 | 组件平替 | 原本使用的标准Toolbar、Tabs、Navigation等组件平替HDS组件 | 20% | 识别代码仓目标界面的代码，将标准组件替换HDS组件并补充相关属性支持 |
| ArkUI实现 | 重构替换 | 自定义实现Toolbar、Tabs和Navigation等组件重构后使用HDS组件替换 | 80% | 识别代码仓目标界面的代码，将原组件实现进行提取重构，并支持通过开关切换使用HDS组件 |
| RN实现 | 重构替换 | 使用Web实现的效果移除并替换为ArkTS的方式重新实现 | 待确认 | 不支持（将原本的Web实现替换为ArkTS实现会破坏代码跨平台效果） |

## 快速开始

### 基本流程

1. 识别目标界面中的组件（标准组件或自定义实现）
2. 选择接入方式（组件平替或重构替换）
3. 替换为对应的 HDS 组件
4. 配置 6.1 新特性（可选）
5. 调整样式以匹配设计规范

## 重要原则

### 不随意添加属性

在将基础组件替换为HDS组件时，必须严格遵循以下原则：

1. **严格按照示例添加属性**
   - 不凭空捏造属性名称或参数
   - 不基于经验推测属性的存在

2. **只配置必须的 HDS 特有属性**
   - **HdsTabs**：必须配置悬浮效果（barFloatingStyle）和材质效果（systemMaterialEffect）
   - **HdsNavigation**：配置 scrollEffectType 为沉浸式渐变模糊（IMMERSIVE_GRADIENT_BLUR）和材质效果（systemMaterialEffect）
   - **HdsNavDestination**：配置 scrollEffectType 为沉浸式渐变模糊（IMMERSIVE_GRADIENT_BLUR）和材质效果（systemMaterialEffect）
   - 其他属性保持和原版一致的配置即可
   - 不确定的属性宁可不要添加

3. **避免类型错误**
   - 很多属性需要特定类型（如 LengthMetrics、ColorMetrics），不能直接使用 number 或 string
   - 如果添加属性后出现类型错误，说明该属性可能配置有误或不应添加
   - 删除不确认的属性，而不是尝试"修复"它

4. **核心原则**
   - **不轻易添加没根据的属性**
   - 本来能运行的代码切换后不应该直接编译报错
   - 切换组件后保持代码可编译、可运行是第一优先级

### 通用属性保持不变

在将基础组件替换为HDS组件时，必须遵循以下原则：

1. **通用属性保持原有配置不变**
   - 基础组件的通用属性（如 width、height、backgroundColor、padding、margin 等）在替换为 HDS 组件后，必须保持原有的参数配置不变
   - 这些通用属性不是 HDS 特有属性，不应在替换过程中被修改

2. **HDS 特有属性需要新增配置**
   - 仅对 HDS 特有的属性（如 barFloatingStyle、systemMaterialEffect、divider 等）进行新增配置
   - 不应修改已有的通用属性配置

3. **示例**
   ```typescript
   // 原代码
   Tabs({ index: this.currentIndex }) {
     // ...
   }
   .width('100%')        // 通用属性，保持不变
   .height('100%')       // 通用属性，保持不变
   .barPosition(BarPosition.End)  // 通用属性，保持不变

   // 替换后
   HdsTabs({ index: this.currentIndex, controller: this.tabsController }) {
     // ...
   }
   .width('100%')        // 保持原有配置不变
   .height('100%')       // 保持原有配置不变
   .barPosition(BarPosition.End)  // 保持原有配置不变
   // 新增 HDS 特有属性（严格按照官方文档示例）
   .barOverlap(true)
   .divider({ mode: DividerMode.FOLLOW_SCROLL })
   .barFloatingStyle({
     systemMaterialEffect: {
       materialType: hdsMaterial.MaterialType.IMMERSIVE,
       materialLevel: hdsMaterial.MaterialLevel.ADAPTIVE
     }
   })
   ```

## 详细参考

- **HDS 组件详细说明**：见 [components.md](references/components.md)
- **6.1 新特性配置示例**：见 [config-examples.md](references/config-examples.md)
- **接入方式和迁移模式**：见 [migration-patterns.md](references/migration-patterns.md)