# HDS 6.1 新特性配置示例

HDS 组件在 6.1 版本中引入了多项新特性，包括悬浮效果、材质效果、动态模糊等。

**重要原则：** 
- HdsTabs 必须配置悬浮效果和材质效果
- HdsNavigation 和 HdsNavDestination 必须配置 scrollEffectType 为沉浸式渐变模糊和材质效果

---

## HdsTabs - TabBar 图标配置

### 使用 BottomTabBarStyle 配置图标（推荐）

```typescript
import { HdsTabs } from '@kit.UIDesignKit';
import { SymbolGlyphModifier } from '@kit.ArkUI';

HdsTabs() {
  TabContent() {
    // 页面内容
  }
  .tabBar(new BottomTabBarStyle({
    normal: new SymbolGlyphModifier($r('sys.symbol.house_fill')),
  }, '首页'))

  TabContent() {
    // 页面内容
  }
  .tabBar(new BottomTabBarStyle({
    normal: new SymbolGlyphModifier($r('sys.symbol.compass_fill')),
  }, '发现'))
}
```

### 配置说明

- `BottomTabBarStyle` - HDS 推荐的 TabBar 样式类
- `SymbolGlyphModifier` - 符号图标修饰器，需要从 `@kit.ArkUI` 导入
- `normal` - 正常状态的图标配置
- 第二个参数 - Tab 的标识字符串（可选）

### 注意事项

- 必须导入 `SymbolGlyphModifier`：`import { SymbolGlyphModifier } from '@kit.ArkUI';`
- 使用系统符号资源：`$r('sys.symbol.xxx')`
- 不需要自定义 @Builder TabBuilder

---

## HdsTabs - 悬浮页签栏和材质效果

### 配置示例（6.1 新特性）

```typescript
import { HdsTabs, DividerMode, hdsMaterial } from '@kit.UIDesignKit';

HdsTabs() {
  // TabContent...
}
.barPosition(BarPosition.End)
.barOverlap(true)  // 必须设置为true才能使用悬浮效果
// 分割线样式（跟手渐变显隐）
.divider({
  mode: DividerMode.FOLLOW_SCROLL
})
// 悬浮页签栏和材质效果（6.1 新特性）
.barFloatingStyle({
  systemMaterialEffect: {
    materialType: hdsMaterial.MaterialType.IMMERSIVE,  // IMMERSIVE沉浸式、NONE无材质
    materialLevel: hdsMaterial.MaterialLevel.ADAPTIVE  // ADAPTIVE自适应、EXQUISITE精致
  }
})
```

### 配置说明

- `barOverlap(true)` - 页签栏背后变模糊并叠加在 TabContent 之上（必须配置）
- `divider({ mode: DividerMode.FOLLOW_SCROLL })` - 分割线跟手渐变显隐
- `barFloatingStyle()` - 悬浮页签栏配置
- `systemMaterialEffect` - 材质效果（沉浸式 + 自适应）

---

## HdsNavigation - 动态模糊和材质效果

```typescript
import {
  hdsMaterial,
  HdsNavigation,
  ScrollEffectType,
} from '@kit.UIDesignKit'

HdsNavigation() {
  Scroll(this.scrollerForScroll) {
    Column() {
      // 页面内容
    }.height('100%')
  }.edgeEffect(EdgeEffect.Spring).height('100%')
}
.titleBar({
  content: {
    title: {
      mainTitle: '主标题',
    },
  },
  style: {
    // 6.1新特性：动态模糊样式配置
    scrollEffectOpts: {
      scrollEffectType: ScrollEffectType.IMMERSIVE_GRADIENT_BLUR,
    },
    // 6.1新特性：材质效果配置
    systemMaterialEffect: {
      materialType: hdsMaterial.MaterialType.IMMERSIVE,
      materialLevel: hdsMaterial.MaterialLevel.ADAPTIVE
    }
  },
})
.bindToScrollable([this.scrollerForScroll])
```

### 配置说明

- `scrollEffectType` - 滚动模糊类型：
  - `IMMERSIVE_GRADIENT_BLUR` - 沉浸式渐变模糊（推荐）
  - `GRADIENT_BLUR` - 渐变模糊
  - `COMMON_BLUR` - 通用模糊
- `materialType` - 材质类型：IMMERSIVE（沉浸式）、NONE（无材质）
- `materialLevel` - 材质级别：ADAPTIVE（自适应）、EXQUISITE（精致）

---

## HdsNavDestination - 动态模糊和材质效果

```typescript
import {
  hdsMaterial,
  HdsNavDestination,
  ScrollEffectType,
} from '@kit.UIDesignKit'

HdsNavDestination() {
  Scroll(this.scroller) {
    Column() {
      // 页面内容
    }
  }.edgeEffect(EdgeEffect.Spring).scrollBar(BarState.Off)
}
.titleBar({
  content: {
    title: {
      mainTitle: '主标题',
    },
  },
  style: {
    // 6.1新特性：动态模糊样式配置
    scrollEffectOpts: {
      scrollEffectType: ScrollEffectType.IMMERSIVE_GRADIENT_BLUR,
    },
    // 6.1新特性：材质效果配置
    systemMaterialEffect: {
      materialType: hdsMaterial.MaterialType.IMMERSIVE,
      materialLevel: hdsMaterial.MaterialLevel.ADAPTIVE
    }
  },
})
.bindToScrollable([this.scroller])  // 绑定滚动容器
```

### 配置说明

- 必须配合 HdsNavigation 使用，作为其子页面的根节点
- 推荐使用 bindToScrollable/bindToNestedScrollable 绑定滚动容器
- `scrollEffectType` - 滚动模糊类型：
  - `IMMERSIVE_GRADIENT_BLUR` - 沉浸式渐变模糊（推荐）
  - `GRADIENT_BLUR` - 渐变模糊
  - `COMMON_BLUR` - 通用模糊
- `materialType` - 材质类型：IMMERSIVE（沉浸式）、NONE（无材质）
- `materialLevel` - 材质级别：ADAPTIVE（自适应）、EXQUISITE（精致）
```

### 配置说明

- `scrollEffectType` - 滚动模糊类型：
  - `COMMON_BLUR` - 通用模糊
  - `GRADIENT_BLUR` - 渐变模糊
  - `IMMERSIVE_GRADIENT_BLUR` - 沉浸式渐变模糊（推荐）
- `blurEffectiveStartOffset` - 模糊开始生效的滚动偏移量
- `blurEffectiveEndOffset` - 模糊完全生效的滚动偏移量
- `originalStyle` 和 `scrollEffectStyle` - 分别配置滚动前后的样式

---

## HdsToolBar - 材质效果

**注意：** HdsToolBar 是命令式组件，不是声明式组件。材质效果通过 `HdsToolBarModifier` 配置。

```typescript
import {
  HdsToolBar,
  HdsToolBarController,
  HdsToolBarItem,
  HdsToolBarSymbolGlyph,
  HdsToolBarItemState,
  HdsToolBarMaterialType,
  HdsToolBarModifier,
  HdsToolBarParam,
  HdsToolBarMaterialLevel
} from '@hms.hds.HdsToolBar';

// 创建实例
hdsToolBar: HdsToolBar = new HdsToolBar(this.getUIContext());

// 配置材质效果
modifier: HdsToolBarModifier = new HdsToolBarModifier()
  .direction(Axis.Horizontal)
  .adaptToHandedness(false)
  .materialType(HdsToolBarMaterialType.ADAPTIVE)
  .thermoCtrl(true);

hdsToolBarParam: HdsToolBarParam = {
  toolBarList: this.toolbarList,
  modifier: this.modifier,
  controller: this.controller,
  materialLevel: HdsToolBarMaterialLevel.ADAPTIVE
};

// 显示工具栏
aboutToAppear(): void {
  this.hdsToolBar.show(this.hdsToolBarParam);
}
```

### 配置说明

- **HdsToolBar 是命令式组件，需从 `@hms.hds.HdsToolBar` 导入**
- `materialType` - 材质类型：ADAPTIVE（自适应）、IMMERSIVE（沉浸式）
- `materialLevel` - 材质级别：ADAPTIVE（自适应）、EXQUISITE（精致）