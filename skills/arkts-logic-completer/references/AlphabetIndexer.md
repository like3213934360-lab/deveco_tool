# AlphabetIndexer 组件功能逻辑规格

## 1. 功能定位

AlphabetIndexer 是字母索引条组件，可与 List 等容器组件联动用于按字母快速定位内容。当界面需要按首字母分组并快速跳转列表位置时使用。

## 2. 典型场景

- 通讯录按姓名首字母快速定位联系人
- 城市选择列表的字母索引导航
- 音乐/应用列表按字母分类检索
- 任何需要侧边字母索引栏的长列表场景

## 3. 状态声明

```typescript
// 索引字母数组
private indexerArray: string[] = ['#', 'A', 'B', 'C', 'D', 'E', 'F', 'G',
  'H', 'I', 'J', 'K', 'L', 'M', 'N',
  'O', 'P', 'Q', 'R', 'S', 'T', 'U',
  'V', 'W', 'X', 'Y', 'Z']

// 当前选中索引
@State selectedIndex: number = 0

// 联系人数据（按首字母分组）
@State contacts: ContactGroup[] = []
```

装饰器选择：
- `@State`：页面内部状态（当前选中索引）
- `$$`：API 10+ 支持 `selected` 属性双向绑定：`AlphabetIndexer({ arrayValue: this.indexerArray, selected: $$this.selectedIndex })`

## 4. 事件与交互逻辑

### onSelect(callback: (index: number) => void)

索引项被选中时触发，index 为当前选中项在 arrayValue 中的位置：

```typescript
AlphabetIndexer({ arrayValue: this.indexerArray, selected: 0 })
  .usingPopup(true)
  .onSelect((index: number): void => {
    // 1. 更新选中索引
    this.selectedIndex = index

    // 2. 联动列表跳转
    let letter: string = this.indexerArray[index]
    this.scrollToGroup(letter)
  })
```

### onRequestPopupData(callback: (index: number) => Array<string>)

提示弹窗二级索引内容请求，返回该字母下的子项列表：

```typescript
.onRequestPopupData((index: number): Array<string> => {
  let letter: string = this.indexerArray[index]
  if (letter === 'A') {
    return ['安', '艾', '奥']
  } else if (letter === 'B') {
    return ['白', '包', '毕']
  }
  return []
})
```

### onPopupSelect(callback: (index: number) => void)

提示弹窗二级索引项被选中时触发：

```typescript
.onPopupSelect((index: number): void => {
  // 定位到弹窗中选中的二级项
  console.info('popup selected: ' + index.toString())
})
```

## 5. 数据结构

```typescript
// 联系人分组模型
interface ContactGroup {
  letter: string          // 分组首字母
  contacts: ContactItem[] // 该字母下的联系人列表
}

// 联系人数据模型
interface ContactItem {
  name: string           // 姓名
  phone: string          // 电话号码
  avatar?: Resource      // 头像（可选）
}
```

## 6. 联动说明

- AlphabetIndexer 选中字母 → List/Scroller 跳转到对应分组位置
- List 滚动到某分组 → 反向更新 AlphabetIndexer 的 selected 索引（通过 $$ 双向绑定）
- usingPopup(true) → 选中索引项时弹出提示窗，展示该字母下的子项
- autoCollapse(true) → 索引条根据高度自动折叠/展开（API 11+）

## 7. 完整代码示例

```typescript
interface ContactItem {
  name: string
  phone: string
}

interface ContactGroup {
  letter: string
  contacts: ContactItem[]
}

@Entry
@Component
struct ContactListPage {
  private indexerArray: string[] = ['#', 'A', 'B', 'C', 'D', 'E', 'F', 'G',
    'H', 'I', 'J', 'K', 'L', 'M', 'N',
    'O', 'P', 'Q', 'R', 'S', 'T', 'U',
    'V', 'W', 'X', 'Y', 'Z']
  @State selectedIndex: number = 0
  private listScroller: Scroller = new Scroller()

  private groupA: string[] = ['安宁', '艾青']
  private groupB: string[] = ['白雪', '包青天', '毕加索']
  private groupC: string[] = ['曹操', '成龙', '陈真']
  private groupL: string[] = ['刘备', '李白', '梁山伯', '卢俊义']

  build() {
    Stack({ alignContent: Alignment.End }) {
      List({ scroller: this.listScroller, space: 4 }) {
        ForEach(this.groupA, (name: string): void => {
          ListItem() {
            Text(name).fontSize(18).padding(12).width('100%')
          }
        })
        ForEach(this.groupB, (name: string): void => {
          ListItem() {
            Text(name).fontSize(18).padding(12).width('100%')
          }
        })
        ForEach(this.groupC, (name: string): void => {
          ListItem() {
            Text(name).fontSize(18).padding(12).width('100%')
          }
        })
        ForEach(this.groupL, (name: string): void => {
          ListItem() {
            Text(name).fontSize(18).padding(12).width('100%')
          }
        })
      }
      .width('100%')
      .height('100%')
      .padding({ right: 40 })

      AlphabetIndexer({ arrayValue: this.indexerArray, selected: 0 })
        .selected(this.selectedIndex)
        .usingPopup(true)
        .selectedColor(0xFFFFFF)
        .selectedBackgroundColor(0x007DFF)
        .popupColor(0x007DFF)
        .popupBackground(0xFFFFFF)
        .selectedFont({ size: 14, weight: FontWeight.Bold })
        .font({ size: 12, weight: FontWeight.Normal })
        .itemSize(20)
        .alignStyle(IndexerAlign.Left)
        .onSelect((index: number): void => {
          this.selectedIndex = index
        })
        .onRequestPopupData((index: number): Array<string> => {
          if (this.indexerArray[index] === 'A') {
            return this.groupA
          } else if (this.indexerArray[index] === 'B') {
            return this.groupB
          } else if (this.indexerArray[index] === 'C') {
            return this.groupC
          } else if (this.indexerArray[index] === 'L') {
            return this.groupL
          }
          return []
        })
        .onPopupSelect((index: number): void => {
          console.info('popup item selected: ' + index.toString())
        })
    }
    .width('100%')
    .height('100%')
  }
}
```

## 8. 反面示例

```typescript
// ❌ arrayValue 为空数组，索引条不显示任何内容
AlphabetIndexer({ arrayValue: [], selected: 0 })

// ❌ selected 超出范围，会取默认值 0
AlphabetIndexer({ arrayValue: ['A', 'B', 'C'], selected: 99 })

// ❌ 没有设置 usingPopup(true) 就使用 onRequestPopupData，弹窗不会出现
AlphabetIndexer({ arrayValue: this.indexerArray, selected: 0 })
  .onRequestPopupData((index: number): Array<string> => {
    return ['item1', 'item2']
  })

// ❌ 没有和 List 联动跳转，用户点击索引无效果
AlphabetIndexer({ arrayValue: this.indexerArray, selected: 0 })
  .onSelect((index: number): void => {
    // 缺少 scroller.scrollToIndex() 联动
    console.info('selected')
  })
```

## 9. API 速查

| API | 说明 |
|-----|------|
| `AlphabetIndexer({ arrayValue: string[], selected: number })` | 创建索引条，arrayValue 为索引字母数组 |
| `.selected(index: number)` | 设置当前选中项索引，支持 $$ 双向绑定（API 10+） |
| `.usingPopup(boolean)` | 是否显示提示弹窗，默认 false |
| `.onSelect((index: number) => void)` | 索引项选中事件 |
| `.onRequestPopupData((index: number) => string[])` | 请求弹窗二级索引内容 |
| `.onPopupSelect((index: number) => void)` | 弹窗二级索引项选中事件 |
| `.alignStyle(IndexerAlign, offset?)` | 弹窗对齐样式（Left / Right / START / END） |
| `.color(color)` | 未选中项文本颜色 |
| `.selectedColor(color)` | 选中项文本颜色 |
| `.selectedBackgroundColor(color)` | 选中项背景颜色 |
| `.popupColor(color)` | 弹窗一级索引文本颜色 |
| `.popupBackground(color)` | 弹窗背景颜色 |
| `.popupFont(Font)` | 弹窗一级索引文本样式 |
| `.selectedFont(Font)` | 选中项文本样式 |
| `.font(Font)` | 未选中项文本样式 |
| `.itemSize(number)` | 索引项区域大小，默认 16vp |
| `.autoCollapse(boolean)` | 自适应折叠模式（API 11+） |
| `.popupBackgroundBlurStyle(BlurStyle)` | 弹窗背景模糊材质（API 12+） |
