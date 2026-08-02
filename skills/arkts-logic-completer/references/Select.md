# Select 组件功能逻辑规格

## 1. 功能定位

Select 是下拉选择菜单组件，用于在多个选项中让用户选择一项。当界面需要从预定义的选项列表中选择单个值（分类筛选、排序方式、语言切换）时使用。

## 2. 典型场景

- 表单中的分类/类型选择器
- 页面头部的排序方式切换
- 设置页的语言/主题切换
- 筛选条件的下拉选项

## 3. 状态声明

```typescript
// 选中项索引（-1 表示未选中）
@State selectedIndex: number = -1

// 显示文本
@State selectedText: string = '请选择'

// 选项列表（如果是动态数据）
@State options: SelectOption[] = []
```

## 4. 事件与交互逻辑

### onSelect 核心事件

用户在下拉菜单中选中一项时触发：

```typescript
Select([
  { value: '最新发布' },
  { value: '最多浏览' },
  { value: '最多点赞' }
])
  .selected(this.selectedIndex)
  .value(this.selectedText)
  .onSelect((index: number, value: string): void => {
    this.selectedIndex = index
    this.selectedText = value
    this.onSortChanged(index)
  })
```

### 场景：带图标的分类选择

```typescript
Select([
  { value: '全部', icon: $r('app.media.ic_all') },
  { value: '美食', icon: $r('app.media.ic_food') },
  { value: '旅游', icon: $r('app.media.ic_travel') }
])
  .selected(this.selectedIndex)
  .value(this.selectedText)
  .font({ size: 16, weight: 500 })
  .fontColor('#182431')
  .selectedOptionFont({ size: 16, weight: 400 })
  .optionFont({ size: 16, weight: 400 })
  .onSelect((index: number, value: string): void => {
    this.selectedIndex = index
    this.selectedText = value
    this.filterByCategory(value)
  })
```

### 场景：联动表单

```typescript
@State cityIndex: number = -1
@State cityText: string = '选择城市'
@State districtIndex: number = -1
@State districtText: string = '选择区域'
@State districts: SelectOption[] = []

// 城市选择
Select(this.cityOptions)
  .selected(this.cityIndex)
  .value(this.cityText)
  .onSelect((index: number, value: string): void => {
    this.cityIndex = index
    this.cityText = value
    this.districtIndex = -1
    this.districtText = '选择区域'
    this.districts = this.getDistricts(value)
  })

// 区域选择（依赖城市）
Select(this.districts)
  .selected(this.districtIndex)
  .value(this.districtText)
  .onSelect((index: number, value: string): void => {
    this.districtIndex = index
    this.districtText = value
  })
```

## 5. 数据结构

```typescript
// SelectOption 是系统接口，此处展示其结构
interface SelectOption {
  value: ResourceStr
  icon?: ResourceStr
}

// 业务层：筛选项配置
interface FilterConfig {
  label: string
  options: SelectOption[]
  selectedIndex: number
  onChange: (index: number, value: string) => void
}

// 业务层：级联选择数据
interface CascadeSelectData {
  parentValue: string
  children: SelectOption[]
}
```

## 6. 联动说明

- 用户点击 Select → 下拉菜单弹出 → 选择一项 → onSelect 回调
- 选中项变化 → 同步更新 selectedIndex 和 value → 触发列表/表格刷新
- 父级 Select 变化 → 重置子级 Select 的选项和选中状态
- 表单提交时 → 读取所有 Select 的 selectedIndex → 构建请求参数
- Select 配合 Search → 搜索时根据 Select 的值附加过滤条件

## 7. 完整代码示例

```typescript
@Entry
@Component
struct ProductListPage {
  @State sortIndex: number = 0
  @State sortText: string = '默认排序'
  @State categoryIndex: number = -1
  @State categoryText: string = '全部分类'
  @State products: ProductItem[] = []
  @State allProducts: ProductItem[] = []

  aboutToAppear(): void {
    this.allProducts = this.getMockProducts()
    this.products = this.allProducts
  }

  getMockProducts(): ProductItem[] {
    let list: ProductItem[] = []
    let item1: ProductItem = { id: '1', name: 'HarmonyOS 入门', category: '书籍', price: 59, sales: 120 }
    let item2: ProductItem = { id: '2', name: '智能手表', category: '数码', price: 299, sales: 85 }
    let item3: ProductItem = { id: '3', name: '蓝牙耳机', category: '数码', price: 199, sales: 200 }
    let item4: ProductItem = { id: '4', name: 'ArkUI 实战', category: '书籍', price: 79, sales: 95 }
    list.push(item1)
    list.push(item2)
    list.push(item3)
    list.push(item4)
    return list
  }

  applyFilter(): void {
    let filtered: ProductItem[] = this.allProducts
    if (this.categoryIndex > 0) {
      let cat = this.categoryText
      filtered = filtered.filter((p: ProductItem): boolean => p.category === cat)
    }
    if (this.sortIndex === 1) {
      filtered.sort((a: ProductItem, b: ProductItem): number => a.price - b.price)
    } else if (this.sortIndex === 2) {
      filtered.sort((a: ProductItem, b: ProductItem): number => b.sales - a.sales)
    }
    this.products = filtered
  }

  build() {
    Column() {
      Row({ space: 12 }) {
        Select([
          { value: '全部分类' },
          { value: '书籍' },
          { value: '数码' }
        ])
          .selected(this.categoryIndex)
          .value(this.categoryText)
          .font({ size: 14, weight: 500 })
          .fontColor('#333')
          .optionFont({ size: 14, weight: 400 })
          .onSelect((index: number, value: string): void => {
            this.categoryIndex = index
            this.categoryText = value
            this.applyFilter()
          })

        Select([
          { value: '默认排序' },
          { value: '价格升序' },
          { value: '销量降序' }
        ])
          .selected(this.sortIndex)
          .value(this.sortText)
          .font({ size: 14, weight: 500 })
          .fontColor('#333')
          .optionFont({ size: 14, weight: 400 })
          .onSelect((index: number, value: string): void => {
            this.sortIndex = index
            this.sortText = value
            this.applyFilter()
          })
      }
      .width('100%')
      .padding({ left: 16, right: 16, top: 8, bottom: 8 })

      List({ space: 0 }) {
        ForEach(this.products, (item: ProductItem) => {
          ListItem() {
            Row() {
              Column() {
                Text(item.name)
                  .fontSize(16)
                  .fontWeight(FontWeight.Medium)
                Text(item.category)
                  .fontSize(12)
                  .fontColor('#999')
                  .margin({ top: 4 })
              }
              .alignItems(HorizontalAlign.Start)
              .layoutWeight(1)

              Column() {
                Text('¥' + item.price.toString())
                  .fontSize(16)
                  .fontColor('#FF6B00')
                Text('销量 ' + item.sales.toString())
                  .fontSize(12)
                  .fontColor('#999')
                  .margin({ top: 4 })
              }
              .alignItems(HorizontalAlign.End)
            }
            .width('100%')
            .padding(16)
          }
        })
      }
      .width('100%')
      .layoutWeight(1)
      .divider({ strokeWidth: 0.5, color: '#F0F0F0' })

      if (this.products.length === 0) {
        Text('暂无商品')
          .fontSize(14)
          .fontColor('#999')
          .margin({ top: 60 })
      }
    }
    .width('100%')
    .height('100%')
  }
}

interface ProductItem {
  id: string
  name: string
  category: string
  price: number
  sales: number
}
```

## 8. 反面示例

```typescript
// ❌ 没有 onSelect 回调，选了也不知道
Select([{ value: 'A' }, { value: 'B' }])

// ❌ 没有设置 selected 和 value，选中状态不可控
Select([{ value: 'A' }, { value: 'B' }])
  .onSelect((index: number) => {
    console.info('selected: ' + index)
  })

// ❌ 联动选择时没有重置子级 Select
Select(this.cityOptions)
  .onSelect((index: number, value: string) => {
    this.cityIndex = index
    this.districts = this.getDistricts(value)
    // 缺少: this.districtIndex = -1
    // 缺少: this.districtText = '选择区域'
  })

// ❌ 选项列表为空数组，下拉无内容
Select([])
  .value('请选择')

// ❌ SelectOption 的 value 使用了过长文本，没有设置 optionWidth
Select([{ value: '这是一个非常非常非常长的选项文本内容导致显示异常' }])
```

## 9. API 速查

| API | 说明 |
|-----|------|
| `Select(options: SelectOption[])` | 创建下拉选择，options 包含 value / icon |
| `.selected(index)` | 设置选中项索引，支持 $$ 双向绑定 |
| `.value(text)` | 设置按钮显示文本，支持 $$ 双向绑定 |
| `.font(Font)` | 下拉按钮文本样式 |
| `.fontColor(color)` | 下拉按钮文本颜色 |
| `.optionFont(Font)` | 菜单项文本样式 |
| `.optionFontColor(color)` | 菜单项文本颜色 |
| `.optionBgColor(color)` | 菜单项背景色 |
| `.selectedOptionFont(Font)` | 选中项文本样式 |
| `.selectedOptionFontColor(color)` | 选中项文本颜色 |
| `.selectedOptionBgColor(color)` | 选中项背景色 |
| `.optionWidth(Dimension)` | 菜单项宽度 |
| `.optionHeight(Dimension)` | 菜单显示最大高度 |
| `.space(Length)` | 文本与箭头间距，默认 8 |
| `.arrowPosition(ArrowPosition)` | 箭头位置：END（默认）/ START |
| `.menuAlign(MenuAlignType, offset?)` | 菜单对齐方式：START / CENTER / END |
| `.controlSize(ControlSize)` | 组件尺寸：SMALL / NORMAL |
| `.divider(DividerOptions \| null)` | 分割线样式，null 隐藏 |
| `.menuBackgroundColor(color)` | 菜单背景色 |
| `.menuBackgroundBlurStyle(BlurStyle)` | 菜单背景模糊效果 |
| `.onSelect(callback)` | 选中项时回调 (index, value) |

> **注意**：Select 选项数据变化后需要同步重置 `selected` 和 `value`，否则会出现选中状态与实际不一致的问题。
