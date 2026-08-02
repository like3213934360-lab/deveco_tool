# TextInput 组件功能逻辑规格

## 1. 功能定位

TextInput 是单行文本输入组件，用于接收用户键入的文本内容。当界面需要用户输入文字（搜索、登录、表单填写）时使用。

## 2. 典型场景

- 搜索框：带实时搜索/防抖/清空按钮
- 登录页：账号密码输入 + 校验 + 提交
- 表单项：姓名/手机号/地址等字段录入
- 评论/备注：短文本输入

## 3. 状态声明

```typescript
// 基本输入
@State inputValue: string = ''

// 搜索场景
@State searchText: string = ''
@State searchResults: string[] = []
@State isSearching: boolean = false

// 表单场景
@State username: string = ''
@State password: string = ''
@State usernameError: string = ''
@State passwordError: string = ''
@State isSubmitting: boolean = false

// 需要编程控制时（光标定位、选区等）
private controller: TextInputController = new TextInputController()
```

## 4. 事件与交互逻辑

### onChange(callback: (value: string) => void)
输入内容实时变化时触发，用于同步状态、实时校验、字数统计。

```typescript
TextInput({ placeholder: '请输入用户名', text: this.username })
  .onChange((value: string): void => {
    this.username = value
    // 实时校验
    if (value.length < 3) {
      this.usernameError = '用户名至少3个字符'
    } else {
      this.usernameError = ''
    }
  })
```

### onSubmit(callback: (enterKey: EnterKeyType) => void)
按下回车/搜索键时触发，用于提交表单、触发搜索。

```typescript
TextInput({ placeholder: '搜索' })
  .type(InputType.Normal)
  .enterKeyType(EnterKeyType.Search)
  .onSubmit((): void => {
    this.performSearch(this.searchText)
  })
```

### 原生输入过滤 inputFilter（API 8+）
通过正则表达式在输入层面直接拦截非法字符，比在 onChange 里手动校验更可靠：

```typescript
TextInput({ placeholder: '手机号' })
  .type(InputType.PhoneNumber)
  .inputFilter('[0-9]', (rejected: string): void => {
    console.info('被过滤: ' + rejected)
  })
```

### 原生错误提示 showError（API 10+）
内置的错误状态显示，在输入框下方直接显示红色错误文本，常与 `.showUnderline(true)` 一起使用（非必需，密码模式下 showUnderline 不生效）：

```typescript
TextInput({ placeholder: '用户名' })
  .showUnderline(true)
  .showError(this.usernameError.length > 0 ? this.usernameError : undefined)
```

传入 `undefined` 时隐藏错误状态。相比手动用 Text 组件显示错误信息，showError 更简洁且样式统一。

### 其他事件
- `onFocus(() => void)` — 获焦时触发（显示提示、展开搜索面板）
- `onBlur(() => void)` — 失焦时触发（触发校验、收起键盘）
- `onCopy/onCut/onPaste((value: string) => void)` — 剪贴板操作
- `onEditChange((isEditing: boolean) => void)` — 编辑状态变化

## 5. 数据结构

```typescript
// 表单字段模型
interface FormField {
  key: string          // 字段标识
  label: string        // 显示标签
  value: string        // 当前值
  placeholder: string  // 占位提示
  inputType: InputType // 输入类型
  required: boolean    // 是否必填
  errorMsg: string     // 校验错误信息
  maxLength?: number   // 最大长度
}

// 校验规则
interface ValidationRule {
  pattern?: RegExp     // 正则校验
  minLength?: number
  maxLength?: number
  message: string      // 校验失败提示
}
```

## 6. 联动说明

- TextInput 输入 → 实时过滤列表（搜索联动）
- TextInput 校验失败 → 显示错误提示 Text + Button 提交按钮置灰
- TextInput 获焦 → 展开搜索建议面板
- 多个 TextInput 组成表单 → 全部校验通过才能提交

## 7. 完整代码示例

```typescript
@Entry
@Component
struct SearchPage {
  @State searchText: string = ''
  @State searchResults: string[] = []
  @State isSearching: boolean = false
  @State allItems: string[] = ['设置', '显示', '声音', '通知', '安全', '隐私', '电池', '存储']
  private debounceTimer: number = -1

  performSearch(keyword: string) {
    if (keyword.trim() === '') {
      this.searchResults = []
      return
    }
    this.isSearching = true
    this.searchResults = this.allItems.filter((item: string): boolean => item.includes(keyword))
    this.isSearching = false
  }

  build() {
    Column({ space: 12 }) {
      // 搜索框
      TextInput({ placeholder: '搜索设置项', text: this.searchText })
        .enterKeyType(EnterKeyType.Search)
        .onChange((value: string): void => {
          this.searchText = value
          // 防抖搜索
          clearTimeout(this.debounceTimer)
          this.debounceTimer = setTimeout((): void => {
            this.performSearch(value)
          }, 300)
        })
        .onSubmit((): void => {
          clearTimeout(this.debounceTimer)
          this.performSearch(this.searchText)
        })

      // 搜索结果
      if (this.isSearching) {
        Text('搜索中...')
      } else if (this.searchText.length > 0 && this.searchResults.length === 0) {
        Text('无搜索结果')
          .fontColor('#999')
      } else {
        ForEach(this.searchResults, (item: string): void => {
          Row() {
            Text(item)
          }
          .width('100%')
          .padding(16)
          .onClick((): void => {
            // 跳转到对应设置项
          })
        })
      }
    }
    .width('100%')
    .padding(16)
  }
}
```

## 8. 反面示例

```typescript
// ❌ 没有状态绑定，输入内容无法获取
TextInput({ placeholder: '请输入' })

// ❌ 有 onChange 但没有用 @State，UI 不更新
let text = ''
TextInput({ text: text })
  .onChange((value: string) => { text = value })

// ❌ 搜索框没有防抖，每次按键都触发搜索
TextInput()
  .onChange((value: string) => {
    this.performSearch(value)  // 输入 "hello" 会搜索 5 次
  })

// ❌ 表单没有校验，直接提交
Button('提交')
  .onClick(() => {
    this.submit()  // username 可能是空的
  })
```

## 9. API 速查

| API | 说明 |
|-----|------|
| `TextInput({ placeholder?, text?, controller? })` | 创建输入框，text 支持 $$ 双向绑定（API 10+） |
| `.type(InputType)` | 输入类型（见下表） |
| `.enterKeyType(EnterKeyType)` | 回车键类型：Done/Go/Search/Send/Next/PREVIOUS(11+)/NEW_LINE(11+) |
| `.maxLength(number)` | 最大输入长度 |
| `.showPasswordIcon(boolean)` | 密码模式下显示可见性切换图标 |
| `.inputFilter(regex, error?)` | 正则过滤非法输入字符（API 8+） |
| `.showError(ResourceStr \| undefined)` | 错误状态下的提示文本，传入 undefined 隐藏错误状态（API 10+） |
| `.showUnderline(boolean)` | 下划线模式（API 10+） |
| `.showCounter(boolean, options?)` | 字符计数器（API 11+） |
| `.enableKeyboardOnFocus(boolean)` | 获焦时是否自动拉起键盘，默认 true（API 10+） |
| `.cancelButton({ style?, icon? })` | 右侧清除按钮（API 11+） |
| `.selectAll(boolean)` | 设置初始状态时是否全选文本（API 11+） |
| `.onChange((value: string) => void)` | 内容变化回调 |
| `.onSubmit((enterKey: EnterKeyType) => void)` | 回车提交回调 |
| `.onFocus(() => void)` | 获焦回调 |
| `.onBlur(() => void)` | 失焦回调 |
| `.onEditChange((isEditing: boolean) => void)` | 编辑状态变化 |

**InputType 枚举**：

| 类型 | 说明 |
|------|------|
| Normal | 普通文本（默认） |
| Password | 密码 |
| Email | 邮箱 |
| Number | 纯数字 |
| PhoneNumber | 电话号码 |
| USER_NAME（11+） | 用户名（适配密码填充服务） |
| NEW_PASSWORD（11+） | 新密码 |
| NUMBER_PASSWORD（11+） | 数字密码 |
| NUMBER_DECIMAL（11+） | 带小数点的数字 |
| URL（12+） | URL 输入 |

> **Controller**：需要编程控制光标或选区时，构造时传入 `TextInputController`，可调用 `controller.caretPosition(pos)` 定位光标、`controller.setTextSelection(start, end)` 设置选区。
