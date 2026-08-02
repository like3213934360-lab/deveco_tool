# Swiper 组件功能逻辑规格

## 1. 功能定位

Swiper 是滑块视图容器组件，提供子组件滑动轮播显示的能力。当界面需要展示多张图片/卡片的横向滚动切换（轮播图、引导页、Tab 式卡片浏览）时使用。

## 2. 典型场景

- 首页广告/活动轮播图（自动播放 + 指示器）
- 新手引导页面（手动滑动 + 翻页按钮）
- 卡片式内容浏览（多个卡片横向滑动）
- 图片预览画廊（全屏滑动浏览）

## 3. 状态声明

```typescript
// 当前页索引
@State currentIndex: number = 0

// 轮播数据
@State bannerList: BannerItem[] = []

// 控制器
private swiperController: SwiperController = new SwiperController()

// 自动播放开关
@State autoPlay: boolean = true
```

## 4. 事件与交互逻辑

### onChange 核心事件

页面切换完成时触发：

```typescript
Swiper(this.swiperController) {
  ForEach(this.bannerList, (item: BannerItem) => {
    Image(item.imageUrl)
      .width('100%')
      .height(200)
      .objectFit(ImageFit.Cover)
      .borderRadius(8)
  })
}
.index($$this.currentIndex)
.autoPlay(this.autoPlay)
.interval(3000)
.loop(true)
.indicator(true)
.onChange((index: number): void => {
  this.currentIndex = index
})
```

### onAnimationStart / onAnimationEnd

动画开始和结束时触发，用于精细化控制过渡效果：

```typescript
Swiper(this.swiperController) {
  // ...children
}
.onAnimationStart((index: number, targetIndex: number): void => {
  console.info('从 ' + index + ' 到 ' + targetIndex)
})
.onAnimationEnd((index: number): void => {
  this.currentIndex = index
})
```

### 场景：手动翻页控制

```typescript
Row() {
  Button('上一页')
    .onClick((): void => {
      this.swiperController.showPrevious()
    })
  Text((this.currentIndex + 1) + ' / ' + this.bannerList.length)
    .fontSize(14)
    .margin({ left: 16, right: 16 })
  Button('下一页')
    .onClick((): void => {
      this.swiperController.showNext()
    })
}
```

### 场景：新手引导页（非循环 + 自定义导航）

```typescript
@State currentIndex: number = 0
@State guidePages: string[] = ['欢迎使用', '功能介绍', '开始体验']

Swiper() {
  ForEach(this.guidePages, (title: string) => {
    Column() {
      Text(title).fontSize(24).fontWeight(FontWeight.Bold)
    }
    .width('100%')
    .height('100%')
    .justifyContent(FlexAlign.Center)
  })
}
.index($$this.currentIndex)
.loop(false)
.autoPlay(false)
.indicator(
  new DotIndicator()
    .selectedColor('#0A59F7')
    .color('#CCCCCC')
)
```

## 5. 数据结构

```typescript
interface BannerItem {
  id: string
  imageUrl: ResourceStr
  title: string
  linkUrl: string
}

interface GuidePageConfig {
  title: string
  description: string
  image: ResourceStr
}

interface SwiperConfig {
  autoPlay: boolean
  interval: number
  loop: boolean
  duration: number
  vertical: boolean
  displayCount: number
}
```

## 6. 联动说明

- Swiper 翻页 → onChange 更新当前索引 → 底部指示器/页码同步更新
- 自动播放中用户手动滑动 → 暂停自动播放 → 松手后恢复
- 点击轮播图 → 根据当前 index 获取数据 → 跳转详情页
- 外部按钮点击 → controller.showNext() / showPrevious() 控制翻页
- 引导页最后一页 → 隐藏"下一页"按钮 → 显示"开始使用"按钮

## 7. 完整代码示例

```typescript
import { router } from '@kit.ArkUI'

@Entry
@Component
struct BannerPage {
  @State currentIndex: number = 0
  @State bannerList: BannerItem[] = []
  private swiperController: SwiperController = new SwiperController()

  aboutToAppear(): void {
    let b1: BannerItem = { id: '1', imageUrl: $r('app.media.banner1'), title: '新品发布', linkUrl: 'pages/Detail' }
    let b2: BannerItem = { id: '2', imageUrl: $r('app.media.banner2'), title: '限时特惠', linkUrl: 'pages/Detail' }
    let b3: BannerItem = { id: '3', imageUrl: $r('app.media.banner3'), title: '会员专享', linkUrl: 'pages/Detail' }
    this.bannerList.push(b1)
    this.bannerList.push(b2)
    this.bannerList.push(b3)
  }

  build() {
    Column() {
      Stack({ alignContent: Alignment.Bottom }) {
        Swiper(this.swiperController) {
          ForEach(this.bannerList, (item: BannerItem) => {
            Stack() {
              Image(item.imageUrl)
                .width('100%')
                .height(200)
                .objectFit(ImageFit.Cover)
                .borderRadius(12)

              Text(item.title)
                .fontSize(18)
                .fontColor(Color.White)
                .fontWeight(FontWeight.Bold)
                .padding(12)
            }
            .width('100%')
            .alignContent(Alignment.BottomStart)
            .onClick((): void => {
              router.pushUrl({
                url: item.linkUrl,
                params: { id: item.id }
              })
            })
          })
        }
        .index($$this.currentIndex)
        .autoPlay(true)
        .interval(4000)
        .duration(300)
        .loop(true)
        .cachedCount(1)
        .indicator(
          new DotIndicator()
            .selectedColor(Color.White)
            .color('rgba(255,255,255,0.5)')
            .selectedItemWidth(20)
            .selectedItemHeight(4)
            .itemWidth(8)
            .itemHeight(4)
        )
        .onChange((index: number): void => {
          this.currentIndex = index
        })
      }
      .width('100%')
      .padding({ left: 16, right: 16 })

      Text('当前第 ' + (this.currentIndex + 1) + ' 张 / 共 ' + this.bannerList.length + ' 张')
        .fontSize(12)
        .fontColor('#999')
        .margin({ top: 8 })

      Row({ space: 12 }) {
        Button('上一张')
          .fontSize(14)
          .onClick((): void => {
            this.swiperController.showPrevious()
          })
        Button('下一张')
          .fontSize(14)
          .onClick((): void => {
            this.swiperController.showNext()
          })
      }
      .margin({ top: 16 })

      Text('推荐列表')
        .fontSize(18)
        .fontWeight(FontWeight.Bold)
        .width('100%')
        .margin({ top: 24, bottom: 12 })
        .padding({ left: 16 })

      List() {
        ForEach(this.bannerList, (item: BannerItem) => {
          ListItem() {
            Text(item.title)
              .fontSize(16)
              .padding(16)
              .width('100%')
          }
        })
      }
      .width('100%')
      .layoutWeight(1)
      .divider({ strokeWidth: 0.5, color: '#F0F0F0' })
    }
    .width('100%')
    .height('100%')
    .padding({ top: 16 })
  }
}

interface BannerItem {
  id: string
  imageUrl: ResourceStr
  title: string
  linkUrl: string
}
```

## 8. 反面示例

```typescript
// ❌ 没有设置 loop 和 autoPlay，轮播图不会自动播放
Swiper() {
  // ...
}

// ❌ 没有 onChange，外部无法获知当前页码
Swiper() {
  // ...
}
.autoPlay(true)
.loop(true)

// ❌ interval 设置过短，用户来不及阅读
Swiper() {
  // ...
}
.autoPlay(true)
.interval(500)  // 0.5秒一切换，太快了

// ❌ displayCount 超过子组件数量
Swiper() {
  Image(...)
  Image(...)
}
.displayCount(5)  // 只有2个子组件，设置5个显示没有意义

// ❌ 轮播图没有设置点击事件，点了没反应
Swiper() {
  ForEach(this.banners, (item: BannerItem) => {
    Image(item.imageUrl)  // 缺少 onClick 跳转
  })
}
```

## 9. API 速查

| API | 说明 |
|-----|------|
| `Swiper(controller?)` | 创建轮播容器 |
| `.index(number)` | 当前页索引，支持 $$ 双向绑定 |
| `.autoPlay(boolean)` | 是否自动播放 |
| `.interval(number)` | 自动播放间隔（毫秒），默认 3000 |
| `.duration(number)` | 切换动画时长（毫秒），默认 400 |
| `.loop(boolean)` | 是否循环，默认 true |
| `.vertical(boolean)` | 是否纵向滑动，默认 false |
| `.displayCount(number \| string)` | 一页显示几个子组件，'auto' 自适应 |
| `.displayMode(SwiperDisplayMode)` | 子组件主轴方向尺寸：STRETCH / AUTO_LINEAR |
| `.cachedCount(number)` | 预加载子组件个数 |
| `.disableSwipe(boolean)` | 禁止手势滑动 |
| `.curve(Curve \| string)` | 动画曲线 |
| `.indicator(DotIndicator \| DigitIndicator \| boolean)` | 导航点样式 |
| `.displayArrow(boolean \| ArrowStyle)` | 导航箭头 |
| `.nestedScroll(SwiperNestedScrollMode)` | 嵌套滚动模式 |
| `.onChange(callback)` | 页面切换完成回调 (index) |
| `.onAnimationStart(callback)` | 切换动画开始回调 (index, targetIndex) |
| `.onAnimationEnd(callback)` | 切换动画结束回调 (index) |
| `.onGestureSwipe(callback)` | 手势滑动中回调 |
| `controller.showNext()` | 翻至下一页 |
| `controller.showPrevious()` | 翻至上一页 |
| `controller.changeIndex(index, useAnimation?)` | 跳转到指定页 |
| `controller.finishAnimation(callback?)` | 停止播放动画 |
| `DotIndicator` | 圆点指示器（selectedColor / color / itemWidth / itemHeight 等） |
| `DigitIndicator` | 数字指示器 |
