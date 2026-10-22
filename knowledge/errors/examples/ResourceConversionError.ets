import { common } from '@kit.AbilityKit';

export async function readString(context: common.Context | undefined, id: number): Promise<string> {
  if (context === undefined) {
    throw new Error('Context is unavailable');
  }
  return await context.resourceManager.getString(id);
}
export function readNumber(context: common.Context | undefined, id: number): number {
  if (context === undefined) {
    throw new Error('Context is unavailable');
  }
  return context.resourceManager.getNumber(id);
}
export async function readStringByName(context: common.Context, name: string): Promise<string> {
  return await context.resourceManager.getStringByName(name);
}

@Entry
@Component
struct ResourceConversionExample {
  @State text: string = '';
  async aboutToAppear(): Promise<void> {
    try {
      this.text = await readString(this.getUIContext().getHostContext(), $r('app.string.app_name').id);
    } catch (error) {
      this.text = `读取失败: ${String(error)}`;
    }
  }
  build() {
    Column() {
      Text($r('app.string.app_name'))
      Text(this.text)
    }
  }
}
