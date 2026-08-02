# TextClock 组件功能逻辑规格

## 1. 功能定位

TextClock 是文本时钟组件，通过文本将当前系统时间显示在设备上。当界面需要实时显示时间且支持启停控制和时区切换时使用。

## 2. 典型场景

- 桌面/锁屏界面的实时时钟显示
- 世界时钟应用中多时区时间展示
- 计时器/秒表界面中的时间流逝展示
- 卡片（Widget）中分钟级时间显示

## 3. 状态声明

```typescript
// 累计时间戳（秒级 Unix 时间戳，由 onDateChange 回调更新）
@State accumulateTime: number = 0

// 时钟运行状态
@State isRunning: boolean = true

// 时区偏移量（东八区 = -8）
@State timeZoneOffset: number = -8

// 时间格式
@State timeFormat: string = 'HH:mm:ss'
```

装饰器选择：
- `@State`：页面内部状态
- `@Prop`：父组件单向传入（如多时钟列表中每个时钟项）
- `@Link`：父子双向同步

## 4. 事件与交互逻辑

### onDateChange(callback: (value: number) => void)

唯一核心事件，每秒（非卡片场景）触发一次。事件内应包含的逻辑：

```typescript
TextClock({ timeZoneOffset: this.timeZoneOffset, controller: this.clockController })
  .format(this.timeFormat)
  .onDateChange((value: number): void => {
    // 1. 更新时间戳（必须）
    this.accumulateTime = value

    // 2. 联动逻辑（按需）——如整点提醒
    let date: Date = new Date(value * 1000)
    if (date.getMinutes() === 0 && date.getSeconds() === 0) {
      this.onHourlyAlert()
    }
  })
```

### TextClockController 控制器

```typescript
controller: TextClockController = new TextClockController()

// 启动时钟
this.controller.start()

// 停止时钟
this.controller.stop()
```

## 5. 数据结构

```typescript
// 世界时钟数据模型
interface WorldClockItem {
  city: string            // 城市名
  timeZoneOffset: number  // 时区偏移量，如东八区为 -8
  label: string           // 显示标签
}
```

## 6. 联动说明

- TextClock 启动/停止 → 通过 TextClockController 的 start()/stop() 控制
- 时区切换 → 修改 @State timeZoneOffset 自动重新渲染
- 组件不可见时自动停止回调，可见时自动恢复
- onDateChange 回调 → 联动更新其他显示内容（如"当前毫秒数"文本）

## 7. 完整代码示例

```typescript
interface WorldClockItem {
  city: string
  timeZoneOffset: number
  label: string
}

@Entry
@Component
struct WorldClockPage {
  @State accumulateTime: number = 0
  @State isRunning: boolean = true
  controller: TextClockController = new TextClockController()

  private clocks: WorldClockItem[] = [
    { city: '北京', timeZoneOffset: -8, label: 'UTC+8' },
    { city: '东京', timeZoneOffset: -9, label: 'UTC+9' },
    { city: '伦敦', timeZoneOffset: 0, label: 'UTC+0' }
  ]

  build() {
    Column({ space: 16 }) {
      Text('当前时间戳: ' + this.accumulateTime)
        .fontSize(16)
        .fontColor('#99182431')

      ForEach(this.clocks, (item: WorldClockItem): void => {
        Row() {
          Text(item.city + ' (' + item.label + ')')
            .fontSize(16)
            .width('40%')
          TextClock({ timeZoneOffset: item.timeZoneOffset, controller: this.controller })
            .format('HH:mm:ss')
            .fontSize(24)
            .fontWeight(FontWeight.Medium)
            .onDateChange((value: number): void => {
              this.accumulateTime = value
            })
        }
        .width('100%')
        .justifyContent(FlexAlign.SpaceBetween)
        .padding({ left: 16, right: 16 })
      })

      Row({ space: 16 }) {
        Button(this.isRunning ? '停止' : '启动')
          .onClick((): void => {
            if (this.isRunning) {
              this.controller.stop()
            } else {
              this.controller.start()
            }
            this.isRunning = !this.isRunning
          })
      }
      .margin({ top: 24 })
    }
    .width('100%')
    .height('100%')
    .padding(24)
  }
}
```

## 8. 反面示例

```typescript
// ❌ 没有绑定 controller，无法控制启停
TextClock()

// ❌ format 设了无效字母，显示会回退到系统默认格式
TextClock().format('ABCDEF')

// ❌ timeZoneOffset 超出范围 [-14, 12]，会使用系统当前时区
TextClock({ timeZoneOffset: 20 })

// ❌ 在卡片中使用秒级格式，卡片最小单位为分钟，秒会被忽略
// 卡片中应使用 'HH:mm' 而非 'HH:mm:ss'
TextClock().format('HH:mm:ss')

// ❌ onDateChange 中没有更新 @State，UI 不会刷新
let time = 0
TextClock().onDateChange((value: number) => { time = value })
```

## 9. API 速查

| API | 说明 |
|-----|------|
| `TextClock({ timeZoneOffset?: number, controller?: TextClockController })` | 创建文本时钟，timeZoneOffset 设置时区偏移 |
| `.format(value: string)` | 设置时间显示格式，如 'HH:mm:ss'、'aa hh:mm:ss' |
| `.onDateChange((value: number) => void)` | 时间变化回调，参数为 Unix 时间戳（秒） |
| `.fontColor(color)` | 设置字体颜色 |
| `.fontSize(size)` | 设置字体大小 |
| `.fontWeight(weight)` | 设置字体粗细 |
| `.fontStyle(style)` | 设置字体样式（Normal / Italic） |
| `.fontFamily(family)` | 设置字体列表 |
| `.textShadow(shadow)` | 设置文字阴影效果（API 11+） |
| `.fontFeature(feature)` | 设置文字特性，如等宽数字 `"ss01" on`（API 11+） |
| `.dateTimeOptions({ hour: '2-digit' \| 'numeric' })` | 设置小时是否显示前导 0（API 12+） |
| `TextClockController.start()` | 启动文本时钟 |
| `TextClockController.stop()` | 停止文本时钟 |
