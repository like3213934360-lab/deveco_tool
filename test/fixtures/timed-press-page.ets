@Entry
@Component
struct Index {
  @State receipt: string = 'idle';
  private downAt: number = 0;
  private released: number = 0;

  build() {
    Column() {
      Text('Hold here').id('HoldTarget').width('80%').height(100).backgroundColor('#DDEEFF')
        .onTouch((event: TouchEvent) => {
          if (event.type === TouchType.Down) {
            this.downAt = Date.now();
            this.receipt = 'down';
          } else if (event.type === TouchType.Up && this.downAt) {
            this.released++;
            this.receipt = `released:${this.released}:${Date.now() - this.downAt}`;
            this.downAt = 0;
          } else if (event.type === TouchType.Cancel) {
            this.receipt = 'cancelled';
            this.downAt = 0;
          }
        })
      Text(this.receipt).id('HoldReceipt')
    }.width('100%').height('100%').justifyContent(FlexAlign.Center)
  }
}
