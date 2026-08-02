# 表单校验模式

> 本文回答的问题：**「登录 / 注册 / 下单表单怎么组织校验时机、错误展示、异步校验,才不会出响应式失灵或误报?」**
>
> 涉及的 `TextInput` / `Checkbox` / `Button` 等组件完整规格请查对应 Reference。

---

## §0. 什么时候用这套

| 场景 | 建议 |
|------|------|
| 2 个字段以内 | 不需要本文。直接 `@State` 局部标记就行 |
| 3-10 个字段 | **用本文 §2 - §4**:errors 对象 + 分层触发 |
| 10+ 字段 / 动态字段 | **用本文 §5**:schema 驱动(但会复杂,本文只起头) |
| 需要异步校验(用户名查重) | **用本文 §6**:防抖 + 请求版本号 |

---

## §1. 三类校验时机

| 时机 | 触发条件 | 用在哪类字段 |
|------|---------|------------|
| **实时**(`onChange`) | 每次键入 | 格式很简单(手机号位数)、即时反馈有价值(密码强度) |
| **失焦**(`onBlur`) | 离开当前输入框 | 大多数字段的**默认选择**。键入时不打扰,失焦再校验 |
| **提交**(`click`) | 点击提交按钮 | 字段间关联校验(两次密码是否一致)、异步查重 |

**推荐组合**:

- 简单格式用 **失焦** 校验
- 密码强度、字符长度计数用 **实时** 可视化(但不影响提交)
- **异步校验(重名查重)必须上防抖**,放在失焦或提交时

---

## §2. 错误数据结构(核心抽象)

### 关键决策:用 `interface` 而不是 `Record`

```typescript
// ❌ 错误:ArkTS 对 Record 作为 @State 支持有限,常出响应式失灵
@State errors: Record<string, string> = {}

// ✅ 正确:用显式 interface
interface LoginFormErrors {
  phone: string
  password: string
}

@State errors: LoginFormErrors = { phone: '', password: '' }
```

### 关键决策:整对象替换,而不是单字段改

```typescript
// ❌ 错误:直接改字段,ArkTS 响应式不一定刷新
this.errors.phone = '格式错误'

// ✅ 正确:整对象替换(展开运算符不可用,手动列字段)
this.errors = { phone: '格式错误', password: this.errors.password }
```

> ArkTS [不支持对象展开 `{ ...obj }`](../../SKILL.md)(硬约束 1),所以更新单个字段时要手写"保留其他字段"。字段多时可以封装一个 `updateError(key, value)` 方法。

---

## §3. 单字段失焦校验(最常见骨架)

```typescript
interface LoginFormErrors {
  phone: string
  password: string
}

@Entry
@Component
struct LoginPage {
  @State phone: string = ''
  @State password: string = ''
  @State errors: LoginFormErrors = { phone: '', password: '' }

  build() {
    Column({ space: 16 }) {
      // 手机号
      Column({ space: 4 }) {
        TextInput({ placeholder: '请输入手机号', text: this.phone })
          .type(InputType.PhoneNumber)
          .maxLength(11)
          .onChange((v: string): void => { this.phone = v })
          .onBlur((): void => { this.validatePhone() })
          .showError(this.errors.phone.length > 0 ? this.errors.phone : undefined)
      }

      // 密码
      Column({ space: 4 }) {
        TextInput({ placeholder: '请输入密码', text: this.password })
          .type(InputType.Password)
          .onChange((v: string): void => { this.password = v })
          .onBlur((): void => { this.validatePassword() })
          .showError(this.errors.password.length > 0 ? this.errors.password : undefined)
      }

      Button('登录')
        .enabled(this.canSubmit())
        .onClick((): void => { this.submit() })
    }
    .padding(16)
  }

  private validatePhone(): void {
    const err: string = /^1\d{10}$/.test(this.phone) ? '' : '请输入 11 位手机号'
    this.errors = { phone: err, password: this.errors.password }
  }

  private validatePassword(): void {
    const err: string = this.password.length >= 6 ? '' : '密码至少 6 位'
    this.errors = { phone: this.errors.phone, password: err }
  }

  private canSubmit(): boolean {
    return this.phone.length > 0 && this.password.length > 0
      && this.errors.phone.length === 0 && this.errors.password.length === 0
  }

  private submit(): void {
    // 提交前再全量校验一次(§4)
    this.validatePhone()
    this.validatePassword()
    if (!this.canSubmit()) { return }
    // ...发起登录请求
  }
}
```

**关键点**:

1. `TextInput.showError(undefined)` 隐藏错误,`.showError('xxx')` 显示;**不要传空字符串**(行为可能不一致,用 `undefined` 最稳)
2. `onBlur` 触发校验,校验结果写进 `errors`;`onChange` 只更新字段值,**不校验**(不打扰用户键入)
3. `canSubmit()` 用 `errors` + 字段值综合判断,驱动 `Button.enabled`
4. 提交前**再跑一次全量校验**,因为用户可能根本没失过焦(直接点提交)

---

## §4. 提交前全量校验(多字段)

```typescript
interface RegisterForm {
  phone: string
  email: string
  password: string
  confirmPassword: string
  agreed: boolean
}

interface RegisterFormErrors {
  phone: string
  email: string
  password: string
  confirmPassword: string
  agreed: string
}

@Entry
@Component
struct RegisterPage {
  @State form: RegisterForm = {
    phone: '', email: '', password: '', confirmPassword: '', agreed: false
  }
  @State errors: RegisterFormErrors = {
    phone: '', email: '', password: '', confirmPassword: '', agreed: ''
  }

  build() {
    Scroll() {
      Column({ space: 16 }) {
        // ...每个字段的 TextInput + showError,省略
        Checkbox({ name: 'agree' })
          .select(this.form.agreed)
          .onChange((v: boolean): void => {
            this.form = {
              phone: this.form.phone, email: this.form.email,
              password: this.form.password, confirmPassword: this.form.confirmPassword,
              agreed: v
            }
          })
        Text('我已阅读并同意《用户协议》')
        if (this.errors.agreed.length > 0) {
          Text(this.errors.agreed).fontColor('#FF3B30').fontSize(12)
        }

        Button('注册').onClick((): void => { this.submit() })
      }
      .padding(16)
    }
  }

  private validateAll(): boolean {
    const next: RegisterFormErrors = {
      phone: /^1\d{10}$/.test(this.form.phone) ? '' : '手机号格式错误',
      email: /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(this.form.email) ? '' : '邮箱格式错误',
      password: this.form.password.length >= 8 ? '' : '密码至少 8 位',
      confirmPassword: this.form.password === this.form.confirmPassword ? '' : '两次密码不一致',
      agreed: this.form.agreed ? '' : '请先勾选用户协议'
    }
    this.errors = next
    return next.phone.length === 0 && next.email.length === 0
      && next.password.length === 0 && next.confirmPassword.length === 0
      && next.agreed.length === 0
  }

  private submit(): void {
    if (!this.validateAll()) {
      return
      // 可选:根据需要滚动到第一个错误字段
    }
    // ...发起注册请求
  }
}
```

**关键点**:

1. `validateAll()` 一次性生成新 `errors` 对象再整体赋值,**不要逐字段 if 写入**
2. 返回 `boolean` 让调用方知道是否通过,不用到处判断 `this.errors.xxx === ''`
3. 密码一致性校验依赖**两个字段的值**,这种跨字段校验**只能放提交时**,放 `onBlur` 会很别扭

---

## §5. 异步校验(用户名查重,带防抖)

### 场景

用户在"用户名"输入框打字,每输入一次都去后端查是否已被占用 —— 但不能每个字符都发请求。**需求**:停顿 500ms 后才查,且忽略过期响应。

### 状态结构

```typescript
@State username: string = ''
@State usernameStatus: AsyncStatus = AsyncStatus.Idle
@State errors: RegisterFormErrors = /* ... */

enum AsyncStatus {
  Idle,
  Checking,         // 请求中
  Available,        // 可用
  Taken,            // 已占用
  Failed            // 校验失败(网络错误)
}
```

### 防抖骨架

```typescript
private debounceTimer: number = -1
private checkVersion: number = 0

private onUsernameChange(v: string): void {
  this.username = v
  // 清 errors 占位,等异步结果
  this.errors = { /* ... */, username: '' }
  this.usernameStatus = AsyncStatus.Idle

  // 清掉上一次的防抖 timer
  if (this.debounceTimer !== -1) {
    clearTimeout(this.debounceTimer)
  }

  if (v.length === 0) {
    return
  }

  this.debounceTimer = setTimeout((): void => {
    this.checkUsername(v)
  }, 500)
}

private async checkUsername(name: string): Promise<void> {
  this.checkVersion += 1
  const my: number = this.checkVersion
  this.usernameStatus = AsyncStatus.Checking

  try {
    const available: boolean = await this.queryUsername(name)
    // 只有最新一次请求的结果才写入状态
    if (my === this.checkVersion) {
      this.usernameStatus = available ? AsyncStatus.Available : AsyncStatus.Taken
      this.errors = {
        /* 保留其他字段 */
        username: available ? '' : '用户名已被占用'
      }
    }
  } catch (e) {
    if (my === this.checkVersion) {
      this.usernameStatus = AsyncStatus.Failed
      this.errors = { /* ... */, username: '校验失败,请重试' }
    }
  }
}

private async queryUsername(name: string): Promise<boolean> {
  // 真实业务用 apiGet<{ available: boolean }>,见 data-fetching.md §3
  return new Promise<boolean>((resolve: (v: boolean) => void): void => {
    setTimeout((): void => { resolve(name !== 'admin') }, 400)
  })
}
```

**关键点**:

1. **防抖**:`setTimeout` + `clearTimeout`,停顿 500ms 才发请求
2. **防并发**:同 [data-fetching.md §6](data-fetching.md) 的版本号方案。快速输入会触发多次异步请求,最慢的一次可能覆盖最新结果,必须靠 `checkVersion` 丢弃过期响应
3. **Idle 态可见**:正在输入 / 刚清空时应该是 `Idle`,不是 "Available" 或 "Taken"。这三态不能混
4. **submit 前要查 `usernameStatus === Available`**,否则用户可能"刚敲完还没等查重完就点了提交"

### 按钮联动

```typescript
Button('注册')
  .enabled(this.canSubmit())
  .onClick((): void => { this.submit() })

private canSubmit(): boolean {
  return this.username.length > 0
    && this.usernameStatus === AsyncStatus.Available
    /* && 其他字段...*/
}
```

---

## §6. 错误展示模式选型

| 方式 | 触发 | 适用 |
|------|------|------|
| **`TextInput.showError(msg)`** | 传入非空字符串 | 大多数单字段;**官方原生**,自带红线 + 图标 |
| **手动 `Text` 红字** | `if (err) { Text(err) }` 条件渲染 | 字段结构复杂(如 Checkbox 组、日期选择器)时 `showError` 不可用,只能手动 |
| **Toast** | `promptAction.showToast` | **提交失败**的兜底提示,不是单字段错误 |
| **整页错误态** | 整表提交失败(网络层) | 跳转错误页或用 SnackBar |

### `TextInput.showError` 典型用法

```typescript
TextInput({ placeholder: '手机号' })
  .onBlur((): void => { this.validatePhone() })
  .showError(this.errors.phone.length > 0 ? this.errors.phone : undefined)
  //                                    ↑ 注意:空字符串要转成 undefined,否则可能出现红线但不显示文字
```

### 手动 `Text` 典型用法

```typescript
Column({ space: 4 }) {
  Checkbox().select(this.form.agreed).onChange(/* ... */)
  if (this.errors.agreed.length > 0) {
    Text(this.errors.agreed).fontColor('#FF3B30').fontSize(12)
  }
}
```

---

## §7. 反面示例

### ❌ 用 `Record<string, string>` 作为 `@State errors`

```typescript
// 错误:ArkTS 对 Record 作为 @State 支持有限,常出响应式失灵
@State errors: Record<string, string> = {}

// 正确:显式 interface
interface FormErrors { phone: string, password: string }
@State errors: FormErrors = { phone: '', password: '' }
```

### ❌ 直接改 `errors.xxx` 单字段

```typescript
// 错误:ArkTS 响应式依赖"整对象替换"语义
this.errors.phone = '格式错误'

// 正确
this.errors = { phone: '格式错误', password: this.errors.password }
```

### ❌ 用对象展开

```typescript
// 错误:ArkTS 不支持对象展开 { ...obj },违反 SKILL.md §1
this.errors = { ...this.errors, phone: '格式错误' }

// 正确:手动列字段
this.errors = { phone: '格式错误', password: this.errors.password }
```

### ❌ `onChange` 做严格校验

```typescript
// 错误:用户键入一半就红线弹出,体验差
TextInput().onChange((v: string): void => {
  this.phone = v
  if (!/^1\d{10}$/.test(v)) {       // 键入到第 5 位就显示"格式错误"
    this.errors = { phone: '格式错误', /* ... */ }
  }
})

// 正确:onBlur 做校验,onChange 只更新值
TextInput()
  .onChange((v: string): void => { this.phone = v })
  .onBlur((): void => { this.validatePhone() })
```

### ❌ 异步校验不防抖

```typescript
// 错误:每次按键都发请求,后端被打爆
TextInput().onChange(async (v: string): Promise<void> => {
  this.username = v
  const ok: boolean = await this.queryUsername(v)     // ← 每个字符一个请求
  this.errors = { /* ... */, username: ok ? '' : '已被占用' }
})

// 正确:防抖 + 版本号,见 §5
```

### ❌ 异步校验结果覆盖乱序

```typescript
// 错误:快速输入 "admin" → "admin2",admin 请求返回晚了,把"已被占用"错误写回去
private async checkUsername(name: string): Promise<void> {
  const ok: boolean = await this.queryUsername(name)
  this.errors = { /* ... */, username: ok ? '' : '已被占用' }
}

// 正确:版本号,见 §5
```

### ❌ submit 时不重新校验,直接用旧 `errors`

```typescript
// 错误:用户从没失过焦,errors 一直是空,直接放行
private submit(): void {
  if (this.errors.phone.length > 0) { return }        // ← 一直是 ''
  this.doLogin()
}

// 正确:submit 前跑一次 validateAll()
private submit(): void {
  if (!this.validateAll()) { return }
  this.doLogin()
}
```

### ❌ `showError` 传空字符串

```typescript
// 错误:空字符串可能出现红线但不显示文字
TextInput().showError(this.errors.phone)             // 值为 '' 时

// 正确:空串转 undefined
TextInput().showError(this.errors.phone.length > 0 ? this.errors.phone : undefined)
```

### ❌ 箭头函数缺类型标注

```typescript
// 错误:违反 SKILL.md §3
.onChange((v) => { this.phone = v })

// 正确
.onChange((v: string): void => { this.phone = v })
```

---

## §8. 速查

### 错误数据结构骨架

```typescript
interface FormErrors {
  field1: string
  field2: string
  // ...
}

@State errors: FormErrors = { field1: '', field2: '' }

// 更新单字段:整对象替换,手写保留其他字段
this.errors = { field1: '错误', field2: this.errors.field2 }
```

### 异步校验防抖骨架(必抄)

```typescript
private debounceTimer: number = -1
private checkVersion: number = 0

private onChange(v: string): void {
  this.value = v
  if (this.debounceTimer !== -1) { clearTimeout(this.debounceTimer) }
  this.debounceTimer = setTimeout((): void => {
    this.doAsyncCheck(v)
  }, 500)
}

private async doAsyncCheck(v: string): Promise<void> {
  this.checkVersion += 1
  const my: number = this.checkVersion
  try {
    const result: boolean = await this.api(v)
    if (my === this.checkVersion) {
      // 写入状态
    }
  } catch (e) {
    if (my === this.checkVersion) {
      // 写入错误态
    }
  }
}
```

### 校验时机决策

```
字段多 / 简单格式 → onBlur 校验(默认)
密码强度 / 字符计数 → onChange 实时更新可视化,但不阻塞提交
跨字段校验(两次密码) → 只在 submit 做
异步查重 → 防抖 + 版本号,在 onBlur 或 onChange 停顿后做
```

### 硬纪律 6 条

1. `errors` 用 `interface`,**不用 `Record`**
2. 更新单字段**整对象替换**,不直接改属性,不用对象展开
3. `onChange` 更新值,`onBlur` 做校验,**不要反过来**
4. `submit` 前**必须**跑一次全量校验,不能依赖 `errors` 是否为空
5. 异步校验**必须**防抖 + 版本号(§5),不然被后端打爆或出串数据
6. `showError(undefined)` 隐藏,**不要传空字符串**

### 引用链接

- 数据请求套路(防并发方案同源) → [data-fetching.md](data-fetching.md)
- TextInput 组件规格 → [../TextInput.md](../TextInput.md)
- Checkbox 组件规格 → [../Checkbox.md](../Checkbox.md)
- Button 组件规格 → [../Button.md](../Button.md)
