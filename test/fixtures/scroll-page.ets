@Entry
@Component
struct Index {
  @State rows: number[] = Array.from<number, number>({ length: 60 }, (_: number, i: number) => i);

  build() {
    Column({ space: 10 }) {
      Text('Scroll proof')
      List() {
        ForEach(this.rows, (i: number) => {
          ListItem() { Text(`row ${i}`).id(`row${i}`).height(40) }
        }, (i: number) => `${i}`)
      }.id('Rows').width('80%').height('55%')
      List() {
        ForEach(this.rows.slice(0, 24), (i: number) => {
          ListItem() {
            Text(`tile ${i}`).id(`tile${i}`).accessibilityDescription(`tile description ${i}`).width(100).height(44)
          }
        }, (i: number) => `${i}`)
      }.id('Tiles').width('80%').height(50).listDirection(Axis.Horizontal)
      List() {
        ListItem() { Text('short pane one').width(170) }
        ListItem() { Text('short pane two').width(170) }
      }.id('ShortList').width('60%').height(25).listDirection(Axis.Horizontal)
      Text('Unchanged footer')
    }.width('100%').height('100%').justifyContent(FlexAlign.Center)
  }
}
