# Button 组件功能逻辑规格

## 1. 功能定位

Button 是按钮组件，用于响应用户的点击操作并触发相应业务逻辑。当界面需要用户主动执行一个动作（提交、跳转、确认、取消）时使用。

## 2. 典型场景

- 表单提交按钮（登录、注册、保存）
- 页面导航跳转
- 操作确认/取消（对话框）
- 底部固定操作栏（购买、下一步）
- 悬浮操作按钮（新建、添加）

## 3. 状态声明

```typescript
// 提交按钮
@State isLoading: boolean = false
@State isDisabled: boolean = false

// 表单场景（按钮状态依赖表单校验）
@State formValid: boolean = false

// 操作结果反馈
@State submitResult: string = 'idle'  // 'idle' | 'success' | 'error'
```

## 4. 事件与交互逻辑

### onClick 核心事件

按钮只有一个核心事件 `onClick`，但内部逻辑需要根据场景补全：

### 场景一：表单提交

```typescript
Button('提交')
  .enabled(!this.isLoading && this.formValid)
  .onClick(async (): Promise<void> => {
    if (this.isLoading) return  // 防重复点击
    this.isLoading = true
    try {
      await this.submitForm()
      this.submitResult = 'success'
    } catch (e) {
      this.submitResult = 'error'
    } finally {
      this.isLoading = false
    }
  })
```

### 场景二：路由跳转

```typescript
Button('查看详情')
  .onClick((): void => {
    router.pushUrl({
      url: 'pages/DetailPage',
      params: { id: this.itemId }
    })
  })
```

### 场景三：确认对话框

```typescript
Button('删除')
  .fontColor(Color.Red)
  .onClick((): void => {
    AlertDialog.show({
      title: '确认删除',
      message: '删除后不可恢复，确定继续？',
      primaryButton: {
        value: '取消',
        action: (): void => {}
      },
      secondaryButton: {
        value: '删除',
        fontColor: Color.Red,
        action: (): void => {
          this.deleteItem()
        }
      }
    })
  })
```

## 5. 数据结构

```typescript
// 按钮配置（动态按钮场景）
interface ButtonConfig {
  label: string
  type: ButtonType       // Capsule | Circle | Normal | ROUNDED_RECTANGLE
  styleMode?: ButtonStyleMode  // EMPHASIZED | NORMAL | TEXTUAL
  controlSize?: ControlSize    // SMALL | NORMAL
  role?: ButtonRole            // NORMAL | ERROR
  action: () => void
  disabled?: boolean
  loading?: boolean
}

// 底部操作栏按钮组
interface ActionBarConfig {
  primaryButton: ButtonConfig
  secondaryButton?: ButtonConfig
}
```

## 6. 联动说明

- 表单字段校验全部通过 → Button 从置灰变为可点击
- Button 点击提交 → 进入 loading 态 → 完成后恢复/跳转
- 协议 Checkbox 勾选 → 提交 Button 解锁
- 列表选中项 > 0 → 底部批量操作 Button 出现
- Button 触发删除 → 弹出确认对话框 → 确认后执行

## 7. 完整代码示例

```typescript
import { router } from '@kit.ArkUI'

@Entry
@Component
struct LoginPage {
  @State username: string = ''
  @State password: string = ''
  @State isLoading: boolean = false
  @State errorMsg: string = ''

  canSubmit(): boolean {
    return this.username.length >= 3 && this.password.length >= 6
  }

  async doLogin(): Promise<void> {
    this.isLoading = true
    this.errorMsg = ''
    try {
      // 模拟登录请求
      const success = this.username === 'admin' && this.password === '123456'
      if (success) {
        router.replaceUrl({ url: 'pages/HomePage' })
      } else {
        this.errorMsg = '用户名或密码错误'
      }
    } catch (e) {
      this.errorMsg = '网络异常，请重试'
    } finally {
      this.isLoading = false
    }
  }

  build() {
    Column({ space: 16 }) {
      Text('登录')
        .fontSize(28)
        .fontWeight(FontWeight.Bold)

      TextInput({ placeholder: '用户名（至少3位）', text: this.username })
        .onChange((value: string): void => {
          this.username = value
          this.errorMsg = ''
        })

      TextInput({ placeholder: '密码（至少6位）', text: this.password })
        .type(InputType.Password)
        .onChange((value: string): void => {
          this.password = value
          this.errorMsg = ''
        })
        .onSubmit((): void => {
          if (this.canSubmit()) this.doLogin()
        })

      // 错误提示
      if (this.errorMsg) {
        Text(this.errorMsg)
          .fontColor(Color.Red)
          .fontSize(14)
      }

      // 登录按钮
      Button(this.isLoading ? '登录中...' : '登录', { type: ButtonType.Capsule })
        .width('100%')
        .height(48)
        .enabled(this.canSubmit() && !this.isLoading)
        .onClick((): void => {
          this.doLogin()
        })

      // 辅助操作
      Row() {
        Text('忘记密码')
          .fontColor('#0A59F7')
          .onClick((): void => {
            router.pushUrl({ url: 'pages/ResetPassword' })
          })
        Blank()
        Text('注册账号')
          .fontColor('#0A59F7')
          .onClick((): void => {
            router.pushUrl({ url: 'pages/Register' })
          })
      }
      .width('100%')
    }
    .width('100%')
    .padding(24)
  }
}
```

## 8. 反面示例

```typescript
// ❌ 按钮没有 onClick，点了没反应
Button('提交')

// ❌ 没有防重复点击，用户连点会多次提交
Button('提交')
  .onClick(() => {
    this.submit()  // 每次点击都会触发
  })

// ❌ 没有 loading 状态反馈，用户不知道是否在处理
Button('保存')
  .onClick(async () => {
    await this.save()  // 可能要几秒，但按钮没有任何变化
  })

// ❌ 表单没校验就能提交
Button('注册')
  .onClick(() => {
    this.register()  // username/password 可能是空的
  })

// ❌ 危险操作没有二次确认
Button('删除全部')
  .onClick(() => {
    this.deleteAll()  // 直接删除，没有确认对话框
  })
```

## 9. API 速查

| API | 说明 |
|-----|------|
| `Button(label, options?)` | 创建文本按钮 |
| `Button()` / `Button(options?)` + 子组件 | 创建自定义内容按钮 |
| `ButtonType.ROUNDED_RECTANGLE` | 圆角矩形（API 15+，**API 18 起为默认值**） |
| `ButtonType.Capsule` | 胶囊型（API 18 前的默认值） |
| `ButtonType.Circle` | 圆形按钮 |
| `ButtonType.Normal` | 普通按钮（无圆角） |
| `.buttonStyle(ButtonStyleMode)` | 按钮重要程度：EMPHASIZED（强调）/ NORMAL（普通）/ TEXTUAL（文字）（API 11+） |
| `.controlSize(ControlSize)` | 按钮尺寸：SMALL / NORMAL（API 11+） |
| `.role(ButtonRole)` | 按钮角色：NORMAL / ERROR（警示红色）（API 12+） |
| `.labelStyle(LabelStyle)` | label 文本样式（overflow/maxLines/minFontSize 等）（API 10+） |
| `.stateEffect(boolean)` | 按压态效果，默认 true |
| `.enabled(boolean)` | 是否可点击 |
| `.onClick(() => void)` | 点击事件 |

> **注意**：API 18 起 ButtonType 默认值从 Capsule 变为 ROUNDED_RECTANGLE。使用 `ButtonStyleMode` 代替手动设置背景色/文字色，系统会自动适配深浅色模式。
