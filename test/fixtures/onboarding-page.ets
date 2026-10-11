// Real UI evidence: defaults survive setup; the next business action runs exactly once.
@Entry
@ComponentV2
struct Index {
  @Local stage: number = 0;
  @Local theme: string = 'system';
  @Local orders: number = 0;

  build() {
    Column({ space: 24 }) {
      if (this.stage === 0) {
        Text('欢迎使用示例工具').fontSize(28)
        Button('开始使用').onClick(() => { this.stage = 1; })
      } else if (this.stage === 1) {
        Text('请选择应用主题').fontSize(28)
        Row() {
          Radio({ value: 'system', group: 'theme' }).checked(this.theme === 'system')
            .accessibilityText('跟随系统').onChange((checked: boolean) => { if (checked) this.theme = 'system'; })
          Text('跟随系统')
          Radio({ value: 'dark', group: 'theme' }).checked(this.theme === 'dark')
            .accessibilityText('深色').onChange((checked: boolean) => { if (checked) this.theme = 'dark'; })
          Text('深色')
        }
        Button('下一步').onClick(() => { this.stage = 2; })
      } else if (this.stage === 2) {
        Text('新功能介绍').fontSize(28)
        Button('下一步').onClick(() => { this.stage = 3; })
        Button('跳过介绍').onClick(() => { this.stage = 3; })
      } else if (this.stage === 3) {
        Text(`ready;theme:${this.theme}`).id('Ready')
        Button('进入订单').id('Business').onClick(() => { this.stage = 4; })
      } else {
        Text('订单信息').fontSize(28)
        Text(`orders:${this.orders};theme:${this.theme}`).id('Result')
        Button('下一步').onClick(() => { this.orders++; })
      }
    }.width('100%').height('100%').padding({ top: 80 })
  }
}
