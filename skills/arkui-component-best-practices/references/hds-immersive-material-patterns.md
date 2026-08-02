# HDS 沉浸光感材质模式

## 什么时候使用

用户提到这些需求时读本文件：

- 沉浸光感、光感材质、HDS 材质、系统材质效果
- HDS 导航标题栏按钮、`HdsNavigation`、`titleBar`、`TitleBarStyleOptions`
- HDS 底部页签、`HdsTabs`、悬浮底部栏、`HdsTabsFloatingStyle`
- `systemMaterialEffect`、`hdsMaterial.MaterialType`、`hdsMaterial.MaterialLevel`
- 不同设备性能下材质效果、发热、卡顿、降级策略

来源示例：

- 华为开发者文档《沉浸光感》
- 官方链接：https://developer.huawei.com/consumer/cn/doc/harmonyos-guides/ui-design-hds-component-material
- 相关 API：`TitleBarStyleOptions.systemMaterialEffect`、`HdsTabsFloatingStyle.systemMaterialEffect`、`hdsMaterial.getSystemMaterialTypes()`

## 核心判断

沉浸光感是 HDS 组件的系统材质能力，从 HarmonyOS 6.1.0(23) 开始支持。当前官方场景集中在：

- HDS 导航：给标题栏按钮设置沉浸光感。
- HDS 底部页签：给底部悬浮页签设置沉浸光感。

默认优先使用系统自适应策略：

```ts
systemMaterialEffect: {
  materialType: hdsMaterial.MaterialType.ADAPTIVE,
  materialLevel: hdsMaterial.MaterialLevel.ADAPTIVE
}
```

自适应策略由系统根据设备能力平衡显示效果和性能。除非产品明确要求固定视觉等级，否则不要直接写死高等级材质。

## 推荐结构

- `HdsNavigation`：承载页面导航和标题栏。
- `HdsTabs`：承载底部页签。
- `Scroller`：绑定导航滚动效果，让标题栏与内容滚动关系稳定。
- `systemMaterialEffect`：同时用于标题栏样式和底部悬浮页签样式。
- `hdsMaterial.MaterialType.ADAPTIVE`：让系统选择合适材质类型。
- `hdsMaterial.MaterialLevel.ADAPTIVE`：让系统选择合适材质等级。

## 系统自适应写法

适合大多数页面。标题栏按钮和底部悬浮页签都使用 `ADAPTIVE`：

```ts
import {
  HdsNavigation,
  HdsNavigationTitleMode,
  HdsTabs,
  HdsTabsController,
  ScrollEffectType,
  hdsMaterial
} from '@kit.UIDesignKit';

@Entry
@Component
export struct ImmersiveMaterialPage {
  private scroller: Scroller = new Scroller();
  private tabsController: HdsTabsController = new HdsTabsController();

  build() {
    HdsNavigation() {
      HdsTabs({ controller: this.tabsController }) {
        TabContent() {
          Scroll(this.scroller) {
            Column() {
              Image($r('app.media.scenery01'))
                .width('100%')
                .objectFit(ImageFit.Cover)
            }
          }
          .height('100%')
          .clipContent(ContentClipMode.SAFE_AREA)
        }
        .tabBar('首页')
      }
      .barOverlap(true)
      .vertical(false)
      .barPosition(BarPosition.End)
      .barFloatingStyle({
        barBottomMargin: 28,
        systemMaterialEffect: {
          materialType: hdsMaterial.MaterialType.ADAPTIVE,
          materialLevel: hdsMaterial.MaterialLevel.ADAPTIVE
        }
      })
    }
    .mode(NavigationMode.Stack)
    .titleBar({
      content: {
        title: {
          mainTitle: 'MainTitle'
        }
      },
      style: {
        scrollEffectOpts: {
          enableScrollEffect: false,
          scrollEffectType: ScrollEffectType.GRADIENT_BLUR
        },
        systemMaterialEffect: {
          materialType: hdsMaterial.MaterialType.ADAPTIVE,
          materialLevel: hdsMaterial.MaterialLevel.ADAPTIVE
        }
      },
      avoidLayoutSafeArea: false,
      enableComponentSafeArea: false
    })
    .bindToScrollable([this.scroller])
    .hideBackButton(false)
    .titleMode(HdsNavigationTitleMode.MINI)
    .ignoreLayoutSafeArea(
      [LayoutSafeAreaType.SYSTEM],
      [LayoutSafeAreaEdge.TOP, LayoutSafeAreaEdge.BOTTOM]
    )
  }
}
```

## 自定义等级写法

只有在产品明确要求固定视觉等级时才使用自定义。自定义前必须先查设备支持能力：

```ts
@State materialLevel: hdsMaterial.MaterialLevel = hdsMaterial.MaterialLevel.EXQUISITE;

aboutToAppear(): void {
  const materialTypes: Array<hdsMaterial.MaterialType> = hdsMaterial.getSystemMaterialTypes();
  if (materialTypes.indexOf(hdsMaterial.MaterialType.IMMERSIVE) < 0) {
    this.materialLevel = hdsMaterial.MaterialLevel.SMOOTH;
  }
}
```

设置时继续用统一状态：

```ts
systemMaterialEffect: {
  materialType: hdsMaterial.MaterialType.ADAPTIVE,
  materialLevel: this.materialLevel
}
```

判断规则：

- 支持 `IMMERSIVE`：可按产品需要选择 `EXQUISITE` 或 `GENTLE`。
- 不支持 `IMMERSIVE`：降级到 `SMOOTH`，降低卡顿和发热风险。

## 实践要点

- 优先选择 `ADAPTIVE + ADAPTIVE`，把性能与显示平衡交给系统。
- 自定义等级必须在生命周期中查询能力，不要假设所有设备都支持 `IMMERSIVE`。
- 标题栏和底部页签如果同时使用沉浸光感，建议共用同一个 `materialLevel` 状态，避免页面上下材质不一致。
- 沉浸光感常与大图、滚动内容、悬浮底栏一起出现，内容层要处理安全区和裁剪边界。
- `barOverlap(true)`、`barFloatingStyle`、`ignoreLayoutSafeArea` 会影响内容和页签的叠放关系，调试时先确认哪个组件负责沉浸、哪个组件负责避让。
- `scrollEffectOpts` 与 `systemMaterialEffect` 是不同层面的视觉效果；不要把滚动渐变模糊当作沉浸光感本身。

## 常见坑

- 直接写 `EXQUISITE`，在不支持 `IMMERSIVE` 的设备上可能带来卡顿或发热。
- 只给标题栏设置材质，底部悬浮页签没设置，页面上下视觉不统一。
- 只给底部页签设置材质，但没有开启合适的悬浮和重叠布局，效果不明显。
- 把沉浸光感写在普通 ArkUI `Navigation` / `Tabs` 上；该能力属于 HDS 组件样式参数。
- 忽略安全区后没有给内容足够底部空间，底部页签可能遮挡列表或按钮。
- 把 `getSystemMaterialTypes()` 放进频繁执行的计算逻辑；它应在生命周期或初始化路径里更新状态。

## 回答用户时应包含

1. 是否使用 HDS 组件，而不是普通 ArkUI `Navigation` / `Tabs`。
2. 为什么优先选 `ADAPTIVE + ADAPTIVE`。
3. 如果要求自定义，如何用 `getSystemMaterialTypes()` 做能力判断和降级。
4. 标题栏、底部页签、安全区、滚动内容的层级关系。
