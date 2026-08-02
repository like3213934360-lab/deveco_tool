# 案例一：组件平替 - Tabs和Navigation组件替换

本案例展示如何将标准ArkUI的Tabs和Navigation组件直接替换为HdsTabs和HdsNavigation组件。

## 场景说明

一个典型的应用底部导航页面，每个Tab页都有独立的导航栏。需要将标准Tabs组件替换为HdsTabs组件，同时将每个Tab页中的Navigation组件替换为HdsNavigation组件，并配置6.1新特性。

## 涉及组件

- **Tabs** → **HdsTabs**：底部页签容器，配置悬浮效果和材质效果
- **Navigation** → **HdsNavigation**：页面导航栏，配置动态模糊和材质效果

## 原始代码（标准Tabs组件）

```typescript
// OriginalTabsPage.ets
// Tabs 是原生组件，不需要导入

@Entry
@ComponentV2
struct OriginalTabsPage {
  @Local currentIndex: number = 0;

  build() {
    Tabs({ index: this.currentIndex }) {
      TabContent() {
        Column() {
          Text('首页')
            .fontSize(24)
            .fontWeight(FontWeight.Bold)
        }
        .width('100%')
        .height('100%')
        .justifyContent(FlexAlign.Center)
      }
      .tabBar(this.TabBuilder(0, '首页', $r('sys.symbol.house_fill')))

      TabContent() {
        Column() {
          Text('发现')
            .fontSize(24)
            .fontWeight(FontWeight.Bold)
        }
        .width('100%')
        .height('100%')
        .justifyContent(FlexAlign.Center)
      }
      .tabBar(this.TabBuilder(1, '发现', $r('sys.symbol.compass_fill')))

      TabContent() {
        Column() {
          Text('消息')
            .fontSize(24)
            .fontWeight(FontWeight.Bold)
        }
        .width('100%')
        .height('100%')
        .justifyContent(FlexAlign.Center)
      }
      .tabBar(this.TabBuilder(2, '消息', $r('sys.symbol.message_fill')))

      TabContent() {
        Column() {
          Text('我的')
            .fontSize(24)
            .fontWeight(FontWeight.Bold)
        }
        .width('100%')
        .height('100%')
        .justifyContent(FlexAlign.Center)
      }
      .tabBar(this.TabBuilder(3, '我的', $r('sys.symbol.person_fill')))
    }
    .width('100%')
    .height('100%')
    .barPosition(BarPosition.End)
    .onChange((index: number) => {
      this.currentIndex = index;
    })
  }

  @Builder
  TabBuilder(index: number, title: string, icon: Resource) {
    Column() {
      Image(icon)
        .width(24)
        .height(24)
        .fillColor(this.currentIndex === index ? '#007DFF' : '#999999')

      Text(title)
        .fontSize(12)
        .fontColor(this.currentIndex === index ? '#007DFF' : '#999999')
        .margin({ top: 4 })
    }
    .width('100%')
    .height(50)
    .justifyContent(FlexAlign.Center)
  }
}
```

## 替换后代码（HdsTabs组件）

```typescript
// HdsTabsPage.ets
import { HdsTabs, HdsTabsController, DividerMode, hdsMaterial } from '@kit.UIDesignKit';
import { SymbolGlyphModifier } from '@kit.ArkUI';

@Entry
@ComponentV2
struct HdsTabsPage {
@Local currentIndex: number = 0;
private tabsController: HdsTabsController = new HdsTabsController();

build() {
HdsTabs({ index: this.currentIndex, controller: this.tabsController }) {
TabContent() {
// 首页
this.TabPageBuilder('首页')
}
.tabBar(new BottomTabBarStyle({
normal: new SymbolGlyphModifier($r('sys.symbol.house_fill')),
}, '首页'))

TabContent() {
// 发现
this.TabPageBuilder('发现')
}
.tabBar(new BottomTabBarStyle({
normal: new SymbolGlyphModifier($r('sys.symbol.compass_fill')),
}, '发现'))

TabContent() {
// 消息
this.TabPageBuilder('消息')
}
.tabBar(new BottomTabBarStyle({
normal: new SymbolGlyphModifier($r('sys.symbol.message_fill')),
}, '消息'))

TabContent() {
// 我的
this.TabPageBuilder('我的')
}
.tabBar(new BottomTabBarStyle({
normal: new SymbolGlyphModifier($r('sys.symbol.person_fill')),
}, '我的'))
}
.key('HdsTabsPage')
.width('100%')
.height('100%')
.barPosition(BarPosition.End)
.barHeight(56)
.barOverlap(true)
// 添加HDS特有的分割线样式 - 跟手渐变显隐
.divider({
mode: DividerMode.FOLLOW_SCROLL,
style: {
strokeWidth: 0.5,
color: 0x1A000000
}
})
// 6.1新特性：悬浮页签栏配置（使用默认宽度）
.barFloatingStyle({
barSideMargin: 10,
barBottomMargin: 28,
gradientMask: { maskColor: '#66F1F3F5', maskHeight: 92 },
// 6.1新特性：材质效果配置
systemMaterialEffect: {
materialType: hdsMaterial.MaterialType.IMMERSIVE,
materialLevel: hdsMaterial.MaterialLevel.ADAPTIVE
}
})
.onChange((index: number) => {
this.currentIndex = index;
})
}

@Builder
TabPageBuilder(title: string) {
Scroll() {
Column() {
Blank().height(100)

Text(`${title}内容`)
.fontSize(24)
.fontWeight(FontWeight.Bold)
.margin({ bottom: 20 })

Text('这里是页面内容...')
.fontSize(16)
.lineHeight(28)

ForEach([1, 2, 3, 4, 5, 6, 7, 8, 9, 10], (item: number) => {
Text(`段落 ${item}`)
.fontSize(16)
.lineHeight(28)
.margin({ top: 10 })
})
}
.width('100%')
.padding({ left: 20, right: 20 })
}
.width('100%')
.layoutWeight(1)
}
.width('100%')
.height('100%')
.backgroundColor('#F5F5F5')
}}
```

## 替换说明

### 主要变更

#### HdsTabs组件替换

1. **导入模块**：添加 `import { HdsTabs, HdsTabsController, DividerMode, hdsMaterial } from '@kit.UIDesignKit'`
2. **导入 SymbolGlyphModifier**：添加 `import { SymbolGlyphModifier } from '@kit.ArkUI'`
3. **组件名称**：将 `Tabs` 替换为 `HdsTabs`
4. **控制器**：添加 `HdsTabsController` 用于控制页签切换
5. **TabBar 样式**：使用 `BottomTabBarStyle` 配置图标，无需自定义 TabBuilder
6. **HDS特有属性**：
   - `barOverlap(true)` - 页签栏背后变模糊并叠加在TabContent之上
   - `divider()` - 分割线样式（跟手渐变显隐）
   - `barFloatingStyle()` - 悬浮页签栏配置

### 6.1新特性配置

1. **TabBar 图标配置**：
   - 使用 `BottomTabBarStyle` 和 `SymbolGlyphModifier`
   - 示例：
     ```typescript
     .tabBar(new BottomTabBarStyle({
       normal: new SymbolGlyphModifier($r('sys.symbol.house_fill')),
     }, '首页'))
     ```

2. **悬浮页签栏**（`barFloatingStyle`）：
   - `barWidth` - 页签栏宽度（可选，支持small、medium、large三种尺寸，不配置则使用默认全屏宽度）
   - `barSideMargin` - 页签栏左右边距（仅在配置 barWidth 时生效）
   - `barBottomMargin` - 页签栏底部边距
   - `gradientMask` - 渐变遮罩（颜色和高度）

3. **材质效果**（`systemMaterialEffect`）：
   - `materialType` - 材质类型（IMMERSIVE沉浸式、NONE无材质）
   - `materialLevel` - 材质级别（ADAPTIVE自适应、EXQUISITE精致）

### 注意事项

1. 需要导入 `DividerMode` 和 `hdsMaterial` 模块：`import { DividerMode, hdsMaterial } from '@kit.UIDesignKit'`
2. 需要导入 `SymbolGlyphModifier`：`import { SymbolGlyphModifier } from '@kit.ArkUI'`
3. 使用 `BottomTabBarStyle` 配置 TabBar 图标，无需自定义 @Builder TabBuilder
4. `barFloatingStyle` 需要配合 `barOverlap(true)` 使用
5. 悬浮页签栏仅在 `barPosition(BarPosition.End)` 且 `vertical(false)` 时生效
6. 如果不需要限制 TabBar 宽度，可以不配置 `barWidth`，使用默认全屏宽度