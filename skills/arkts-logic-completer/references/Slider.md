# Slider 组件功能逻辑规格

## 1. 功能定位

Slider 是滑动条组件，用于通过拖动滑块在一个连续或离散的数值范围内选择值。当界面需要调节数值型设置（音量、亮度、进度、价格区间）时使用。

## 2. 典型场景

- 音量 / 亮度调节
- 价格区间筛选
- 视频播放进度条
- 字体大小调节（设置页）

## 3. 状态声明

```typescript
// 基础滑动值
@State sliderValue: number = 50

// 音量调节场景
@State volume: number = 70

// 区间选择场景
@State minPrice: number = 0
@State maxPrice: number = 1000

// 显示文本
@State displayText: string = '50%'
```

## 4. 事件与交互逻辑

### onChange 核心事件

滑块拖动或点击滑轨时触发，包含当前值和触发模式：

```typescript
Slider({ value: this.volume, min: 0, max: 100, step: 1 })
  .onChange((value: number, mode: SliderChangeMode): void => {
    this.volume = value
    if (mode === SliderChangeMode.End) {
      this.applyVolume(value)
    }
  })
```

### 场景一：音量调节（带实时反馈）

```typescript
Slider({
  value: this.volume,
  min: 0,
  max: 100,
  step: 1,
  style: SliderStyle.InSet
})
  .blockColor('#191970')
  .trackColor('#ADD8E6')
  .selectedColor('#4169E1')
  .showTips(true, this.volume.toFixed(0) + '%')
  .onChange((value: number, mode: SliderChangeMode): void => {
    this.volume = value
  })
```

### 场景二：步长滑块（离散值）

```typescript
Slider({
  value: this.fontSize,
  min: 12,
  max: 30,
  step: 2,
  style: SliderStyle.OutSet
})
  .showSteps(true)
  .showTips(true)
  .onChange((value: number, mode: SliderChangeMode): void => {
    this.fontSize = value
  })
```

### 场景三：双向绑定

```typescript
Slider({
  value: $$this.sliderValue,
  min: 0,
  max: 100
})
```

## 5. 数据结构

```typescript
interface SliderConfig {
  min: number
  max: number
  step: number
  value: number
  style: SliderStyle      // OutSet | InSet | NONE
  direction: Axis          // Horizontal | Vertical
}

interface SliderDisplayConfig {
  showTips: boolean
  showSteps: boolean
  tipsContent: string
  trackThickness: number
}
```

## 6. 联动说明

- 滑块拖动 → onChange 回调 → 实时更新 Text 显示值
- 滑块松手（End 模式）→ 发起设置请求或应用设置
- 外部 Button 点击 → 修改 @State 值 → 滑块位置自动同步
- 多个 Slider 联动（如最低价 ≤ 最高价）→ onChange 中增加边界校验
- Slider 值变化 → 驱动其他组件样式（如字体大小预览）

## 7. 完整代码示例

```typescript
@Entry
@Component
struct SettingsPage {
  @State brightness: number = 70
  @State volume: number = 50
  @State fontSize: number = 16

  build() {
    Column({ space: 24 }) {
      Text('显示与声音设置')
        .fontSize(22)
        .fontWeight(FontWeight.Bold)
        .width('100%')

      Column({ space: 8 }) {
        Row() {
          Text('亮度')
            .fontSize(14)
            .fontColor('#333')
          Blank()
          Text(this.brightness.toFixed(0) + '%')
            .fontSize(14)
            .fontColor('#666')
        }
        .width('100%')

        Slider({
          value: this.brightness,
          min: 0,
          max: 100,
          step: 1,
          style: SliderStyle.InSet
        })
          .selectedColor('#FFC107')
          .trackColor('#F5F5F5')
          .onChange((value: number, mode: SliderChangeMode): void => {
            this.brightness = value
          })
      }

      Column({ space: 8 }) {
        Row() {
          Text('音量')
            .fontSize(14)
            .fontColor('#333')
          Blank()
          Text(this.volume.toFixed(0) + '%')
            .fontSize(14)
            .fontColor('#666')
        }
        .width('100%')

        Slider({
          value: this.volume,
          min: 0,
          max: 100,
          step: 5,
          style: SliderStyle.OutSet
        })
          .showSteps(true)
          .showTips(true)
          .blockColor(Color.White)
          .selectedColor('#4169E1')
          .trackColor('#E0E0E0')
          .onChange((value: number, mode: SliderChangeMode): void => {
            this.volume = value
          })
      }

      Column({ space: 8 }) {
        Row() {
          Text('字体大小')
            .fontSize(14)
            .fontColor('#333')
          Blank()
          Text(this.fontSize.toFixed(0) + 'fp')
            .fontSize(14)
            .fontColor('#666')
        }
        .width('100%')

        Slider({
          value: this.fontSize,
          min: 12,
          max: 28,
          step: 2,
          style: SliderStyle.OutSet
        })
          .showSteps(true)
          .blockColor('#FF5722')
          .selectedColor('#FF5722')
          .onChange((value: number, mode: SliderChangeMode): void => {
            this.fontSize = value
          })

        Text('预览文字效果')
          .fontSize(this.fontSize)
          .fontColor('#333')
          .margin({ top: 8 })
      }

      Row({ space: 16 }) {
        Button('重置')
          .onClick((): void => {
            this.brightness = 70
            this.volume = 50
            this.fontSize = 16
          })
        Button('保存')
          .onClick((): void => {
            this.saveSettings()
          })
      }
      .width('100%')
      .justifyContent(FlexAlign.End)
    }
    .width('100%')
    .height('100%')
    .padding(24)
  }

  saveSettings(): void {
    console.info('brightness=' + this.brightness + ' volume=' + this.volume + ' fontSize=' + this.fontSize)
  }
}
```

## 8. 反面示例

```typescript
// ❌ 没有 onChange，滑块可以拖动但不更新状态
Slider({ value: 50, min: 0, max: 100 })

// ❌ min >= max，导致滑块行为异常
Slider({ value: 50, min: 100, max: 0 })

// ❌ step 为 0 或负值，导致步长无效
Slider({ value: 50, min: 0, max: 100, step: 0 })

// ❌ 没有显示当前值，用户不知道滑到了多少
Slider({ value: this.volume, min: 0, max: 100 })
  .onChange((value: number, mode: SliderChangeMode) => {
    this.volume = value
    // 缺少 Text 显示当前值
  })

// ❌ 在 Moving 模式下发起网络请求，导致大量无效请求
Slider({ value: this.brightness, min: 0, max: 100 })
  .onChange((value: number, mode: SliderChangeMode) => {
    this.brightness = value
    this.saveBrightnessToServer(value)  // 应该在 End 模式下才保存
  })
```

## 9. API 速查

| API | 说明 |
|-----|------|
| `Slider(options?)` | 创建滑动条，options 包含 value / min / max / step / style / direction / reverse |
| `SliderStyle.OutSet` | 滑块在滑轨上（默认） |
| `SliderStyle.InSet` | 滑块在滑轨内 |
| `SliderStyle.NONE` | 无滑块（API 12+） |
| `.blockColor(color)` | 滑块颜色 |
| `.trackColor(color \| LinearGradient)` | 滑轨背景颜色，支持渐变色 |
| `.selectedColor(color)` | 已滑动部分颜色 |
| `.showSteps(boolean)` | 是否显示步长刻度 |
| `.showTips(boolean, content?)` | 滑动时是否显示气泡提示 |
| `.trackThickness(Length)` | 滑轨粗细 |
| `.blockSize(SizeOptions)` | 滑块大小 |
| `.blockStyle(SliderBlockStyle)` | 滑块形状：DEFAULT / IMAGE / SHAPE |
| `.blockBorderColor(color)` | 滑块描边颜色 |
| `.blockBorderWidth(Length)` | 滑块描边粗细 |
| `.stepColor(color)` | 刻度颜色 |
| `.stepSize(Length)` | 刻度大小 |
| `.trackBorderRadius(Length)` | 滑轨圆角 |
| `.selectedBorderRadius(Dimension)` | 已滑动部分圆角 |
| `.sliderInteractionMode(mode)` | 交互方式：SLIDE_AND_CLICK / SLIDE_ONLY / SLIDE_AND_CLICK_UP |
| `.slideRange(SlideRange)` | 有效滑动区间 { from, to } |
| `.onChange(callback)` | 滑块变化回调 (value, mode) |
| `SliderChangeMode` | Begin(0) / Moving(1) / End(2) / Click(3) |

> **注意**：onChange 的 value 可能含小数，显示时建议用 `value.toFixed(0)` 或 `value.toFixed(1)` 处理精度。
