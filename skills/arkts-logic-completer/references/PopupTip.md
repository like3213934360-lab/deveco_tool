# PopupTip 气泡提示功能逻辑规格

## 1. 功能定位

PopupTip 是气泡提示组件，包含通用属性 bindPopup（基础/自定义气泡）和高级组件 Popup（结构化气泡），用于在目标组件附近弹出提示信息或交互内容。当需要对某个组件进行轻量级说明、操作引导或上下文信息展示时使用。

## 2. 典型场景

- 功能引导气泡（首次使用时指向按钮说明功能）
- 表单字段校验提示（输入框旁弹出错误说明）
- 信息补充说明（图标旁弹出详细解释）
- 操作确认气泡（小型确认操作，比 Dialog 更轻量）
- 带图标和按钮的结构化气泡（高级 Popup 组件）

## 3. 状态声明

```typescript
// 基础气泡
@State showPopup: boolean = false

// 自定义气泡
@State showCustomPopup: boolean = false

// 引导气泡（多步骤）
@State guideStep: number = 0  // 0: 不显示, 1: 步骤1, 2: 步骤2 ...
@State showGuide1: boolean = false
@State showGuide2: boolean = false
```

## 4. 事件与交互逻辑

### 场景一：基础文本气泡（PopupOptions）

```typescript
@State showTip: boolean = false

Button('帮助')
  .onClick((): void => {
    this.showTip = !this.showTip
  })
  .bindPopup(this.showTip, {
    message: '点击此按钮可获取帮助信息',
    placement: Placement.Bottom,
    enableArrow: true,
    onStateChange: (e: { isVisible: boolean }): void => {
      if (!e.isVisible) {
        this.showTip = false
      }
    }
  })
```

### 场景二：带按钮的基础气泡

```typescript
@State showConfirmPopup: boolean = false

Button('提交')
  .onClick((): void => {
    this.showConfirmPopup = true
  })
  .bindPopup(this.showConfirmPopup, {
    message: '确定要提交此表单吗？',
    primaryButton: {
      value: '确定',
      action: (): void => {
        this.showConfirmPopup = false
        this.doSubmit()
      }
    },
    secondaryButton: {
      value: '取消',
      action: (): void => {
        this.showConfirmPopup = false
      }
    },
    onStateChange: (e: { isVisible: boolean }): void => {
      if (!e.isVisible) {
        this.showConfirmPopup = false
      }
    }
  })
```

### 场景三：自定义内容气泡（CustomPopupOptions）

```typescript
@State showDetailPopup: boolean = false

@Builder
buildDetailPopup(): void {
  Column({ space: 8 }) {
    Text('订单详情').fontSize(16).fontWeight(FontWeight.Bold)
    Text('订单号：2025031500001').fontSize(14)
    Text('金额：¥128.00').fontSize(14)
    Button('查看更多')
      .onClick((): void => {
        this.showDetailPopup = false
        this.navigateToDetail()
      })
  }.padding(12)
}

Text('订单信息')
  .onClick((): void => {
    this.showDetailPopup = !this.showDetailPopup
  })
  .bindPopup(this.showDetailPopup, {
    builder: this.buildDetailPopup,
    placement: Placement.Bottom,
    popupColor: Color.White,
    enableArrow: true,
    onStateChange: (e: { isVisible: boolean }): void => {
      if (!e.isVisible) {
        this.showDetailPopup = false
      }
    }
  })
```

### 场景四：高级 Popup 组件（结构化气泡）

```typescript
import { Popup, PopupTextOptions, PopupButtonOptions, PopupIconOptions } from '@kit.ArkUI'

@State showAdvancedPopup: boolean = false

Button('通知')
  .onClick((): void => {
    this.showAdvancedPopup = !this.showAdvancedPopup
  })
  .bindPopup(this.showAdvancedPopup, {
    builder: (): void => { this.buildAdvancedPopup() },
    placement: Placement.Bottom,
    onStateChange: (e: { isVisible: boolean }): void => {
      if (!e.isVisible) {
        this.showAdvancedPopup = false
      }
    }
  })

@Builder
buildAdvancedPopup(): void {
  Popup({
    icon: {
      image: $r('app.media.icon'),
      width: 32,
      height: 32
    } as PopupIconOptions,
    title: {
      text: '新版本可用',
      fontSize: 18,
      fontWeight: FontWeight.Bold
    } as PopupTextOptions,
    message: {
      text: '发现新版本 v2.0，建议立即更新以获得最佳体验。',
      fontSize: 14
    } as PopupTextOptions,
    showClose: true,
    onClose: (): void => {
      this.showAdvancedPopup = false
    },
    buttons: [
      { text: '稍后', action: (): void => { this.showAdvancedPopup = false } },
      { text: '更新', action: (): void => { this.doUpdate() } }
    ] as [PopupButtonOptions?, PopupButtonOptions?]
  })
}
```

## 5. 数据结构

```typescript
interface PopupConfig {
  message: string
  placement: Placement
  enableArrow: boolean
  autoCancel: boolean
  primaryButton?: PopupButtonConfig
  secondaryButton?: PopupButtonConfig
}

interface PopupButtonConfig {
  value: string
  action: () => void
}

interface CustomPopupConfig {
  builder: () => void
  placement: Placement
  popupColor?: ResourceColor
  enableArrow?: boolean
  focusable?: boolean
  mask?: boolean
}

interface AdvancedPopupConfig {
  icon?: PopupIconOptions
  title?: PopupTextOptions
  message: PopupTextOptions
  showClose?: boolean
  onClose?: () => void
  buttons?: [PopupButtonOptions?, PopupButtonOptions?]
}
```

## 6. 联动说明

- 输入框 onBlur → 校验失败 → showPopup = true → 气泡显示错误提示
- 用户点击其他区域 → autoCancel 触发 → onStateChange 回调 → showPopup = false
- 引导步骤 1 完成 → 关闭气泡 1 → 显示气泡 2 → 指向下一个功能
- 组件销毁 → 气泡自动消失（不触发 onStateChange）
- Popup 中按钮点击 → 执行操作 → 手动设置 show = false 关闭气泡

## 7. 完整代码示例

```typescript
import { Popup, PopupTextOptions, PopupButtonOptions, PopupIconOptions } from '@kit.ArkUI'

@Entry
@Component
struct PopupTipDemoPage {
  @State showHelpPopup: boolean = false
  @State showErrorPopup: boolean = false
  @State showInfoPopup: boolean = false
  @State username: string = ''
  @State errorMsg: string = ''

  validateUsername(): boolean {
    if (this.username.length < 3) {
      this.errorMsg = '用户名至少3个字符'
      return false
    }
    this.errorMsg = ''
    return true
  }

  @Builder
  buildErrorPopup(): void {
    Row({ space: 4 }) {
      Text('⚠').fontSize(16)
      Text(this.errorMsg).fontSize(14).fontColor('#FF4444')
    }.padding(8)
  }

  @Builder
  buildInfoPopup(): void {
    Popup({
      icon: {
        image: $r('app.media.icon'),
        width: 24,
        height: 24
      } as PopupIconOptions,
      title: {
        text: '使用提示',
        fontSize: 16,
        fontWeight: FontWeight.Bold
      } as PopupTextOptions,
      message: {
        text: '输入您的用户名即可登录，支持字母、数字和下划线。',
        fontSize: 14
      } as PopupTextOptions,
      showClose: true,
      onClose: (): void => {
        this.showInfoPopup = false
      }
    })
  }

  build() {
    Column({ space: 20 }) {
      Text('气泡提示示例')
        .fontSize(24)
        .fontWeight(FontWeight.Bold)

      // 帮助按钮 + 基础气泡
      Row({ space: 8 }) {
        Text('用户名').fontSize(16)
        Text('?')
          .fontSize(14)
          .fontColor('#0A59F7')
          .onClick((): void => {
            this.showInfoPopup = !this.showInfoPopup
          })
          .bindPopup(this.showInfoPopup, {
            builder: (): void => { this.buildInfoPopup() },
            placement: Placement.Bottom,
            popupColor: Color.White,
            enableArrow: true,
            onStateChange: (e: { isVisible: boolean }): void => {
              if (!e.isVisible) {
                this.showInfoPopup = false
              }
            }
          })
      }

      // 输入框 + 错误提示气泡
      TextInput({ placeholder: '请输入用户名', text: this.username })
        .onChange((value: string): void => {
          this.username = value
          if (this.showErrorPopup) {
            this.showErrorPopup = false
          }
        })
        .onBlur((): void => {
          if (!this.validateUsername()) {
            this.showErrorPopup = true
          }
        })
        .bindPopup(this.showErrorPopup, {
          builder: this.buildErrorPopup,
          placement: Placement.Bottom,
          popupColor: '#FFF0F0',
          enableArrow: true,
          onStateChange: (e: { isVisible: boolean }): void => {
            if (!e.isVisible) {
              this.showErrorPopup = false
            }
          }
        })

      // 帮助气泡
      Button('帮助说明')
        .onClick((): void => {
          this.showHelpPopup = !this.showHelpPopup
        })
        .bindPopup(this.showHelpPopup, {
          message: '如有问题请联系客服：400-000-0000',
          placement: Placement.Top,
          primaryButton: {
            value: '知道了',
            action: (): void => {
              this.showHelpPopup = false
            }
          },
          onStateChange: (e: { isVisible: boolean }): void => {
            if (!e.isVisible) {
              this.showHelpPopup = false
            }
          }
        })
    }
    .width('100%')
    .padding(24)
  }
}
```

## 8. 反面示例

```typescript
// ❌ 在页面构建时 show 设为 true，气泡位置和形状会异常
@State showPopup: boolean = true  // 不能在构建时就为 true

// ❌ 没有在 onStateChange 中同步状态，导致状态不一致
Button('tip')
  .bindPopup(this.showPopup, {
    message: 'hello'
    // 缺少 onStateChange，用户点击空白区关闭后 showPopup 仍为 true
    // 下次点击按钮 showPopup 取反为 false，气泡不弹出
  })

// ❌ CustomPopupOptions 的 builder 中直接使用 position 属性
// builder 下第一层容器不支持 position
.bindPopup(this.show, {
  builder: (): void => {
    Column().position({ x: 100, y: 100 })  // 会导致气泡不显示
  }
})

// ❌ showInSubWindow 为 true 的气泡中再弹出子窗气泡
// 子窗弹窗里不能再弹出子窗弹窗

// ❌ 高级 Popup 组件没有配合 bindPopup 使用
// Popup 组件需要通过 bindPopup 的 builder 嵌入才能正确弹出
build() {
  Popup({ message: { text: 'test' } })  // 直接使用不会弹出
}
```

## 9. API 速查

| API | 说明 |
|-----|------|
| `.bindPopup(show, PopupOptions)` | 绑定基础文本气泡 |
| `.bindPopup(show, CustomPopupOptions)` | 绑定自定义内容气泡 |
| `PopupOptions.message` | 气泡文本内容 |
| `PopupOptions.primaryButton / secondaryButton` | 气泡按钮 |
| `PopupOptions.placement` | 显示位置（API 10+），默认 Placement.Bottom |
| `PopupOptions.enableArrow` | 是否显示箭头，默认 true（API 10+） |
| `PopupOptions.popupColor` | 气泡颜色（API 11+） |
| `PopupOptions.autoCancel` | 操作时是否自动关闭，默认 true（API 11+） |
| `PopupOptions.mask` | 是否显示遮罩层（API 10+） |
| `PopupOptions.targetSpace` | 气泡与宿主间距，默认 8vp（API 10+） |
| `PopupOptions.onWillDismiss` | 关闭拦截回调（API 12+） |
| `CustomPopupOptions.builder` | 自定义气泡内容 Builder |
| `CustomPopupOptions.focusable` | 气泡是否获焦（API 11+） |
| `Popup({ icon?, title?, message, showClose?, buttons? })` | 高级结构化气泡组件（API 11+） |
| `PopupIconOptions` | 图标配置：image, width, height |
| `PopupTextOptions` | 文本配置：text, fontSize, fontColor, fontWeight |
| `PopupButtonOptions` | 按钮配置：text, action, fontSize, fontColor |
| `onStateChange` | 气泡显隐状态回调 |
| `Placement` | 位置枚举：Top / Bottom / Left / Right 等 |

> **注意**：bindPopup 的 show 不能在页面构建时设为 true。必须在 onStateChange 中同步状态变量。高级 Popup 组件需从 `@kit.ArkUI` 导入，配合 bindPopup 的 builder 使用。
