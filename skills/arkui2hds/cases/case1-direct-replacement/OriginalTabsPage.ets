// OriginalTabsPage.ets
// Tabs 是原生组件，不需要导入

@Entry
@ComponentV2
struct OriginalTabsPage {
  @Local currentIndex: number = 0;

  build() {
    Tabs({ index: this.currentIndex }) {
      TabContent() {
        Column() {
          Text('首页')
            .fontSize(24)
            .fontWeight(FontWeight.Bold)
        }
        .width('100%')
        .height('100%')
        .justifyContent(FlexAlign.Center)
      }
      .tabBar(this.TabBuilder(0, '首页', $r('sys.symbol.house_fill')))

      TabContent() {
        Column() {
          Text('发现')
            .fontSize(24)
            .fontWeight(FontWeight.Bold)
        }
        .width('100%')
        .height('100%')
        .justifyContent(FlexAlign.Center)
      }
      .tabBar(this.TabBuilder(1, '发现', $r('sys.symbol.compass_fill')))

      TabContent() {
        Column() {
          Text('消息')
            .fontSize(24)
            .fontWeight(FontWeight.Bold)
        }
        .width('100%')
        .height('100%')
        .justifyContent(FlexAlign.Center)
      }
      .tabBar(this.TabBuilder(2, '消息', $r('sys.symbol.message_fill')))

      TabContent() {
        Column() {
          Text('我的')
            .fontSize(24)
            .fontWeight(FontWeight.Bold)
        }
        .width('100%')
        .height('100%')
        .justifyContent(FlexAlign.Center)
      }
      .tabBar(this.TabBuilder(3, '我的', $r('sys.symbol.person_fill')))
    }
    .width('100%')
    .height('100%')
    .barPosition(BarPosition.End)
    .onChange((index: number) => {
      this.currentIndex = index;
    })
  }

  @Builder
  TabBuilder(index: number, title: string, icon: Resource) {
    Column() {
      Image(icon)
        .width(24)
        .height(24)
        .fillColor(this.currentIndex === index ? '#007DFF' : '#999999')

      Text(title)
        .fontSize(12)
        .fontColor(this.currentIndex === index ? '#007DFF' : '#999999')
        .margin({ top: 4 })
    }
    .width('100%')
    .height(50)
    .justifyContent(FlexAlign.Center)
  }
}