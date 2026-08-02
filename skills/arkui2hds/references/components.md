# HDS 组件详细说明

## 支持的 HDS 组件

### 1. HdsTabs 组件

Tabs 容器组件，提供分割线样式、模糊样式和页签侧边栏半屏居中对齐样式的效果。

**主要特性：**
- 支持横向/纵向 Tab
- 支持悬浮页签栏（6.1 新特性）
- 支持滑动隐藏/显示动效
- 支持迷你栏样式
- 支持分割线样式（常隐、常显、跟手渐变）

**对应基础组件：** `Tabs`

**导入方式：**
```typescript
import { HdsTabs, DividerMode, hdsMaterial, HdsTabsController } from '@kit.UIDesignKit';
import { SymbolGlyphModifier } from '@kit.ArkUI';
```

**TabBar 图标配置：**
```typescript
.tabBar(new BottomTabBarStyle({
  normal: new SymbolGlyphModifier($r('sys.symbol.house_fill')),
}, '首页'))
```

**Controller 配置：**
```typescript
// 原代码
private tabsController: TabsController = new TabsController();

// 替换后
private tabsController: HdsTabsController = new HdsTabsController();

// 使用
HdsTabs({ controller: this.tabsController }) {
  // ...
}
```

**重要说明：**
- 必须导入 `SymbolGlyphModifier`：`import { SymbolGlyphModifier } from '@kit.ArkUI';`
- 使用 `BottomTabBarStyle` 配置 TabBar 图标，无需自定义 @Builder TabBuilder
- 使用系统符号资源：`$r('sys.symbol.xxx')`
- `DividerMode` 用于配置分割线样式（VISIBLE 常显、NONE 常隐、FOLLOW_SCROLL 跟手渐变）
- `hdsMaterial` 用于配置材质效果（MaterialType 和 MaterialLevel）
- **必须配置悬浮效果（barFloatingStyle）和材质效果（systemMaterialEffect）**

**什么需要改，什么不需要改：**

| 项目 | 是否需要修改 | 说明 |
|------|------------|------|
| Tabs → HdsTabs | ✅ 需要修改 | 主组件名称需要替换 |
| TabsController → HdsTabsController | ✅ 需要修改 | 控制器类型需要替换 |
| TabContent | ❌ 不需要修改 | 保持原样，不需要改成 HdsTabContent |
| SubTabBarStyle | ❌ 不需要修改 | 保持原样，不需要改成 HdsSubTabBarStyle |
| BottomTabBarStyle | ❌ 不需要修改 | 保持原样，不需要改成 HdsBottomTabBarStyle |

---

### 2. HdsNavigation 组件

导航组件，默认支持标题栏随内容区滚动的动态模糊样式。

**主要特性：**
- 支持标题栏动态模糊
- 支持标题栏随滚动动态显隐
- 支持新材质按钮（6.1 新特性）
- 支持双栏模式
- 支持自定义工具栏

**对应基础组件：** `Navigation`

**导入方式：**
```typescript
import { HdsNavigation, ScrollEffectType, hdsMaterial } from '@kit.UIDesignKit';
import { LengthMetrics } from '@kit.ArkUI';
```

**titleBar 配置示例：**
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

**重要说明：**
- `ScrollEffectType` 用于配置滚动效果类型（IMMERSIVE_GRADIENT_BLUR 沉浸式渐变模糊等）
- `hdsMaterial` 用于配置材质效果
- 官方示例中只配置了必要的 `scrollEffectType`、`materialType` 和 `materialLevel`
- 其他属性如 `blurEffectiveStartOffset`、`originalStyle`、`scrollEffectStyle` 等可以根据需要添加，但不是必须的
```

**重要说明：**
- **必须配置 scrollEffectType 为沉浸式渐变模糊（IMMERSIVE_GRADIENT_BLUR）和材质效果（systemMaterialEffect）**
- `ScrollEffectType` 用于配置滚动效果类型（IMMERSIVE_GRADIENT_BLUR 沉浸式渐变模糊等）
- `hdsMaterial` 用于配置材质效果
- 官方示例中只配置了必要的 `scrollEffectType`、`materialType` 和 `materialLevel`
- 其他属性如 `blurEffectiveStartOffset`、`originalStyle`、`scrollEffectStyle` 等可以根据需要添加，但不是必须的

---

### 3. HdsToolBar 组件

页面顶部的悬浮工具栏，提供快捷操作入口，适用于沉浸式页面场景。

**重要说明：**
- **HdsToolBar 是命令式组件，不是声明式组件**
- 需要从 `@hms.hds.HdsToolBar` 导入（不是 `@kit.UIDesignKit`）
- 使用 `new HdsToolBar(this.getUIContext())` 创建实例
- 使用 `show()` 方法显示，`dismiss()` 方法关闭
- 不适合在声明式 `@Builder` 中使用
- 适用于需要动态控制显示/隐藏的复杂场景

**主要特性：**
- 支持左侧按钮组、右侧按钮组
- 支持标题显示
- 支持悬浮效果和材质效果（6.1 新特性）
- 支持背景模糊
- 适用于顶部工具栏场景

**对应基础组件：** 自定义顶部 Toolbar 实现、Row 容器拼出的工具栏

**导入方式：**
```typescript
import {
  HdsToolBar,
  HdsToolBarController,
  HdsToolBarItem,
  HdsToolBarItemImage,
  HdsToolBarItemState,
  HdsToolBarItemText,
  HdsToolBarMaterialType,
  HdsToolBarModifier,
  HdsToolBarParam,
  HdsToolBarSymbolGlyph,
  HdsToolBarMaterialLevel
} from '@hms.hds.HdsToolBar';
```

**使用示例：**
```typescript
// 创建实例
hdsToolBar: HdsToolBar = new HdsToolBar(this.getUIContext());

// 定义工具栏项
@State toolbarList: HdsToolBarItem[] = [
  new HdsToolBarItem({
    icon: new HdsToolBarSymbolGlyph({
      normal: new SymbolGlyphModifier($r('sys.symbol.heart')),
      activated: new SymbolGlyphModifier($r('sys.symbol.heart_fill')),
    }),
    state: HdsToolBarItemState.ENABLE,
    id: 'item01',
    action: (index: number) => {
      console.info('点击了按钮', index);
    }
  })
];

// 显示工具栏
aboutToAppear(): void {
  this.hdsToolBar.show(this.hdsToolBarParam);
}

// 关闭工具栏
onBackPress(): boolean | void {
  this.hdsToolBar.dismiss();
}
```

---

### 4. HdsActionBar 组件

页面底部的操作按钮栏，提供主要操作和次要操作入口，适用于详情页、内容页等场景。

**主要特性：**
- 支持主按钮（展开/收起）和多个次按钮
- 支持悬浮效果和材质效果（6.1 新特性）
- 支持背景模糊
- 适用于底部操作栏场景

**对应基础组件：** 自定义底部操作栏实现、Row 容器拼出的操作栏

**导入方式：**
```typescript
import { HdsActionBar, hdsMaterial } from '@kit.UIDesignKit';
```

**配置示例：**
```typescript
import { HdsActionBar, ActionBarButton, ActionBarStyle } from '@kit.UIDesignKit';

HdsActionBar({
  startButtons: [new ActionBarButton({
    baseIcon: $r('sys.symbol.stopwatch_fill')
  })],
  endButtons: [new ActionBarButton({
    baseIcon: $r('sys.symbol.mic_fill')
  })],
  primaryButton: new ActionBarButton({
    baseIcon: $r('sys.symbol.plus'),
    altIcon: $r('sys.symbol.play_fill'),
    onClick: () => {
      this.isExpand = !this.isExpand;
      this.isPrimaryIconChanged = !this.isPrimaryIconChanged;
    },
    hoverTips: this.primaryHoverTips
  }),
  actionBarStyle: new ActionBarStyle({
    isPrimaryIconChanged: this.isPrimaryIconChanged
  }),
  isExpand: this.isExpand
})
```

**重要说明：**
- `primaryButton` 是主按钮（通常尺寸较大，如点赞按钮），使用 `new ActionBarButton()` 构造
- `startButtons` 是左侧按钮组数组（可选）
- `endButtons` 是右侧按钮组数组，使用 `new ActionBarButton()` 构造
- 按钮图标使用 `baseIcon`（初始图标）和 `altIcon`（切换后图标）属性
- `actionBarStyle` 是操作栏样式配置，使用 `new ActionBarStyle()` 构造
- `isPrimaryIconChanged` 控制主按钮图标是否切换（true显示altIcon，false显示baseIcon）
- **注意：** 官方示例中ActionBarStyle只配置了`isPrimaryIconChanged`属性，其他属性（height、backgroundColor、backgroundBlurStyle等）需要使用LengthMetrics、ColorMetrics等类型，不建议随意添加

---

### 5. HdsListItem 组件

列表项组件，支持横滑动效，可以承载 HdsListItemCard 组件。

**主要特性：**
- 支持横滑动效
- 支持自定义列表项内容
- 支持删除操作
- 支持操作按钮配置

**对应基础组件：** `ListItem`

**导入方式：**
```typescript
import { HdsListItem } from '@kit.UIDesignKit';
```

**简单替换示例：**
```typescript
// 原代码
ListItem() {
  Column() {
    Text('列表项标题')
    Text('列表项描述')
  }
}

// 替换后
HdsListItem({
  customItemBuilder: () => {
    Column() {
      Text('列表项标题')
      Text('列表项描述')
    }
  }
})
```

**使用横滑动效示例：**
```typescript
HdsListItem({
  customItemBuilder: () => {
    Column() {
      Text('列表项标题')
      Text('列表项描述')
    }
  },
  swipeActionOptions: {
    icons: [
      {
        icon: $r('sys.symbol.star_fill'),
        iconColor: '#FFA000',
        backgroundColor: '#FFFFFF',
        action: () => {
          console.log('点击收藏');
        }
      }
    ],
    deleteIconOptions: {
      icon: $r('sys.symbol.trash_fill'),
      iconColor: '#FFFFFF',
      backgroundColor: '#FF3B30',
      action: () => {
        console.log('点击删除');
      }
    }
  }
})
```

**重要说明：**
- `customItemBuilder` - 自定义列表项内容（与 hdsListItemCard 二选一）
- `hdsListItemCard` - 使用 HdsListItemCard 组件
- `swipeActionOptions` - 横滑动效配置
- `icons` - 横滑操作按钮数组
- `deleteIconOptions` - 删除按钮配置

---

### 6. HdsSnackBar 组件

提示弹窗组件，提供简短通知的非模态弹窗，内部默认包含图标区、内容区和操作区。

**主要特性：**
- 非模态提示弹窗
- 默认包含图标、内容、操作三个区域
- 支持自定义样式
- 支持操作按钮

**对应基础组件：** `promptAction.showToast`

**导入方式：**
```typescript
import { HdsSnackBar } from '@kit.UIDesignKit';
import { SymbolGlyphModifier } from '@kit.ArkUI';
```

**替换示例：**
```typescript
// 原代码
promptAction.showToast({
  message: '操作成功'
});

// 替换后
const uiContext = this.getUIContext();
const snackBar = new HdsSnackBar(uiContext);

snackBar.show(
  {
    icon: $r('sys.symbol.checkmark_circle_fill'),
    iconSymbolModifier: new SymbolGlyphModifier($r('sys.symbol.checkmark_circle_fill'))
      .fontSize(24)
      .fontColor('#4CAF50')
  },
  {
    text: '操作成功',
    maxLines: 2
  },
  {
    text: '撤销',
    action: () => {
      console.log('点击撤销');
    }
  }
);
```

**重要说明：**
- 需要通过 `getUIContext()` 获取 UIContext
- 第一个参数 - 图标配置（SnackBarIconOptions）
- 第二个参数 - 消息配置（SnackBarMessageOptions）
- 第三个参数 - 操作配置（SnackBarOperationOptions）
- 第四个参数 - 样式配置（可选，SnackBarStyleOptions）
- 调用 `dismiss()` 方法可以关闭 SnackBar

---

### 7. HdsSideBar 组件

侧边栏组件，支持显示和隐藏的侧边栏容器，可以自定义侧边栏和内容区。

**主要特性：**
- 支持侧边栏显示/隐藏
- 支持模糊效果
- 支持自定义侧边栏和内容区
- 支持侧边栏宽度配置

**对应基础组件：** `SideBarContainer` + `SideBar`

**导入方式：**
```typescript
import { HdsSideBar } from '@kit.UIDesignKit';
```

**简单替换示例：**
```typescript
// 原代码
SideBarContainer(SideBarContainerType.Embed) {
  // 侧边栏
  Column() {}
  // 内容区
  Column() {}
}

// 替换后
HdsSideBar({
  sideBarPanelBuilder: () => {
    Column() {
      Text('侧边栏')
    }
    .width('100%')
    .height('100%')
  },
  contentPanelBuilder: () => {
    Column() {
      Text('内容区')
    }
    .width('100%')
    .height('100%')
  }
})
```

**完整配置示例：**
```typescript
@Entry
@ComponentV2
struct Index {
  @Local isShowSidebar: boolean = true;

  build() {
    HdsSideBar({
      isShowSideBar: this.isShowSidebar,
      $isShowSideBar: (isShow: boolean) => {
        this.isShowSidebar = isShow;
      },
      sideBarWidth: 240,
      isSideBarBlur: true,  // 模糊效果
      sideBarPanelBuilder: () => {
        Column() {
          Text('侧边栏')
        }
        .width('100%')
        .height('100%')
      },
      contentPanelBuilder: () => {
        Column() {
          Text('内容区')
        }
        .width('100%')
        .height('100%')
      }
    })
  }
}
```

**重要说明：**
- `isShowSideBar` - 是否显示侧边栏
- `$isShowSideBar` - 侧边栏显示状态回调
- `sideBarWidth` - 侧边栏宽度
- `isSideBarBlur` - 是否开启模糊效果
- `sideBarPanelBuilder` - 侧边栏内容构建器
- `contentPanelBuilder` - 内容区构建器

---



### 8. HdsNavDestination 组件



作为子页面的根容器，用于显示HdsNavigation的内容区，默认支持标题栏随内容区滚动的动态模糊样式。



**主要特性：**

- 支持标题栏动态模糊

- 支持标题栏随滚动动态显隐

- 支持系统转场动画和自定义转场动画

- 支持工具栏配置

- 支持bindToScrollable/bindToNestedScrollable绑定滚动容器



**对应基础组件：** `NavDestination`



**导入方式：**

```typescript

import { HdsNavDestination } from '@kit.UIDesignKit';

```



**配置示例：**
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

**重要说明：**
- 必须配合HdsNavigation使用，作为其子页面的根节点
- 推荐使用bindToScrollable/bindToNestedScrollable绑定滚动容器
- `scrollEffectType` - 滚动模糊类型：IMMERSIVE_GRADIENT_BLUR（沉浸式渐变模糊，推荐）
- `materialType` - 材质类型：IMMERSIVE（沉浸式）、NONE（无材质）
- `materialLevel` - 材质级别：ADAPTIVE（自适应）、EXQUISITE（精致）



---



### 9. HdsSideMenu 组件



侧边菜单栏组件，设置侧边栏对应的一级菜单和二级菜单，并显示其新消息数量。



**主要特性：**

- 支持一级菜单和二级菜单

- 支持角标显示（消息数量）

- 支持图标和文本配置

- 最多支持5个一级菜单，每个一级菜单最多5个二级菜单



**对应基础组件：** 自定义侧边菜单实现



**导入方式：**

```typescript

import { HdsSideMenu, HdsSideMenuMainItem, HdsSideMenuSubItem, HdsSideMenuBadgeParam } from '@kit.UIDesignKit';

import { SymbolGlyphModifier } from '@kit.ArkUI';

```



**配置示例：**

```typescript

@Local selectedIndex: number = 0;



// 创建菜单项

listOptions: HdsSideMenuMainItem[] = [

  new HdsSideMenuMainItem({

    symbol: new SymbolGlyphModifier($r('sys.symbol.doc_plaintext')),

    label: '全部备忘',

    hdsSideMenuSubItem: [

      new HdsSideMenuSubItem({ label: '子菜单1' }),

      new HdsSideMenuSubItem({ label: '子菜单2' })

    ],

    badge: { count: 5 }  // 角标数量

  }),

  new HdsSideMenuMainItem({

    symbol: new SymbolGlyphModifier($r('sys.symbol.star')),

    label: '收藏'

  })

];



// 使用

HdsSideMenu({

  items: this.listOptions,

  selectedIndex: this.selectedIndex,

  $selectedIndex: (selectedIndex: number) => {

    this.selectedIndex = selectedIndex;

  }

})

```



**重要说明：**

- `items` - 一级菜单数组，最多5个

- `selectedIndex` - 当前选中的菜单索引，-1表示没有选中

- `$selectedIndex` - 选中状态变化回调

- `maxItemTextLines` - 最大内容行数，默认1

- 使用`updateBadge`方法更新角标



---



### 10. HdsListItemCard 组件



列表项卡片组件，提升视觉体验，统一组件风格样式，实现多设备上的系统列表样式。



**主要特性：**

- 支持A区（左侧）、B区（中间）、C区（右侧）三段式布局

- 支持多种元素类型：Image、Icon、Badge、Switch、ToggleButton、Button等

- 统一的视觉风格和交互体验

- 支持点击、长按等交互



**对应基础组件：** `ListItem` + 自定义布局



**导入方式：**

```typescript

import { HdsListItemCard, PrefixImage, PrefixIcon, MainTitle, SubTitle, Description } from '@kit.UIDesignKit';

```



**配置示例：**

```typescript

HdsListItemCard({

  prefix: new PrefixImage({

    options: {

      imageSource: $r('app.media.icon'),

      onClick: () => {

        console.info('点击图片');

      }

    }

  }),

  main: new MainTitle({

    title: '列表项标题',

    onClick: () => {

      console.info('点击标题');

    }

  }),

  sub: new SubTitle({

    subTitle: '副标题'

  }),

  description: new Description({

    description: '描述信息'

  }),

  cardWidth: '100%',

  cardHeight: 72,

  cardBackgroundColor: '#FFFFFF',

  onClick: () => {

    console.info('点击卡片');

  }

})

```



**重要说明：**

- `prefix` - A区（左侧）元素：PrefixImage、PrefixIcon、PrefixBadge、PrefixSwitch等

- `main` - B区（中间）主元素：MainTitle、MainImage等

- `sub` - B区（中间）次元素：SubTitle、SubDescription等

- `description` - B区（中间）描述元素

- `suffix` - C区（右侧）元素：SuffixIcon、SuffixSwitch等

- 建议直接使用HdsListItemCardOptions进行属性设置，不要使用通用属性



---



### 11. HdsVisualComponent 组件



通用视效组件，承载复杂视效实现，通过选择具体视效场景完成复杂视效的开发。



**主要特性：**

- 支持多种视效场景（如双边流光等）

- 提供场景控制器控制视效播放

- 支持帧率配置

- 支持视效结束回调



**对应基础组件：** 无（新增组件）



**导入方式：**

```typescript

import { HdsVisualComponent, HdsSceneController, HdsSceneType, hdsEffect } from '@kit.UIDesignKit';

```



**配置示例：**

```typescript

@State sceneController: HdsSceneController = new HdsSceneController()

  .setSceneParams({

    backgroundMaskColors: [Color.Green, Color.Red],

    firstEdgeFlowLight: {

      startPos: 0,

      endPos: 0.5,

      color: Color.Red

    },

    secondEdgeFlowLight: {

      startPos: 0,

      endPos: -0.5,

      color: Color.Green

    }

  });



HdsVisualComponent()

  .scene(HdsSceneType.DUAL_EDGE_FLOW_LIGHT_WITH_BACKGROUND_MASK, this.sceneController, () => {

    console.info('视效结束');

  })

  .width('100%')

  .height('50%')

```



**重要说明：**

- `sceneType` - 视效场景类型，目前支持DUAL_EDGE_FLOW_LIGHT_WITH_BACKGROUND_MASK（双边流光）

- `controller` - 场景控制器，支持start、pause、resume、stop等方法

- `callback` - 视效结束回调

- `frameRateRange` - 帧率配置

- 使用setSceneParams设置场景参数



---



### 组件识别特征

| HDS 组件 | 识别特征 | 常见基础容器模式 |
| ------- | -------- | --------------- |
| **HdsTabs** | 底部或侧边的页签切换栏、有图标+文字的页签项、支持滑动切换 | `Column` + 底部 `Row`（页签栏）+ `Scroll`（内容区） |
| **HdsNavigation** | 顶部导航栏、包含返回按钮、标题、菜单按钮、支持滚动模糊 | `Column` + 顶部 `Row`（导航栏）+ `Scroll`（内容区） |
| **HdsToolBar** | 顶部或底部悬浮工具栏、左右两侧按钮、中间标题、有阴影/模糊效果 | `Column` + `Scroll` + 顶部或底部 `Row`（工具栏） |
| **HdsActionBar** | 底部操作按钮栏、有主按钮（展开/收起）和多个次按钮、悬浮效果 | `Column` + `Scroll` + 底部 `Row` 或 `Column`（操作栏） |
| **HdsListItem** | 列表项、支持横滑操作、有滑动删除或操作按钮 | `ListItem` + `swipeAction` |
| **HdsSnackBar** | 提示弹窗、非模态、包含图标和操作按钮 | `promptAction.showToast` |
| **HdsSideBar** | 侧边栏容器、可显示/隐藏、支持模糊效果 | `SideBarContainer` + `SideBar` |
| **HdsNavDestination** | 子页面根容器、标题栏随滚动动态模糊、支持转场动画 | `NavDestination` + 标题栏配置 |
| **HdsSideMenu** | 侧边菜单栏、一级菜单+二级菜单、支持角标显示 | `Column` + `List` + 自定义菜单项 |
| **HdsListItemCard** | 三段式列表项卡片（左中右）、统一视觉风格 | `ListItem` + `Row`（多段布局） |
| **HdsVisualComponent** | 复杂视效实现、流光等动画效果 | 自定义动画实现 |

### 识别要点

1. **位置特征**：组件在页面中的位置（顶部、底部、侧边）
2. **布局特征**：使用的容器组合（Column+Row、Scroll+工具栏等）
3. **样式特征**：是否有悬浮效果（shadow）、模糊效果（blur）、渐变等
4. **功能特征**：提供的交互功能（导航、切换、操作等）