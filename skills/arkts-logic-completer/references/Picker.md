# Picker 选择器功能逻辑规格

## 1. 功能定位

Picker 是滑动选择器组件，包含 DatePicker（日期选择）和 TextPicker（文本/图文选择），通过上下滑动滚轮的方式从预设列表中选取值。当需要用户从有限且有序的选项集中选择时使用。

## 2. 典型场景

- 生日/日期选择（注册表单、日程设置）
- 年月选择（账单筛选、报表查询）
- 省市区三级联动选择（收货地址）
- 单列选项选择（性别、学历、职业）
- 多列非联动选择（时间段选择：时 + 分）

## 3. 状态声明

```typescript
// DatePicker
@State selectedDate: Date = new Date()
@State isLunar: boolean = false

// TextPicker 单列
@State selectedFruit: string = 'apple'
@State selectedIndex: number = 0

// TextPicker 多列联动（省市区）
@State addressIndex: number[] = [0, 0, 0]
@State addressText: string[] = ['', '', '']
```

## 4. 事件与交互逻辑

### 场景一：DatePicker 日期选择

```typescript
@State selectedDate: Date = new Date('2025-01-15')

DatePicker({
  start: new Date('1970-1-1'),
  end: new Date('2100-12-31'),
  selected: this.selectedDate
})
  .onDateChange((value: Date): void => {
    this.selectedDate = value
    console.info('selected: ' + value.toString())
  })
```

### 场景二：DatePicker 年月选择（API 18+）

```typescript
DatePicker({
  start: new Date('2020-1-1'),
  end: new Date('2030-12-31'),
  selected: this.selectedDate,
  mode: DatePickerMode.YEAR_AND_MONTH
})
  .onDateChange((value: Date): void => {
    this.selectedDate = value
  })
```

### 场景三：TextPicker 单列选择

```typescript
private fruits: string[] = ['苹果', '橘子', '桃子', '葡萄', '西瓜']

TextPicker({ range: this.fruits, selected: this.selectedIndex })
  .onChange((value: string | string[], index: number | number[]): void => {
    this.selectedFruit = value as string
    this.selectedIndex = index as number
  })
```

### 场景四：TextPicker 多列联动（省市区）

```typescript
private addressData: TextCascadePickerRangeContent[] = [
  {
    text: '北京市',
    children: [
      { text: '东城区' },
      { text: '西城区' },
      { text: '朝阳区' }
    ]
  },
  {
    text: '上海市',
    children: [
      { text: '黄浦区' },
      { text: '静安区' },
      { text: '浦东新区' }
    ]
  }
]

TextPicker({ range: this.addressData })
  .onChange((value: string | string[], index: number | number[]): void => {
    this.addressText = value as string[]
    this.addressIndex = index as number[]
  })
```

## 5. 数据结构

```typescript
interface DatePickerConfig {
  start: Date
  end: Date
  selected: Date
  mode?: DatePickerMode
}

interface TextPickerConfig {
  range: string[] | string[][] | TextCascadePickerRangeContent[]
  selected?: number | number[]
  value?: string | string[]
}

interface TextCascadePickerRangeContent {
  text: string
  children?: TextCascadePickerRangeContent[]
}

interface PickerTextStyle {
  color?: ResourceColor
  font?: {
    size?: number | string
    weight?: FontWeight
    family?: string
    style?: FontStyle
  }
}
```

## 6. 联动说明

- DatePicker 选择日期 → 关联表单字段更新（如出发日期、截止日期）
- 出发日期 > 到达日期 → 自动校正到达日期
- TextPicker 省份变化 → 城市列表联动更新（cascade 模式自动处理）
- 选择结果回显到输入框或标签中
- 切换公历/农历 → DatePicker 的 lunar 属性联动变化

## 7. 完整代码示例

```typescript
interface FormData {
  birthday: string
  city: string
  education: string
}

@Entry
@Component
struct PickerDemoPage {
  @State birthday: Date = new Date('2000-06-15')
  @State birthdayText: string = '2000-06-15'
  @State educationIndex: number = 0
  @State educationText: string = '本科'
  @State cityText: string[] = ['北京市', '东城区']
  @State isLunar: boolean = false

  private educationList: string[] = ['高中', '专科', '本科', '硕士', '博士']
  private cityData: TextCascadePickerRangeContent[] = [
    {
      text: '北京市',
      children: [
        { text: '东城区' }, { text: '西城区' }, { text: '朝阳区' }, { text: '海淀区' }
      ]
    },
    {
      text: '上海市',
      children: [
        { text: '黄浦区' }, { text: '静安区' }, { text: '浦东新区' }, { text: '徐汇区' }
      ]
    },
    {
      text: '广州市',
      children: [
        { text: '天河区' }, { text: '越秀区' }, { text: '白云区' }
      ]
    }
  ]

  formatDate(d: Date): string {
    const y = d.getFullYear()
    const m = d.getMonth() + 1
    const day = d.getDate()
    return `${y}-${m < 10 ? '0' + m : m}-${day < 10 ? '0' + day : day}`
  }

  build() {
    Column({ space: 20 }) {
      Text('个人信息填写')
        .fontSize(24)
        .fontWeight(FontWeight.Bold)

      // 生日选择
      Text('出生日期：' + this.birthdayText).fontSize(16)
      DatePicker({
        start: new Date('1950-1-1'),
        end: new Date('2010-12-31'),
        selected: this.birthday
      })
        .lunar(this.isLunar)
        .disappearTextStyle({ color: Color.Gray, font: { size: '14fp', weight: FontWeight.Regular } })
        .textStyle({ color: '#ff182431', font: { size: '16fp', weight: FontWeight.Regular } })
        .selectedTextStyle({ color: '#ff007dff', font: { size: '20fp', weight: FontWeight.Medium } })
        .onDateChange((value: Date): void => {
          this.birthday = value
          this.birthdayText = this.formatDate(value)
        })

      Row({ space: 8 }) {
        Text('农历').fontSize(14)
        Toggle({ type: ToggleType.Switch, isOn: this.isLunar })
          .onChange((isOn: boolean): void => {
            this.isLunar = isOn
          })
      }

      // 学历选择
      Text('学历：' + this.educationText).fontSize(16)
      TextPicker({ range: this.educationList, selected: this.educationIndex })
        .canLoop(false)
        .onChange((value: string | string[], index: number | number[]): void => {
          this.educationText = value as string
          this.educationIndex = index as number
        })

      // 城市选择（联动）
      Text('城市：' + this.cityText.join(' ')).fontSize(16)
      TextPicker({ range: this.cityData })
        .onChange((value: string | string[], index: number | number[]): void => {
          this.cityText = value as string[]
        })
    }
    .width('100%')
    .padding(24)
  }
}
```

## 8. 反面示例

```typescript
// ❌ DatePicker 起始日期晚于结束日期，会被重置为默认值
DatePicker({
  start: new Date('2100-1-1'),
  end: new Date('1970-1-1'),
  selected: new Date()
})

// ❌ TextPicker range 设置为空数组，不会显示
TextPicker({ range: [] })

// ❌ onChange 中没有区分单列和多列返回值的类型
TextPicker({ range: [['A', 'B'], ['C', 'D']] })
  .onChange((value: string | string[], index: number | number[]): void => {
    console.info(value)  // 多列时 value 是 string[]，直接当 string 使用会出错
  })

// ❌ 在滑动动效过程中修改属性数据导致不生效
// 不要在 onChange 回调中修改 DatePickerOptions 的 start/end

// ❌ TextPicker 的 range 类型运行时动态切换（如从 string[] 变为 string[][]）
// range 的类型及列数不可动态修改
```

## 9. API 速查

| API | 说明 |
|-----|------|
| `DatePicker(options?: DatePickerOptions)` | 创建日期选择器 |
| `DatePickerOptions.start / end / selected` | 起始日期 / 结束日期 / 选中日期 |
| `DatePickerMode.DATE / YEAR_AND_MONTH / MONTH_AND_DAY` | 日期展示模式（API 18+） |
| `.lunar(boolean)` | 是否显示农历 |
| `.onDateChange(callback: Callback<Date>)` | 日期变化回调（API 10+） |
| `.canLoop(boolean)` | 是否循环滚动（API 20+） |
| `TextPicker(options?: TextPickerOptions)` | 创建文本选择器 |
| `TextPickerOptions.range` | 选择列表：string[] / string[][] / TextCascadePickerRangeContent[] |
| `TextPickerOptions.selected` | 选中项索引：number / number[] |
| `.onChange(callback)` | 选中项变化回调 |
| `.canLoop(boolean)` | 是否循环滚动（API 10+） |
| `.selectedIndex(number \| number[])` | 设置选中项索引（API 10+） |
| `.divider(DividerOptions \| null)` | 分割线样式（API 12+） |
| `.disappearTextStyle(PickerTextStyle)` | 边缘项文本样式（API 10+） |
| `.textStyle(PickerTextStyle)` | 待选项文本样式（API 10+） |
| `.selectedTextStyle(PickerTextStyle)` | 选中项文本样式（API 10+） |
| `.defaultPickerItemHeight(number \| string)` | 选项高度 |
| `.gradientHeight(Dimension)` | 渐隐效果高度（API 12+） |

> **注意**：DatePicker 的日期范围为 [1900-01-31, 2100-12-31]。TextPicker 的 range 类型一旦确定不可动态切换。多列联动使用 TextCascadePickerRangeContent[]。
