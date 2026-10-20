import { common, Want } from '@kit.AbilityKit';
import { fileIo } from '@kit.CoreFileKit';

interface ControlMarkerParameters {
  devecoControlsMarker?: string;
}

// Call only from the dedicated test UIAbility.onCreate; this pre-check is not atomic O_EXCL.
export function createControlMarkers(context: common.UIAbilityContext, want: Want): void {
  const parameters = want.parameters as ControlMarkerParameters | undefined;
  const name = parameters?.devecoControlsMarker;
  if (name === undefined) return;
  if (typeof name !== 'string' || !/^deveco-controls-[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\.txt$/.test(name)) throw new Error('Invalid control marker name');
  const paths: string[] = [`${context.cacheDir}/${name}`, `${context.filesDir}/${name}`];
  for (const path of paths) {
    if (fileIo.accessSync(path)) throw new Error('Control marker already exists');
  }
  for (const path of paths) {
    const file = fileIo.openSync(path, fileIo.OpenMode.WRITE_ONLY | fileIo.OpenMode.CREATE | fileIo.OpenMode.NOFOLLOW);
    try {
      if (fileIo.writeSync(file.fd, `${name}\n`) !== name.length + 1) throw new Error('Incomplete control marker write');
    } finally { fileIo.closeSync(file); }
  }
}
