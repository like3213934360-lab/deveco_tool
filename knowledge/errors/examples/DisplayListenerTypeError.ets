import { display } from '@kit.ArkUI';

export function observeDisplayChanges(callback: (id: number) => void): () => void {
  display.on('change', callback);
  return (): void => { display.off('change', callback); };
}
export function observeAvailableArea(current: display.Display,
  callback: (area: display.Rect) => void): () => void {
  current.on('availableAreaChange', callback);
  return (): void => { current.off('availableAreaChange', callback); };
}
