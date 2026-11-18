import { fileIo } from '@kit.CoreFileKit';
import { util } from '@kit.ArkTS';
import { assetName, harLabel } from 'patchbridge';

@Entry
@Component
struct Index {
  @State raw: string = '';
  @State res: string = '';
  @State har: string = '';

  aboutToAppear(): void {
    const host = this.getUIContext().getHostContext()!;
    this.raw = util.TextDecoder.create('utf-8').decodeToString(host.resourceManager.getRawFileContentSync('deveco_resource_proof.txt'));
    this.res = fileIo.readTextSync(host.resourceDir + '/deveco_resource_proof.txt');
    this.har = util.TextDecoder.create('utf-8').decodeToString(host.resourceManager.getRawFileContentSync(assetName));
  }

  build() {
    Column() {
      Text(this.raw)
      Text(this.res)
      Text(this.har)
      Text(harLabel())
      Text('code-original')
    }.width('100%').height('100%').justifyContent(FlexAlign.Center)
  }
}
