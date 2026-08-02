# Toggle 组件功能逻辑规格

## 1. 功能定位

Toggle 是双态切换组件，用于在开/关两种状态之间切换。当界面需要用户启用或禁用某项功能时使用。

## 2. 典型场景

- 设置页中的 Wi-Fi/蓝牙/通知等开关
- 表单中的"是否同意协议"
- 列表项右侧的启用/禁用控制
- 功能模块的总开关（如免打扰模式）

## 3. 状态声明

```typescript
// 单个开关
@State isEnabled: boolean = false

// 多个开关（设置列表场景）
@State settingItems: SettingItem[] = [
  { label: 'Wi-Fi', key: 'wifi', isOn: false },
  { label: '蓝牙', key: 'bluetooth', isOn: false },
  { label: '飞行模式', key: 'airplane', isOn: false }
]
```

装饰器选择：
- `@State`：页面内部状态
- `@Prop`：父组件单向传入（如列表中每个开关项）
- `@Link`：父子双向同步
- `$$`：API 10+ 支持双向绑定语法 `Toggle({ type: ToggleType.Switch, isOn: $$this.isEnabled })`

## 4. 事件与交互逻辑

### onChange(callback: (isOn: boolean) => void)

唯一核心事件，切换状态时触发。事件内应包含的逻辑：

```typescript
Toggle({ type: ToggleType.Switch, isOn: this.isWifiOn })
  .onChange((isOn: boolean): void => {
    // 1. 更新状态（必须）
    this.isWifiOn = isOn

    // 2. 持久化存储（按需）
    PersistentStorage.persistProp<boolean>('wifiEnabled', isOn)

    // 3. 联动逻辑（按需）
    if (isOn) {
      this.startWifiScan()
    } else {
      this.wifiList = []
    }

    // 4. 上报/通知（按需）
    this.reportSettingChange('wifi', isOn)
  })
```

## 5. 数据结构

```typescript
// 设置项数据模型
interface SettingItem {
  label: string        // 显示文本
  key: string          // 持久化存储键名
  isOn: boolean        // 开关状态
  icon?: Resource      // 图标（可选）
  subtitle?: string    // 副标题（可选）
  disabled?: boolean   // 是否禁用（可选）
}
```

## 6. 联动说明

- Toggle 开启 → 展开下方子设置列表（如 Wi-Fi 开 → 显示网络列表）
- Toggle 关闭 → 隐藏子项并重置相关状态
- 多个 Toggle 互斥关系（如飞行模式开 → Wi-Fi/蓝牙自动关）
- Toggle 变化 → 触发父组件回调（通过 @Link 或事件通知）

## 7. 完整代码示例

```typescript
interface SettingItem {
  label: string
  key: string
  isOn: boolean
}

@Entry
@Component
struct SettingsPage {
  @State isWifiOn: boolean = false
  @State isBluetoothOn: boolean = false
  @State isAirplaneOn: boolean = false
  @State wifiList: string[] = []

  build() {
    Column() {
      // 飞行模式（互斥开关）
      Row() {
        Text('飞行模式')
        Blank()
        Toggle({ type: ToggleType.Switch, isOn: this.isAirplaneOn })
          .onChange((isOn: boolean): void => {
            this.isAirplaneOn = isOn
            if (isOn) {
              this.isWifiOn = false
              this.isBluetoothOn = false
              this.wifiList = []
            }
          })
      }
      .width('100%')
      .justifyContent(FlexAlign.SpaceBetween)
      .padding(16)

      // Wi-Fi 开关（带联动）
      Row() {
        Text('Wi-Fi')
        Blank()
        Toggle({ type: ToggleType.Switch, isOn: this.isWifiOn })
          .enabled(!this.isAirplaneOn)
          .onChange((isOn: boolean): void => {
            this.isWifiOn = isOn
            if (isOn) {
              this.wifiList = ['HomeNetwork', 'Office-5G', 'Guest']
            } else {
              this.wifiList = []
            }
          })
      }
      .width('100%')
      .justifyContent(FlexAlign.SpaceBetween)
      .padding(16)

      // Wi-Fi 列表（联动展示）
      if (this.isWifiOn && this.wifiList.length > 0) {
        ForEach(this.wifiList, (name: string): void => {
          Row() {
            Text(name)
              .padding({ left: 32 })
          }
          .width('100%')
          .padding(12)
        })
      }

      // 蓝牙开关
      Row() {
        Text('蓝牙')
        Blank()
        Toggle({ type: ToggleType.Switch, isOn: this.isBluetoothOn })
          .enabled(!this.isAirplaneOn)
          .onChange((isOn: boolean): void => {
            this.isBluetoothOn = isOn
          })
      }
      .width('100%')
      .justifyContent(FlexAlign.SpaceBetween)
      .padding(16)
    }
  }
}
```

## 8. 反面示例

```typescript
// ❌ isOn 写死 true，状态永远不会变
Toggle({ type: ToggleType.Switch, isOn: true })

// ❌ 没有声明 @State，onChange 里赋值不会触发 UI 更新
let isOn = false
Toggle({ type: ToggleType.Switch, isOn: isOn })
  .onChange((val: boolean) => { isOn = val })

// ❌ 有 @State 但没绑定 onChange，用户点了没反应
@State isOn: boolean = false
Toggle({ type: ToggleType.Switch, isOn: this.isOn })

// ❌ 有互斥关系的开关没处理联动
// 飞行模式开了但 Wi-Fi 还是开着的
```

## 9. API 速查

| API | 说明 |
|-----|------|
| `Toggle({ type: ToggleType.Switch, isOn?: boolean })` | 创建开关样式，isOn 支持 $$ 双向绑定 |
| `Toggle({ type: ToggleType.Checkbox, isOn?: boolean })` | 创建勾选样式 |
| `Toggle({ type: ToggleType.Button, isOn?: boolean })` | 创建按钮样式（可含子组件） |
| `.onChange((isOn: boolean) => void)` | 状态变化回调 |
| `.selectedColor(color)` | 选中态背景色 |
| `.switchPointColor(color)` | 滑块颜色（仅 Switch） |
| `.switchStyle(SwitchStyle)` | 自定义 Switch 样式（API 12+），可设置 pointRadius / unselectedColor / pointColor / trackBorderRadius |
| `.enabled(boolean)` | 是否可交互 |
