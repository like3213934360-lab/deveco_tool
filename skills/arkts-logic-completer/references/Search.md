# Search 组件功能逻辑规格

## 1. 功能定位

Search 是搜索框组件，用于接收用户输入的搜索关键字并触发搜索操作。当界面需要提供内容检索能力（商品搜索、联系人查找、页面筛选）时使用。

## 2. 典型场景

- 顶部搜索栏（首页搜索入口、列表页筛选）
- 带搜索建议的即时搜索（输入时实时过滤列表）
- 带历史记录的搜索页面
- 带分类筛选的搜索组合（Search + Tabs）

## 3. 状态声明

```typescript
// 搜索文本
@State searchText: string = ''

// 搜索结果
@State searchResults: string[] = []

// 搜索历史
@State searchHistory: string[] = []

// 搜索状态
@State isSearching: boolean = false

// 控制器
controller: SearchController = new SearchController()
```

## 4. 事件与交互逻辑

### onSubmit 核心事件

用户点击搜索按钮或软键盘搜索键时触发：

```typescript
Search({ value: this.searchText, placeholder: '搜索...', controller: this.controller })
  .searchButton('搜索')
  .onSubmit((value: string): void => {
    if (value.trim().length === 0) return
    this.doSearch(value)
  })
```

### onChange 实时输入

输入内容变化时触发，适用于即时搜索或搜索建议：

```typescript
Search({ value: this.searchText, placeholder: '搜索...' })
  .onChange((value: string): void => {
    this.searchText = value
    if (value.length > 0) {
      this.filterResults(value)
    } else {
      this.searchResults = []
    }
  })
```

### 场景：带防抖的搜索

```typescript
@State searchText: string = ''
private debounceTimer: number = -1

Search({ value: this.searchText, placeholder: '搜索商品' })
  .onChange((value: string): void => {
    this.searchText = value
    if (this.debounceTimer !== -1) {
      clearTimeout(this.debounceTimer)
    }
    this.debounceTimer = setTimeout((): void => {
      this.doSearch(value)
      this.debounceTimer = -1
    }, 300)
  })
  .onSubmit((value: string): void => {
    if (this.debounceTimer !== -1) {
      clearTimeout(this.debounceTimer)
      this.debounceTimer = -1
    }
    this.doSearch(value)
  })
```

## 5. 数据结构

```typescript
interface SearchHistoryItem {
  keyword: string
  timestamp: number
}

interface SearchSuggestion {
  text: string
  type: string  // 'history' | 'hot' | 'suggestion'
}

interface SearchResult {
  id: string
  title: string
  description: string
  matchRange: TextRange
}

interface TextRange {
  start: number
  end: number
}
```

## 6. 联动说明

- 输入文字 → onChange 触发 → 显示搜索建议列表
- 点击搜索按钮 → onSubmit 触发 → 发起搜索请求 → 更新结果列表
- 搜索完成 → 将关键词存入历史记录
- 点击历史记录项 → 自动填入搜索框 → 触发搜索
- 清空按钮点击 → 搜索框清空 → 搜索结果清空 → 显示默认内容

## 7. 完整代码示例

```typescript
@Entry
@Component
struct SearchPage {
  @State searchText: string = ''
  @State allItems: string[] = ['ArkUI 组件', 'ArkTS 语法', 'Stage 模型', '状态管理', '路由导航', '网络请求', '数据持久化']
  @State filteredItems: string[] = []
  @State searchHistory: string[] = []
  @State isEditing: boolean = false
  controller: SearchController = new SearchController()

  aboutToAppear(): void {
    this.filteredItems = this.allItems
  }

  doSearch(keyword: string): void {
    if (keyword.trim().length === 0) {
      this.filteredItems = this.allItems
      return
    }
    this.filteredItems = this.allItems.filter((item: string): boolean => {
      return item.includes(keyword)
    })
    let exists = false
    for (let i = 0; i < this.searchHistory.length; i++) {
      if (this.searchHistory[i] === keyword) {
        exists = true
        break
      }
    }
    if (!exists) {
      this.searchHistory.unshift(keyword)
      if (this.searchHistory.length > 10) {
        this.searchHistory.pop()
      }
    }
  }

  build() {
    Column() {
      Search({
        value: this.searchText,
        placeholder: '搜索知识点...',
        controller: this.controller
      })
        .searchButton('搜索')
        .width('100%')
        .height(40)
        .backgroundColor('#F5F5F5')
        .placeholderColor(Color.Grey)
        .placeholderFont({ size: 14, weight: 400 })
        .textFont({ size: 14, weight: 400 })
        .onChange((value: string): void => {
          this.searchText = value
          this.doSearch(value)
        })
        .onSubmit((value: string): void => {
          this.doSearch(value)
        })
        .onEditChange((isEditing: boolean): void => {
          this.isEditing = isEditing
        })

      if (this.isEditing && this.searchText.length === 0 && this.searchHistory.length > 0) {
        Row() {
          Text('搜索历史')
            .fontSize(14)
            .fontColor('#999')
          Blank()
          Text('清空')
            .fontSize(14)
            .fontColor('#0A59F7')
            .onClick((): void => {
              this.searchHistory = []
            })
        }
        .width('100%')
        .padding({ top: 12, bottom: 8 })

        Flex({ wrap: FlexWrap.Wrap }) {
          ForEach(this.searchHistory, (item: string) => {
            Text(item)
              .fontSize(12)
              .fontColor('#666')
              .backgroundColor('#F0F0F0')
              .borderRadius(14)
              .padding({ left: 12, right: 12, top: 6, bottom: 6 })
              .margin({ right: 8, bottom: 8 })
              .onClick((): void => {
                this.searchText = item
                this.doSearch(item)
              })
          })
        }
        .width('100%')
      }

      List({ space: 0 }) {
        ForEach(this.filteredItems, (item: string) => {
          ListItem() {
            Text(item)
              .fontSize(16)
              .width('100%')
              .padding(16)
          }
        })
      }
      .width('100%')
      .layoutWeight(1)
      .divider({ strokeWidth: 0.5, color: '#F0F0F0' })

      if (this.filteredItems.length === 0 && this.searchText.length > 0) {
        Column() {
          Text('未找到相关结果')
            .fontSize(14)
            .fontColor('#999')
            .margin({ top: 60 })
        }
        .width('100%')
        .layoutWeight(1)
      }
    }
    .width('100%')
    .height('100%')
    .padding(16)
  }
}
```

## 8. 反面示例

```typescript
// ❌ 没有 onSubmit，用户按搜索键无响应
Search({ placeholder: '搜索' })

// ❌ 没有处理空字符串，导致空搜索
Search({ placeholder: '搜索' })
  .onSubmit((value: string) => {
    this.doSearch(value)  // value 可能是空字符串
  })

// ❌ onChange 中直接发起网络请求，没有防抖
Search({ placeholder: '搜索' })
  .onChange((value: string) => {
    this.fetchFromServer(value)  // 每输入一个字符都请求，浪费资源
  })

// ❌ 搜索结果为空时没有任何提示
Search({ placeholder: '搜索' })
  .onSubmit((value: string) => {
    this.results = this.allItems.filter(i => i.includes(value))
    // 结果为空时页面一片空白，用户不知道发生了什么
  })

// ❌ 没有给 Search 设置 value 的双向绑定，外部无法清空搜索框
Search({ placeholder: '搜索' })
  .onChange((value: string) => {
    this.keyword = value
  })
```

## 9. API 速查

| API | 说明 |
|-----|------|
| `Search(options?)` | 创建搜索框，options 包含 value / placeholder / icon / controller |
| `.searchButton(text, options?)` | 设置搜索按钮文字和样式 |
| `.placeholderColor(color)` | placeholder 文本颜色 |
| `.placeholderFont(font)` | placeholder 文本样式 |
| `.textFont(font)` | 输入文本样式 |
| `.textAlign(TextAlign)` | 文本对齐方式 |
| `.fontColor(color)` | 输入文字颜色 |
| `.caretStyle(CaretStyle)` | 光标样式（宽度、颜色） |
| `.searchIcon(IconOptions)` | 左侧搜索图标样式 |
| `.cancelButton(options)` | 右侧清除按钮样式（CancelButtonStyle.CONSTANT / INPUT / INVISIBLE） |
| `.maxLength(number)` | 最大输入字符数 |
| `.type(SearchType)` | 输入框类型：NORMAL / NUMBER / PHONE_NUMBER / EMAIL |
| `.copyOption(CopyOptions)` | 是否可复制 |
| `.enableKeyboardOnFocus(boolean)` | 获焦时是否拉起键盘，默认 true |
| `.selectionMenuHidden(boolean)` | 是否隐藏系统选择菜单 |
| `.onSubmit(callback)` | 点击搜索按钮/软键盘搜索键时回调 |
| `.onChange(callback)` | 输入内容变化时回调 |
| `.onEditChange(callback)` | 编辑状态变化时回调（true=获焦, false=失焦） |
| `.onCopy / .onCut / .onPaste` | 复制/剪切/粘贴回调 |
| `controller.caretPosition(pos)` | 设置光标位置 |
| `controller.stopEditing()` | 退出编辑态 |
| `controller.setTextSelection(start, end)` | 设置选中区域 |
