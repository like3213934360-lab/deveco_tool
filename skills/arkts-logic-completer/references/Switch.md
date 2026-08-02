# Switch 开关组件功能逻辑规格

## 1. 功能定位

Switch 是 Toggle 组件的开关样式（ToggleType.Switch），用于在开/关两种状态间切换，是设置页面最常用的交互控件。

## 2. 典型场景

- 设置页中的 Wi-Fi / 蓝牙 / 通知等开关
- 隐私设置中的权限开关
- 表单中的"是否同意协议"
- 功能总开关（如免打扰模式、深色模式）

## 3. 状态声明

```typescript
// 单个开关
@State isEnabled: boolean = false

// 多开关列表
@State settingItems: SwitchSettingItem[] = [
  { label: 'Wi-Fi', key: 'wifi', isOn: false },
  { label: '蓝牙', key: 'bluetooth', isOn: false },
  { label: '飞行模式', key: 'airplane', isOn: false }
]
```

装饰器选择：
- `@State`：页面内部开关状态
- `@Prop`：父组件单向传入
- `@Link`：父子双向同步
- `$$`：API 10+ 双向绑定语法 `Toggle({ type: ToggleType.Switch, isOn: $$this.isEnabled })`

## 4. 事件与交互逻辑

### onChange 状态切换

```typescript
Toggle({ type: ToggleType.Switch, isOn: this.isWifiOn })
  .onChange((isOn: boolean): void => {
    this.isWifiOn = isOn

    if (isOn) {
      this.startWifiScan()
    } else {
      this.wifiList = []
    }
  })
```

### 互斥开关联动

```typescript
Toggle({ type: ToggleType.Switch, isOn: this.isAirplaneOn })
  .onChange((isOn: boolean): void => {
    this.isAirplaneOn = isOn
    if (isOn) {
      this.isWifiOn = false
      this.isBluetoothOn = false
    }
  })
```

## 5. 数据结构

```typescript
interface SwitchSettingItem {
  label: string
  key: string
  isOn: boolean
  icon?: Resource
  subtitle?: string
  disabled?: boolean
}
```

## 6. 联动说明

- Switch 开启 → 展开下方子设置列表（如 Wi-Fi 开 → 显示网络列表）
- Switch 关闭 → 隐藏子项并重置相关状态
- 多个 Switch 互斥（飞行模式开 → Wi-Fi/蓝牙自动关）
- Switch 变化 → 持久化存储 + 通知父组件

## 7. 完整代码示例

```typescript
interface SwitchSettingItem {
  label: string
  key: string
  isOn: boolean
}

@Entry
@Component
struct SwitchDemo {
  @State isDarkMode: boolean = false
  @State isNotification: boolean = true
  @State isAirplane: boolean = false
  @State isWifi: boolean = true
  @State isBluetooth: boolean = false
  @State wifiNetworks: string[] = ['HomeNetwork', 'Office-5G']

  build() {
    Column() {
      Text('设置').fontSize(24).fontWeight(FontWeight.Bold).padding(16)

      this.buildSwitchRow('飞行模式', this.isAirplane, (isOn: boolean): void => {
        this.isAirplane = isOn
        if (isOn) {
          this.isWifi = false
          this.isBluetooth = false
          this.wifiNetworks = []
        }
      })

      this.buildSwitchRow('Wi-Fi', this.isWifi, (isOn: boolean): void => {
        this.isWifi = isOn
        if (isOn) {
          this.wifiNetworks = ['HomeNetwork', 'Office-5G', 'Guest']
        } else {
          this.wifiNetworks = []
        }
      }, !this.isAirplane)

      if (this.isWifi && this.wifiNetworks.length > 0) {
        ForEach(this.wifiNetworks, (name: string) => {
          Row() {
            Text(name).padding({ left: 48 }).fontColor('#666666')
          }
          .width('100%')
          .padding({ top: 8, bottom: 8 })
        })
      }

      this.buildSwitchRow('蓝牙', this.isBluetooth, (isOn: boolean): void => {
        this.isBluetooth = isOn
      }, !this.isAirplane)

      Divider().margin({ top: 8, bottom: 8 })

      this.buildSwitchRow('通知', this.isNotification, (isOn: boolean): void => {
        this.isNotification = isOn
      })

      this.buildSwitchRow('深色模式', this.isDarkMode, (isOn: boolean): void => {
        this.isDarkMode = isOn
      })
    }
    .width('100%')
    .height('100%')
  }

  @Builder
  buildSwitchRow(label: string, isOn: boolean, handler: (isOn: boolean) => void, enabled: boolean = true) {
    Row() {
      Text(label).fontSize(16)
      Blank()
      Toggle({ type: ToggleType.Switch, isOn: isOn })
        .enabled(enabled)
        .onChange((value: boolean): void => {
          handler(value)
        })
    }
    .width('100%')
    .padding({ left: 16, right: 16, top: 12, bottom: 12 })
    .opacity(enabled ? 1.0 : 0.4)
  }
}
```

## 8. 反面示例

```typescript
// ❌ isOn 写死 true，点击切换无效果
Toggle({ type: ToggleType.Switch, isOn: true })

// ❌ 没有声明 @State，onChange 赋值不会触发 UI 更新
let isOn = false
Toggle({ type: ToggleType.Switch, isOn: isOn })
  .onChange((val: boolean): void => { isOn = val })

// ❌ 有 @State 但没绑定 onChange，用户点了没反应
@State isOn: boolean = false
Toggle({ type: ToggleType.Switch, isOn: this.isOn })

// ❌ 有互斥关系的开关没处理联动
// 飞行模式开启但 Wi-Fi 还是开着
Toggle({ type: ToggleType.Switch, isOn: this.isAirplane })
  .onChange((isOn: boolean): void => {
    this.isAirplane = isOn
    // 缺少: this.isWifi = false; this.isBluetooth = false
  })
```

## 9. API 速查

| API | 说明 |
|-----|------|
| `Toggle({ type: ToggleType.Switch, isOn?: boolean })` | 创建开关样式，isOn 支持 $$ 双向绑定 |
| `.onChange((isOn: boolean) => void)` | 状态变化回调 |
| `.selectedColor(color)` | 选中态（开启）背景色 |
| `.switchPointColor(color)` | 圆形滑块颜色 |
| `.switchStyle(SwitchStyle)` | 自定义样式（API 12+）：pointRadius / unselectedColor / pointColor / trackBorderRadius |
| `.enabled(boolean)` | 是否可交互 |
| `ToggleType.Switch` | 开关样式 |
| `ToggleType.Checkbox` | 勾选框样式 |
| `ToggleType.Button` | 状态按钮样式 |
| `.contentModifier(modifier)` | 自定义内容区（API 12+） |
