@Entry
@Component
struct Index {
  @State pinch: string = 'idle';
  @State rotation: string = 'idle';

  build() {
    Column({space: 16}) {
      Text('pinch:' + this.pinch)
        .id('PinchSurface').width('90%').height(180).textAlign(TextAlign.Center)
        .backgroundColor('#DDDDFF')
        .gesture(PinchGesture({ fingers: 2, distance: 8 }).onActionUpdate((event: GestureEvent) => {
          this.pinch = event.scale > 1 ? 'larger' : 'smaller';
        }))
      Text('rotation:' + this.rotation)
        .id('RotateSurface').width('90%').height(180).textAlign(TextAlign.Center)
        .backgroundColor('#DDFFDD')
        .gesture(RotationGesture({ fingers: 2, angle: 5 }).onActionUpdate((event: GestureEvent) => {
          this.rotation = event.angle > 0 ? 'clockwise' : 'counterclockwise';
        }))
    }.width('100%').height('100%').justifyContent(FlexAlign.Center)
  }
}
