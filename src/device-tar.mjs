/**
 * @file Minimal POSIX ustar reader, enough to unpack what `tar cf` writes on the device.
 * @author deveco-tool
 *
 * `ui_observe` has the device bundle a JPEG, a layout dump and both commands' logs into one archive
 * so a single `file recv` brings the whole observation back. Node ships no tar reader and this pack
 * takes no dependency it does not have to -- the dependency list is provenance-tracked and carries a
 * written security rationale -- so the ~100 lines live here instead.
 *
 * This reads; it never writes archives, and it only has to understand what toybox tar 0.8.12 emits.
 * Anything it does not recognise is an error rather than a guess: a silently mis-parsed archive
 * would hand the caller a screenshot that is really half a JSON file.
 */

const BLOCK = 512;

const NAME_OFFSET = 0;
const NAME_LENGTH = 100;
const SIZE_OFFSET = 124;
const SIZE_LENGTH = 12;
const CHECKSUM_OFFSET = 148;
const CHECKSUM_LENGTH = 8;
const TYPEFLAG_OFFSET = 156;
const MAGIC_OFFSET = 257;
const PREFIX_OFFSET = 345;
const PREFIX_LENGTH = 155;

function fail(message, code = "TAR_INVALID") {
  const error = new Error(message);
  error.code = code;
  throw error;
}

/** Header strings are NUL-padded, and toybox pads some fields with spaces as well. */
function readString(block, offset, length) {
  const raw = block.subarray(offset, offset + length);
  const end = raw.indexOf(0);
  return raw.subarray(0, end === -1 ? raw.length : end).toString("utf8").replace(/\0+$/, "");
}

/**
 * Numeric header fields are octal ASCII, terminated by a NUL or a space.
 *
 * @param {Buffer} block One 512-byte header.
 * @param {number} offset Field start.
 * @param {number} length Field width.
 * @returns {number} Parsed value.
 */
function readOctal(block, offset, length) {
  const text = readString(block, offset, length).trim();
  if (!text) return 0;
  if (!/^[0-7]+$/.test(text)) fail(`tar header field at ${offset} is not octal: ${JSON.stringify(text)}`);
  return Number.parseInt(text, 8);
}

/**
 * The header checksum is the sum of every header byte with the checksum field itself read as
 * spaces. Verifying it is what separates "this is a tar" from "this is whatever the device wrote
 * into the file when the command failed".
 *
 * @param {Buffer} block One 512-byte header.
 * @returns {boolean} True when the stored checksum matches.
 */
function checksumMatches(block) {
  let sum = 0;
  for (let i = 0; i < BLOCK; i += 1) {
    const inChecksumField = i >= CHECKSUM_OFFSET && i < CHECKSUM_OFFSET + CHECKSUM_LENGTH;
    sum += inChecksumField ? 0x20 : block[i];
  }
  return sum === readOctal(block, CHECKSUM_OFFSET, CHECKSUM_LENGTH);
}

function isZeroBlock(block) {
  for (let i = 0; i < BLOCK; i += 1) if (block[i] !== 0) return false;
  return true;
}

/**
 * Unpack a ustar archive into its regular files.
 *
 * Directories and other entry types are skipped rather than rejected, so an archive that happens to
 * carry one still yields its files.
 *
 * @param {Buffer} buffer Whole archive.
 * @returns {Map<string, Buffer>} File name to contents, in archive order.
 */
export function readTar(buffer) {
  if (!Buffer.isBuffer(buffer)) fail("tar input must be a Buffer");
  if (buffer.length < BLOCK) fail(`tar archive is ${buffer.length} bytes, shorter than one block`);

  const files = new Map();
  let offset = 0;

  while (offset + BLOCK <= buffer.length) {
    const header = buffer.subarray(offset, offset + BLOCK);
    // Two consecutive zero blocks mark the end, but one is enough to stop reading entries: nothing
    // after it can be a valid header.
    if (isZeroBlock(header)) break;

    // Two magics exist and the device writes the less obvious one. POSIX ustar is "ustar\0" with
    // version "00"; the older GNU layout is "ustar " with version " \0". toybox 0.8.12 -- what
    // actually runs on the device -- writes the GNU one, which an equality test against "ustar"
    // rejects. Found by running this reader against an archive pulled off a real device, not
    // against a fixture written here.
    const magic = readString(header, MAGIC_OFFSET, 6).trim();
    if (magic && magic !== "ustar") fail(`unsupported tar format: ${JSON.stringify(magic)}`);
    if (!checksumMatches(header)) fail("tar header checksum mismatch");

    const name = readString(header, NAME_OFFSET, NAME_LENGTH);
    // Offset 345 is the path prefix only in POSIX ustar. The GNU layout puts other fields there,
    // so reading it as a directory name would invent one out of whatever happens to be present.
    const posix = header.subarray(MAGIC_OFFSET, MAGIC_OFFSET + 6).toString("latin1") === "ustar\0";
    const prefix = posix ? readString(header, PREFIX_OFFSET, PREFIX_LENGTH) : "";
    const size = readOctal(header, SIZE_OFFSET, SIZE_LENGTH);
    const typeflag = String.fromCharCode(header[TYPEFLAG_OFFSET] || 0x30);

    const dataStart = offset + BLOCK;
    const dataEnd = dataStart + size;
    if (dataEnd > buffer.length) {
      fail(
        `tar entry ${JSON.stringify(name)} claims ${size} bytes but only ${buffer.length - dataStart} remain`,
        "TAR_TRUNCATED",
      );
    }

    if (typeflag === "0" || typeflag === "\0" || typeflag === "7") {
      files.set(prefix ? `${prefix}/${name}` : name, buffer.subarray(dataStart, dataEnd));
    }
    // Entries are padded out to a whole number of blocks.
    offset = dataStart + Math.ceil(size / BLOCK) * BLOCK;
  }

  if (files.size === 0) fail("tar archive contains no files", "TAR_EMPTY");
  return files;
}

/**
 * Look an entry up by its base name.
 *
 * `tar cf` is run after a `cd`, so entries arrive as bare names, but a caller that changes that
 * should not have to care.
 *
 * @param {Map<string, Buffer>} files Result of readTar.
 * @param {string} baseName File name without any directory part.
 * @returns {Buffer|null} Contents, or null when absent.
 */
export function entryByBaseName(files, baseName) {
  for (const [name, contents] of files) {
    if (name === baseName || name.endsWith(`/${baseName}`)) return contents;
  }
  return null;
}
