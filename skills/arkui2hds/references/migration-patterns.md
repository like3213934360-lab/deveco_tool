# 接入方式和迁移模式

## 适用场景

| 生态伙伴实现方式 | 目标场景 | 场景详情 | 预估开发者场景比例 | 支持方案 |
| ---------------- | --------- | -------- | ------------------ | -------- |
| ArkUI 实现 | 组件平替 | 原本使用的标准 Toolbar、Tabs、Navigation 等组件平替 HDS 组件 | 20% | 识别代码仓目标界面的代码，将标准组件替换 HDS 组件并补充相关属性支持 |
| ArkUI 实现 | 重构替换 | 自定义实现 Toolbar、Tabs 和 Navigation 等组件重构后使用 HDS 组件替换 | 80% | 识别代码仓目标界面的代码，将原组件实现进行提取重构，并支持通过开关切换使用 HDS 组件 |
| RN 实现 | 重构替换 | 使用 Web 实现的效果移除并替换为 ArkTS 的方式重新实现 | 待确认 | 不支持（将原本的 Web 实现替换为 ArkTS 实现会破坏代码跨平台效果） |

---

## 方式一：组件平替（适合标准组件替换）

### 步骤

1. 识别目标界面中的标准 ArkUI 组件（Tabs、Navigation 等）
2. 导入对应的 HDS 组件
3. 替换组件名称（**仅替换主组件，子组件保持不变**）
4. 替换控制器类型（如 TabsController → HdsTabsController）
5. **默认配置 HDS 新特性**（悬浮效果、材质效果等）
6. 调整样式以匹配设计规范

### 重要原则 - 什么需要改，什么不需要改

#### 需要修改的：
- **主组件名称**：`Tabs` → `HdsTabs`
- **控制器类型**：`TabsController` → `HdsTabsController`
- **导入语句**：添加 HDS 组件和控制器的导入
- **默认配置 HDS 新特性**：添加悬浮效果和材质效果配置

#### 不需要修改的：
- **TabContent**：保持不变，不需要改成 HdsTabContent
- **SubTabBarStyle**：保持不变，不需要改成 HdsSubTabBarStyle
- **BottomTabBarStyle**：保持不变，不需要改成 HdsBottomTabBarStyle
- **其他原生组件**：Scroll、Column、Row 等保持不变

### 示例

```typescript
// 原代码
// Tabs 是原生组件，不需要导入

private tabsController: TabsController = new TabsController();

Tabs({ controller: this.tabsController }) {
  TabContent() {
    Text('内容1')
  }
  .tabBar('页签1')

  TabContent() {
    Text('内容2')
  }
  .tabBar('页签2')
}
.barHeight(48)

// 替换后（默认配置 HDS 新特性）
import { HdsTabs, DividerMode, hdsMaterial, HdsTabsController } from '@kit.UIDesignKit';

private tabsController: HdsTabsController = new HdsTabsController();

HdsTabs({ controller: this.tabsController }) {
  TabContent() {  // 保持不变，不需要改成 HdsTabContent
    Text('内容1')
  }
  .tabBar('页签1')  // 保持不变

  TabContent() {  // 保持不变，不需要改成 HdsTabContent
    Text('内容2')
  }
  .tabBar('页签2')  // 保持不变
}
.barHeight(48)
.barPosition(BarPosition.End)
.barOverlap(true)  // 开启页签栏叠加效果
// 默认配置：分割线样式（跟手渐变显隐）
.divider({
  mode: DividerMode.FOLLOW_SCROLL,
  style: {
    strokeWidth: 0.5,
    color: 0x1A000000
  }
})
// 默认配置：悬浮页签栏和材质效果（6.1 新特性）
.barFloatingStyle({
  barBottomMargin: 28,
  systemMaterialEffect: {
    materialType: hdsMaterial.MaterialType.IMMERSIVE,
    materialLevel: hdsMaterial.MaterialLevel.ADAPTIVE
  }
})
```

### 默认配置说明

**为什么默认配置 HDS 新特性？**
- 三方应用使用 HDS 组件的主要目的就是体验新特性
- 悬浮效果和材质效果是 6.1 版本的核心特性
- 默认配置可以让开发者快速获得最佳视觉效果

**默认配置包含：**
1. `barOverlap(true)` - 页签栏背后变模糊并叠加在 TabContent 之上
2. `divider({ mode: DividerMode.FOLLOW_SCROLL })` - 分割线跟手渐变显隐
3. `barFloatingStyle()` - 悬浮页签栏配置
4. `systemMaterialEffect` - 材质效果（沉浸式 + 自适应）

**可选配置：**
- `barWidth` - 页签栏宽度（不配置则使用默认全屏宽度）
- `barSideMargin` - 页签栏左右边距（仅在配置 barWidth 时生效）

### 注意事项

1. **只替换主组件**：HdsTabs 是对原生 Tabs 的增强包装，TabContent 仍然是原生组件
2. **控制器必须替换**：HdsTabsController 继承自 TabsController，但提供了额外的 HDS 特性控制方法
3. **样式类保持不变**：SubTabBarStyle、BottomTabBarStyle 等样式类不需要加 Hds 前缀
4. **默认配置新特性**：切换到 HDS 组件时，默认配置悬浮效果和材质效果，以获得最佳体验

---

## 方式二：重构替换（适合自定义组件替换）

### 识别基础容器实现

在重构替换场景中，需要识别使用基础容器（Column、Row 等）拼出的 UI 效果，判断是否适合替换为 HDS 组件。详见 [components.md](components.md) 中的组件识别特征表。

### 步骤

1. 识别目标界面中的自定义组件实现（包括基础容器拼出的效果）
2. 提取组件的核心功能和样式
3. 创建 HDS 组件封装
4. 支持通过开关切换原组件和 HDS 组件
5. 逐步迁移到 HDS 组件

### 示例

```typescript
// 定义开关
const USE_HDS_COMPONENTS = true;

// 原自定义 Toolbar 组件
@ComponentV2
struct CustomToolbar {
  @Param title: string = '';
  @Param actions: ToolbarAction[] = [];

  build() {
    if (USE_HDS_COMPONENTS) {
      // 使用HDS组件
      this.HdsToolbarBuild();
    } else {
      // 原实现
      this.OriginalToolbarBuild();
    }
  }

  @Builder
  HdsToolbarBuild() {
    HdsToolBar({
      startButtons: this.actions.filter(a => a.position === 'start').map(a => ({
        icon: a.icon,
        onClick: a.onClick
      })),
      endButtons: this.actions.filter(a => a.position === 'end').map(a => ({
        icon: a.icon,
        onClick: a.onClick
      })),
      title: this.title,
      style: {
        height: 56,
        backgroundBlurStyle: BlurStyle.COMPONENT_REGULAR
      }
    });
  }

  @Builder
  OriginalToolbarBuild() {
    Row() {
      // 原自定义实现
    }
    .height(56)
    .backgroundColor('#FFFFFF')
  }
}