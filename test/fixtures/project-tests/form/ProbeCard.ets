@Entry
@Component
struct ProbeCard {
  @LocalStorageProp('message') message: string = 'Card loading';
  build() {
    Column({ space: 12 }) {
      Text('MCP Form Probe').fontSize(18).fontColor('#112233')
      Text(this.message).fontSize(16).fontColor('#112233')
      Text('Refresh').fontSize(16).fontColor('#0044CC').onClick(() => {
        postCardAction(this, { action: 'message', params: { operation: 'refresh' } });
      })
    }.width('100%').height('100%').justifyContent(FlexAlign.Center).backgroundColor('#E2F0FF')
  }
}
