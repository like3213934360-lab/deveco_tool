import nativeEntry from 'libentry.so';

@Entry
@Component
struct Index {
  @State result: string = 'Native C++';

  build() {
    Column({ space: 16 }) {
      Text(this.result).id('NativeResult')
      Button('Add 2 + 3').id('NativeAdd').onClick(() => {
        this.result = `Result: ${nativeEntry.add(2, 3)}`;
      })
    }
    .justifyContent(FlexAlign.Center)
    .width('100%')
    .height('100%')
  }
}
