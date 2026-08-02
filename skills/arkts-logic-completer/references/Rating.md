# Rating 组件功能逻辑规格

## 1. 功能定位

Rating 是评分组件，用于在给定范围内选择评分。当界面需要用户对内容进行星级评价或展示评分结果时使用。

## 2. 典型场景

- 商品/服务评价页的星级打分
- 评论列表中展示用户评分（只读指示器模式）
- 满意度调查中的评级选择
- 内容质量评价（文章、视频）

## 3. 状态声明

```typescript
// 当前评分值
@State rating: number = 0

// 指示器模式（只读展示）
@State isIndicator: boolean = false

// 评价提交状态
@State isSubmitted: boolean = false
```

## 4. 事件与交互逻辑

### onChange 核心事件

用户拖动或点击星级时触发 onChange：

```typescript
Rating({ rating: this.rating, indicator: false })
  .stars(5)
  .stepSize(0.5)
  .onChange((value: number): void => {
    this.rating = value
  })
```

### 指示器模式（只读）

```typescript
Rating({ rating: 4.5, indicator: true })
  .stars(5)
```

## 5. 数据结构

```typescript
interface ReviewItem {
  userName: string
  avatar: string
  rating: number
  comment: string
  date: string
}
```

## 6. 联动说明

- Rating 评分变化 → 更新提交按钮的可用状态（评分 > 0 时可提交）
- Rating 提交 → 显示感谢提示并切换为只读指示器模式
- 评论列表中 Rating 作为只读组件展示每条评价的分数
- Rating 值变化 → 联动显示评分文字描述（"很差 / 一般 / 不错 / 很好 / 非常好"）

## 7. 完整代码示例

```typescript
interface ReviewItem {
  userName: string
  rating: number
  comment: string
}

@Entry
@Component
struct ReviewPage {
  @State myRating: number = 0
  @State comment: string = ''
  @State isSubmitted: boolean = false
  @State reviews: ReviewItem[] = [
    { userName: '用户A', rating: 4.5, comment: '非常好用' },
    { userName: '用户B', rating: 3.0, comment: '还可以' }
  ]

  getRatingText(): string {
    if (this.myRating <= 1) return '很差'
    if (this.myRating <= 2) return '一般'
    if (this.myRating <= 3) return '不错'
    if (this.myRating <= 4) return '很好'
    return '非常好'
  }

  build() {
    Column({ space: 16 }) {
      Text('评价商品')
        .fontSize(20)
        .fontWeight(FontWeight.Bold)

      if (!this.isSubmitted) {
        Column({ space: 8 }) {
          Rating({ rating: this.myRating, indicator: false })
            .stars(5)
            .stepSize(0.5)
            .onChange((value: number): void => {
              this.myRating = value
            })

          if (this.myRating > 0) {
            Text(this.getRatingText())
              .fontSize(14)
              .fontColor('#FF8C00')
          }

          TextInput({ placeholder: '写下你的评价...', text: this.comment })
            .onChange((value: string): void => {
              this.comment = value
            })

          Button('提交评价')
            .width('100%')
            .enabled(this.myRating > 0)
            .onClick((): void => {
              this.reviews.push({
                userName: '我',
                rating: this.myRating,
                comment: this.comment
              })
              this.isSubmitted = true
            })
        }
        .padding(16)
      } else {
        Text('感谢你的评价！').fontColor('#52C41A').padding(16)
      }

      Divider()

      Text('用户评价').fontSize(16).fontWeight(FontWeight.Medium).padding({ left: 16 })

      ForEach(this.reviews, (review: ReviewItem) => {
        Column({ space: 4 }) {
          Row() {
            Text(review.userName).fontSize(14).fontWeight(FontWeight.Medium)
            Blank()
            Rating({ rating: review.rating, indicator: true })
              .stars(5)
          }
          .width('100%')

          Text(review.comment)
            .fontSize(13)
            .fontColor('#666666')
        }
        .width('100%')
        .padding(16)
      })
    }
  }
}
```

## 8. 反面示例

```typescript
// ❌ indicator 为 true 时用户无法操作评分，但绑定了 onChange
Rating({ rating: this.rating, indicator: true })
  .onChange((value: number) => { this.rating = value })

// ❌ 没有用 @State 管理评分值，拖动后 UI 不更新
let rating = 3
Rating({ rating: rating, indicator: false })

// ❌ 没有设置 stepSize，默认 0.5 可能不符合整数评分需求
Rating({ rating: this.rating, indicator: false })
  // 需要整数评分时应设置 .stepSize(1)

// ❌ 评分为 0 时就能提交，应校验
Button('提交')
  .onClick(() => { this.submit() })
```

## 9. API 速查

| API | 说明 |
|-----|------|
| `Rating({ rating: number, indicator?: boolean })` | 创建评分组件，rating 支持 $$ 双向绑定 |
| `.stars(number)` | 评分总数，默认 5 |
| `.stepSize(number)` | 评分步长，默认 0.5，范围 [0.1, stars] |
| `.starStyle({ backgroundUri, foregroundUri, secondaryUri })` | 自定义星级图片 |
| `.onChange((value: number) => void)` | 评分变化回调 |
| `indicator: true` | 只读指示器模式，不可交互 |
