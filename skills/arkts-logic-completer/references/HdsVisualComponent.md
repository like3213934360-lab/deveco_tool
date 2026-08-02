# HdsVisualComponent 组件功能逻辑规格

> HDS (UI Design Kit) 组件,承载"复杂视效"实现(edge flow light / 背景蒙层 / 帧率可控动画)。
> 华为官方原文:[../../../hds参考文档/中文文档/HdsVisualComponent.md](../../../hds参考文档/中文文档/HdsVisualComponent.md)
> 装饰器:普通 `@Component`(V1)。无子组件。从 6.0.2(22) 起支持 ArkTS 卡片。

## 1. 功能定位

把复杂视效(目前官方只有 1 种场景:"双边流光 + 背景蒙层")封装成一个组件,通过**场景类型枚举 + 控制器**驱动:

- `scene(sceneType, controller, callback?, frameRateRange?)` 设置视效类型与参数
- `HdsSceneController` 控制视效生命周期:`start()` / `pause()` / `resume()` / `stop()`
- `setSceneParams(params: SceneParams)` 动态更新参数(链式返回 controller)
- 可选帧率配置 `ExpectedFrameRateRange`

**起始版本**:6.0.0 (API 20)。TV 设备上 `DUAL_EDGE_FLOW_LIGHT_WITH_BACKGROUND_MASK` 无效果。

## 2. 典型场景

- AI 对话页的边缘流光(正在思考/生成中)
- 游戏/动画 App 的"高光氛围"背景
- 首页卡片 loading 特效
- 支付/订单确认中的视觉引导

## 3. 状态声明

```typescript
import {
  HdsVisualComponent,
  HdsSceneController,
  HdsSceneType,
  hdsEffect
} from '@kit.UIDesignKit'

@Entry
@Component
struct AIChatBubble {
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
    })
}
```

> - 用 `@State` 持有 controller,是为了让"重建时"变化推回组件。日常不需要 setState 它。
> - `new HdsSceneController().setSceneParams(...)` 链式返回 controller 本身,用来就地初始化。
> - **不要**在 build() 里调用 `start() / pause()`,这些是副作用方法,放到 `aboutToAppear` / `onClick` / 业务回调里。

## 4. 事件与交互逻辑

### 控制生命周期

```typescript
aboutToAppear(): void {
  this.sceneController.start()
}

aboutToDisappear(): void {
  this.sceneController.stop()
}
```

- `start()`:开始视效场景
- `pause()`:暂停(保留当前帧)
- `resume()`:恢复
- `stop()`:停止(回到初始状态)

### 动态更新参数

```typescript
Button('换颜色').onClick(() => {
  this.sceneController.setSceneParams({
    backgroundMaskColors: [Color.Blue, Color.Yellow],
    firstEdgeFlowLight: { startPos: 0, endPos: 0.3, color: Color.Blue },
    secondEdgeFlowLight: { startPos: 0, endPos: -0.3, color: Color.Yellow }
  })
})
```

`setSceneParams` 返回当前 controller,支持链式。

### 结束回调 & 帧率

```typescript
HdsVisualComponent()
  .scene(
    HdsSceneType.DUAL_EDGE_FLOW_LIGHT_WITH_BACKGROUND_MASK,
    this.sceneController,
    () => { console.info('scene finished') },
    { min: 30, max: 60, expected: 60 }
  )
```

- `callback: () => void`:场景"结束"时触发(具体何时算结束取决于场景类型)
- `frameRateRange: hdsEffect.ExpectedFrameRateRange`:`{ min, max, expected }`

## 5. 数据结构

### 接口

```typescript
HdsVisualComponent()
  .scene(
    sceneType: HdsSceneType,
    controller: HdsSceneController,
    callback?: HdsSceneFinishCallback,
    frameRateRange?: hdsEffect.ExpectedFrameRateRange
  )
```

### HdsSceneType 枚举

| 名 | 值 | 说明 |
|----|----|------|
| `DUAL_EDGE_FLOW_LIGHT_WITH_BACKGROUND_MASK` | 0 | 自带背景蒙层的双边流光。TV 无效 |

### HdsSceneFinishCallback

`type HdsSceneFinishCallback = () => void`

### HdsSceneController API

| 方法 | 签名 | 说明 |
|------|------|------|
| `constructor()` | `HdsSceneController` | 构造 |
| `start()` | `void` | 开始 |
| `pause()` | `void` | 暂停 |
| `resume()` | `void` | 恢复 |
| `stop()` | `void` | 停止 |
| `setSceneParams(params)` | `(params: SceneParams) => HdsSceneController` | 设置/更新参数,返回自身 |

### SceneParams 联合类型

```typescript
type SceneParams = DualEdgeFlowLightWithMaskParam
```

目前只有一个场景参数类型。

### DualEdgeFlowLightWithMaskParam

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `backgroundMaskColors` | `Array<ResourceColor>` | 是 | 背景蒙层颜色数组(渐变) |
| `firstEdgeFlowLight` | `hdsEffect.EdgeFlowLightParam` | 是 | 第一条流光参数 |
| `secondEdgeFlowLight` | `hdsEffect.EdgeFlowLightParam` | 是 | 第二条流光参数 |

### hdsEffect.EdgeFlowLightParam(简明)

常用字段:`startPos`(0~1 或负值,沿边缘起点位置) / `endPos` / `color`。完整字段见官方 `ui-design-hdseffect` 页。

### hdsEffect.ExpectedFrameRateRange

`{ min: number, max: number, expected: number }`

## 6. 联动说明

- 通常包在 `Stack { HdsVisualComponent().scene(...) ; /* 文字/图片 */ }` 中,作为背景层。
- 与 `HdsNavigation` 共存:放在 NavDestination 的内容区,切页时 `aboutToDisappear` 记得 `stop()` 节省能耗。
- `@State sceneController`:只有"替换整个 controller 对象"才会触发 UI 重建;改其内部字段需要 `setSceneParams(...)`。
- 动态切换场景类型(当前只有 1 种,未来扩展时)需要换一组参数,`stop()` 后再 `start()`。

## 7. 完整代码示例

> AI 对话 Bubble 的"思考中"背景流光,进入时开始、离开时停止,点击切换颜色。

```typescript
import {
  HdsVisualComponent,
  HdsSceneController,
  HdsSceneType
} from '@kit.UIDesignKit'

@Entry
@Component
struct AIChatBubble {
  @State controller: HdsSceneController = new HdsSceneController()
    .setSceneParams({
      backgroundMaskColors: [Color.Green, Color.Red],
      firstEdgeFlowLight: { startPos: 0, endPos: 0.5, color: Color.Red },
      secondEdgeFlowLight: { startPos: 0, endPos: -0.5, color: Color.Green }
    })

  @State thinking: boolean = true

  aboutToAppear(): void {
    this.controller.start()
  }

  aboutToDisappear(): void {
    this.controller.stop()
  }

  build() {
    Stack() {
      HdsVisualComponent()
        .scene(
          HdsSceneType.DUAL_EDGE_FLOW_LIGHT_WITH_BACKGROUND_MASK,
          this.controller,
          () => { console.info('light finished') }
        )
        .width('100%')
        .height('50%')

      Column({ space: 12 }) {
        Text(this.thinking ? 'AI 正在思考…' : 'AI 已完成').fontSize(20).fontColor(Color.White)
        Button(this.thinking ? '暂停流光' : '继续流光')
          .onClick(() => {
            if (this.thinking) {
              this.controller.pause()
            } else {
              this.controller.resume()
            }
            this.thinking = !this.thinking
          })
        Button('换配色')
          .onClick(() => {
            this.controller.setSceneParams({
              backgroundMaskColors: [Color.Blue, Color.Yellow],
              firstEdgeFlowLight: { startPos: 0, endPos: 0.3, color: Color.Blue },
              secondEdgeFlowLight: { startPos: 0, endPos: -0.3, color: Color.Yellow }
            })
          })
      }
    }
    .width('100%')
    .height('100%')
  }
}
```

## 8. 反面示例

### 错 1:在 build() 里 start()

```typescript
build() {
  this.controller.start()   // ❌ 渲染时反复调用
  HdsVisualComponent().scene(...)
}
```

应放在 `aboutToAppear()` 或事件回调里。

### 错 2:把 controller 设成 const 成员

```typescript
private controller: HdsSceneController = new HdsSceneController()...
```

失去响应性:`setSceneParams` 后如依赖 `@State` 触发重建的逻辑不会生效。应当用 `@State`(大部分场景仅用于"持有"即可,不期待响应式)。

### 错 3:忘记 stop()

页面退出时没 stop,视效动画仍在跑,耗电且干扰下一页。务必 `aboutToDisappear { this.controller.stop() }`。

### 错 4:期望 TV 上有效果

文档明确 `DUAL_EDGE_FLOW_LIGHT_WITH_BACKGROUND_MASK` 在 TV 无效果,应做设备形态判断或降级处理。

### 错 5:backgroundMaskColors 传单色

```typescript
backgroundMaskColors: [Color.Blue]   // ❌ 至少两个才有渐变
```

"蒙层颜色数组"至少 2 个元素才会形成渐变视觉效果。

## 9. API 速查

| 符号 | 签名 | 说明 |
|------|------|------|
| `HdsVisualComponent()` | 构造 | 无参 |
| `.scene(sceneType, controller, cb?, fpsRange?)` | — | 设置视效场景 |
| `HdsSceneController` | class | 控制器 |
| `.start() / .pause() / .resume() / .stop()` | `(): void` | 生命周期 |
| `.setSceneParams(params)` | `(p: SceneParams): HdsSceneController` | 动态更新参数,链式返回自身 |
| `HdsSceneType` | enum | `DUAL_EDGE_FLOW_LIGHT_WITH_BACKGROUND_MASK = 0` |
| `HdsSceneFinishCallback` | `() => void` | 场景结束回调 |
| `SceneParams` | `DualEdgeFlowLightWithMaskParam` | 当前只有 1 种 |
| `DualEdgeFlowLightWithMaskParam` | `{ backgroundMaskColors[], firstEdgeFlowLight, secondEdgeFlowLight }` | 均必填 |
| `ExpectedFrameRateRange` | `{ min, max, expected }` | 帧率 |
| 卡片能力 | 6.0.2(22)+ | 支持 ArkTS 卡片 |

**记忆锚点**:`@State controller = new HdsSceneController().setSceneParams(...)` → `.scene(type, controller)` → 生命周期里 `start()/stop()`。
