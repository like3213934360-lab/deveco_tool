@Entry
@Component
struct ScrollExample {
  @State offsetY: number = 0;
  build() {
    Column() {
      Text(`本次纵向滚动量: ${this.offsetY}`)
      Scroll() {
        Column() {
          Text('顶部')
          Blank().height(1000)
          Text('底部')
        }
      }
      .height(300)
      .onDidScroll((_xOffset: number, yOffset: number) => {
        this.offsetY = yOffset;
      })
    }
  }
}
