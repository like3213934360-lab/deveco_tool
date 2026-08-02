# PatternLock 组件功能逻辑规格

## 1. 功能定位

PatternLock 是图案密码锁组件，以九宫格图案方式输入密码用于密码验证。当界面需要用户通过绘制手势图案进行身份验证或设置密码时使用。

## 2. 典型场景

- 应用锁屏/解锁的图案密码验证
- 设置新图案密码（两次输入确认）
- 隐私空间/加密文件夹的访问验证
- 支付前的身份二次确认

## 3. 状态声明

```typescript
// 用户提示消息
@State message: string = '请绘制图案密码'

// 第一次输入的密码（用于两次确认场景）
@State firstPassword: number[] = []

// 密码输入失败次数
@State failCount: number = 0

// 是否锁定（失败超过次数限制）
@State isLocked: boolean = false
```

装饰器选择：
- `@State`：页面内部状态（提示信息、密码存储、失败计数）
- `@Prop`：父组件单向传入预设密码
- `@Link`：父子双向同步解锁状态

## 4. 事件与交互逻辑

### onPatternComplete(callback: (input: Array<number>) => void)

密码输入完成时触发，input 为选中圆点的索引数组（0-8）：

```typescript
PatternLock(this.patternLockController)
  .onPatternComplete((input: Array<number>): void => {
    // 1. 长度校验
    if (input.length < 4) {
      this.message = '至少连接4个点，请重试'
      return
    }

    // 2. 首次输入——保存密码
    if (this.firstPassword.length === 0) {
      this.firstPassword = input
      this.message = '请再次绘制以确认'
      this.patternLockController.reset()
      return
    }

    // 3. 二次输入——比对密码
    if (this.firstPassword.toString() === input.toString()) {
      this.message = '密码设置成功'
      this.patternLockController.setChallengeResult(PatternLockChallengeResult.CORRECT)
    } else {
      this.message = '两次输入不一致，请重新开始'
      this.patternLockController.setChallengeResult(PatternLockChallengeResult.WRONG)
      this.firstPassword = []
    }
  })
```

### onDotConnect(callback: Callback<number>)

选中宫格圆点时实时触发（API 11+），可用于震动反馈或实时提示：

```typescript
.onDotConnect((index: number): void => {
  // 实时反馈（如震动或音效）
  console.info('connected dot: ' + index.toString())
})
```

### PatternLockController 控制器

```typescript
controller: PatternLockController = new PatternLockController()

// 重置图案状态
this.controller.reset()

// 设置验证结果（影响圆点颜色）
this.controller.setChallengeResult(PatternLockChallengeResult.CORRECT)
this.controller.setChallengeResult(PatternLockChallengeResult.WRONG)
```

## 5. 数据结构

```typescript
// 密码验证结果模型
interface PatternVerifyResult {
  success: boolean        // 验证是否通过
  attempts: number        // 尝试次数
  remainingAttempts: number // 剩余尝试次数
}
```

## 6. 联动说明

- 密码输入完成 → 对比存储的密码 → 设置 CORRECT/WRONG 状态
- setChallengeResult(WRONG) → 圆点和连线变为错误色，提示用户重试
- setChallengeResult(CORRECT) → 圆点和连线变为正确色，跳转下一页面
- 失败次数达上限 → isLocked 置为 true → 禁用 PatternLock 或弹出倒计时提示
- controller.reset() → 清除所有绘制状态，回到初始九宫格

## 7. 完整代码示例

```typescript
@Entry
@Component
struct PatternLockSetPage {
  @State message: string = '请绘制图案密码'
  @State firstPassword: number[] = []
  @State failCount: number = 0
  private patternLockController: PatternLockController = new PatternLockController()
  private maxAttempts: number = 5

  build() {
    Column({ space: 16 }) {
      Text(this.message)
        .fontSize(20)
        .textAlign(TextAlign.Center)
        .fontColor(this.failCount > 0 ? '#FF4444' : '#182431')
        .margin({ top: 40 })

      PatternLock(this.patternLockController)
        .sideLength(280)
        .circleRadius(10)
        .pathStrokeWidth(6)
        .regularColor('#CCCCCC')
        .activeColor('#007DFF')
        .selectedColor('#007DFF')
        .pathColor('#007DFF')
        .backgroundColor('#F5F5F5')
        .autoReset(true)
        .onDotConnect((index: number): void => {
          console.info('dot connected: ' + index.toString())
        })
        .onPatternComplete((input: Array<number>): void => {
          if (input.length < 4) {
            this.message = '至少连接4个点，请重试'
            return
          }

          if (this.firstPassword.length === 0) {
            this.firstPassword = input
            this.message = '请再次绘制以确认'
            this.patternLockController.reset()
            return
          }

          if (this.firstPassword.toString() === input.toString()) {
            this.message = '密码设置成功！'
            this.patternLockController.setChallengeResult(PatternLockChallengeResult.CORRECT)
            this.failCount = 0
          } else {
            this.failCount++
            if (this.failCount >= this.maxAttempts) {
              this.message = '失败次数过多，请稍后再试'
            } else {
              let remaining: number = this.maxAttempts - this.failCount
              this.message = '两次不一致，还可尝试' + remaining.toString() + '次'
            }
            this.patternLockController.setChallengeResult(PatternLockChallengeResult.WRONG)
            this.firstPassword = []
          }
        })

      Button('重新设置')
        .margin({ top: 24 })
        .onClick((): void => {
          this.patternLockController.reset()
          this.firstPassword = []
          this.failCount = 0
          this.message = '请绘制图案密码'
        })
    }
    .width('100%')
    .height('100%')
    .justifyContent(FlexAlign.Start)
    .padding(24)
  }
}
```

## 8. 反面示例

```typescript
// ❌ 没有绑定 controller，无法调用 reset() 或 setChallengeResult()
PatternLock()
  .onPatternComplete((input: Array<number>): void => {
    // 无法重置或设置验证结果
  })

// ❌ onPatternComplete 中没有做长度校验，1-2 个点也当作有效密码
PatternLock(this.controller)
  .onPatternComplete((input: Array<number>): void => {
    this.savedPassword = input  // 可能只有 1 个点
  })

// ❌ autoReset 为 false 但也没手动 reset()，用户无法重新输入
PatternLock(this.controller)
  .autoReset(false)
  .onPatternComplete((input: Array<number>): void => {
    if (input.toString() !== this.savedPassword.toString()) {
      this.message = '密码错误'
      // 忘记调用 this.controller.reset()
    }
  })

// ❌ 用 === 比较两个数组引用（永远不等），应转成字符串比较
// if (input === this.firstPassword) { ... }
// 正确做法：input.toString() === this.firstPassword.toString()
```

## 9. API 速查

| API | 说明 |
|-----|------|
| `PatternLock(controller?: PatternLockController)` | 创建图案密码锁组件 |
| `.sideLength(Length)` | 九宫格的宽高（正方形），默认 288vp |
| `.circleRadius(Length)` | 圆点半径，默认 6vp |
| `.pathStrokeWidth(number \| string)` | 连线宽度，默认 12vp |
| `.regularColor(color)` | 未选中圆点填充色 |
| `.selectedColor(color)` | 选中圆点填充色 |
| `.activeColor(color)` | 激活状态圆点填充色（手指经过但未选中） |
| `.pathColor(color)` | 连线颜色 |
| `.backgroundColor(color)` | 背景颜色 |
| `.autoReset(boolean)` | 输入完成后再次按下是否自动重置，默认 true |
| `.activateCircleStyle(CircleStyleOptions)` | 激活状态背景圆环样式（API 12+） |
| `.skipUnselectedPoint(boolean)` | 路径经过未选中点是否跳过选中（API 15+） |
| `.onPatternComplete((input: Array<number>) => void)` | 密码输入完成回调 |
| `.onDotConnect(Callback<number>)` | 选中圆点时实时回调（API 11+） |
| `PatternLockController.reset()` | 重置组件状态 |
| `PatternLockController.setChallengeResult(result)` | 设置验证结果（CORRECT / WRONG）（API 11+） |
