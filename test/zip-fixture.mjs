// Small stored ZIP fixture, without a platform-specific zip executable.
import { crc32 } from "node:zlib";
export function zipFixture(entries) {
  const local = [], central = []; let offset = 0;
  for (const [name, value] of Object.entries(entries)) {
    const filename = Buffer.from(name), bytes = Buffer.from(value), crc = crc32(bytes);
    const header = Buffer.alloc(30); header.writeUInt32LE(0x04034b50); header.writeUInt16LE(20, 4);
    header.writeUInt32LE(crc, 14); header.writeUInt32LE(bytes.length, 18); header.writeUInt32LE(bytes.length, 22); header.writeUInt16LE(filename.length, 26);
    local.push(header, filename, bytes);
    const item = Buffer.alloc(46); item.writeUInt32LE(0x02014b50); item.writeUInt16LE(20, 4); item.writeUInt16LE(20, 6);
    item.writeUInt32LE(crc, 16); item.writeUInt32LE(bytes.length, 20); item.writeUInt32LE(bytes.length, 24); item.writeUInt16LE(filename.length, 28); item.writeUInt32LE(offset, 42);
    central.push(item, filename); offset += header.length + filename.length + bytes.length;
  }
  const directory = Buffer.concat(central), end = Buffer.alloc(22); end.writeUInt32LE(0x06054b50);
  end.writeUInt16LE(Object.keys(entries).length, 8); end.writeUInt16LE(Object.keys(entries).length, 10);
  end.writeUInt32LE(directory.length, 12); end.writeUInt32LE(offset, 16);
  return Buffer.concat([...local, directory, end]);
}
