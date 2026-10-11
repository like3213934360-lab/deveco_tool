// Test page for ui act: every gesture updates a visible label so each action is observable.
@Entry
@Component
struct Index {
  @State message: string = 'Hello World';
  @State taps: number = 0;
  @State doubles: number = 0;
  @State longs: number = 0;
  @State swipe: string = 'none';
  @State dragged: number = 0;
  @State typed: string = '';
  @State rows: number[] = Array.from<number, number>({ length: 60 }, (_: number, i: number) => i);

  build() {
    Column({ space: 8 }) {
      Text(this.message).id('HelloWorld').fontSize(28)
        .onClick(() => { this.message = 'Welcome'; })
      Text(`taps:${this.taps}`).id('TapBox').width('90%').height(56).backgroundColor('#DDEEFF')
        .gesture(TapGesture({ count: 1 }).onAction(() => { this.taps++; }))
      Text(`doubles:${this.doubles}`).id('DoubleBox').width('90%').height(56).backgroundColor('#E0FFE0')
        .gesture(TapGesture({ count: 2 }).onAction(() => { this.doubles++; }))
      Text(`longs:${this.longs}`).id('LongBox').width('90%').height(56).backgroundColor('#FFF0D0')
        .gesture(LongPressGesture({ repeat: false }).onAction(() => { this.longs++; }))
      Text(`swipe:${this.swipe}`).id('SwipeBox').width('90%').height(56).backgroundColor('#F0E0FF')
        .gesture(PanGesture({ direction: PanDirection.Horizontal, distance: 40 }).onActionEnd((e: GestureEvent) => {
          this.swipe = e.offsetX > 0 ? 'right' : 'left';
        }))
      Text(`dragged:${this.dragged}`).id('DragBox').width('90%').height(56).backgroundColor('#FFE0E0')
        .gesture(GestureGroup(GestureMode.Sequence,
          LongPressGesture({ repeat: false }),
          PanGesture({ direction: PanDirection.Vertical, distance: 30 }).onActionEnd(() => { this.dragged++; })))
      TextInput({ placeholder: 'type here', text: this.typed }).id('Field').width('90%')
        .onChange((v: string) => { this.typed = v; })
      Text(`typed:${this.typed}`).id('Echo')
      List() {
        ForEach(this.rows, (i: number) => {
          ListItem() { Text(`row ${i}`).id(`row${i}`).height(48) }
        }, (i: number) => `${i}`)
      }.id('Rows').height(360).width('90%')
    }
    .width('100%').height('100%').padding({ top: 40 })
  }
}
