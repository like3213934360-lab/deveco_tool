// HdsTabsPage.ets - 组件平替示例
// 演示如何将标准Tabs组件替换为HdsTabs组件，并配置6.1新特性
import { HdsTabs, HdsTabsController, DividerMode, hdsMaterial } from '@kit.UIDesignKit';
import { SymbolGlyphModifier } from '@kit.ArkUI';

@Entry
@ComponentV2
struct HdsTabsPage {
  @Local currentIndex: number = 0;
  private tabsController: HdsTabsController = new HdsTabsController();

  build() {
    HdsTabs({ index: this.currentIndex, controller: this.tabsController }) {
      TabContent() {
        // 首页
        this.TabPageBuilder('首页')
      }
      .tabBar(new BottomTabBarStyle({
        normal: new SymbolGlyphModifier($r('sys.symbol.house_fill')),
      }, '首页'))

      TabContent() {
        // 发现
        this.TabPageBuilder('发现')
      }
      .tabBar(new BottomTabBarStyle({
        normal: new SymbolGlyphModifier($r('sys.symbol.compass_fill')),
      }, '发现'))

      TabContent() {
        // 消息
        this.TabPageBuilder('消息')
      }
      .tabBar(new BottomTabBarStyle({
        normal: new SymbolGlyphModifier($r('sys.symbol.message_fill')),
      }, '消息'))

      TabContent() {
        // 我的
        this.TabPageBuilder('我的')
      }
      .tabBar(new BottomTabBarStyle({
        normal: new SymbolGlyphModifier($r('sys.symbol.person_fill')),
      }, '我的'))
    }
    .key('HdsTabsPage')
    .width('100%')
    .height('100%')
    .barPosition(BarPosition.End)
    .barHeight(56)
    .barOverlap(true)
    // 添加HDS特有的分割线样式 - 跟手渐变显隐
    .divider({
      mode: DividerMode.FOLLOW_SCROLL,
      style: {
        strokeWidth: 0.5,
        color: 0x1A000000
      }
    })
    // 6.1新特性：悬浮页签栏配置（使用默认宽度）
    .barFloatingStyle({
      barSideMargin: 10,
      barBottomMargin: 28,
      gradientMask: { maskColor: '#66F1F3F5', maskHeight: 92 },
      // 6.1新特性：材质效果配置
      systemMaterialEffect: {
        materialType: hdsMaterial.MaterialType.IMMERSIVE,
        materialLevel: hdsMaterial.MaterialLevel.ADAPTIVE
      }
    })
    .onChange((index: number) => {
      this.currentIndex = index;
    })
  }

  @Builder
  TabPageBuilder(title: string) {
    Scroll() {
      Column() {
        Blank().height(100)

        Text(`${title}内容`)
          .fontSize(24)
          .fontWeight(FontWeight.Bold)
          .margin({ bottom: 20 })

        Text('这里是页面内容...')
          .fontSize(16)
          .lineHeight(28)

        ForEach([1, 2, 3, 4, 5, 6, 7, 8, 9, 10], (item: number) => {
          Text(`段落 ${item}`)
            .fontSize(16)
            .lineHeight(28)
            .margin({ top: 10 })
        })
      }
      .width('100%')
      .padding({ left: 20, right: 20 })
    }
    .width('100%')
    .layoutWeight(1)
    .width('100%')
    .height('100%')
    .backgroundColor('#F5F5F5')
  }
}