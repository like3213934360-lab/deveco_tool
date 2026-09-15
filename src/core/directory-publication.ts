import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { randomUUID } from "node:crypto";
import { inside } from "./files.js";
import { invariant, ToolError } from "./errors.js";

const require = createRequire(import.meta.url);
function unixApi() {
  const koffi = require("koffi") as typeof import("koffi");
  const lib = koffi.load(
    process.platform === "darwin" ? "/usr/lib/libSystem.B.dylib" : "libc.so.6",
  );
  return {
    koffi,
    open: lib.func(
      "int openat(int dirfd, const char *pathname, int flags, ...)",
    ),
    mkdir: lib.func(
      "int mkdirat(int dirfd, const char *pathname, uint32_t mode)",
    ),
    link: lib.func(
      "int linkat(int olddirfd, const char *oldpath, int newdirfd, const char *newpath, int flags)",
    ),
    unlink: lib.func(
      "int unlinkat(int dirfd, const char *pathname, int flags)",
    ),
  };
}
function windowsApi() {
  const koffi = require("koffi") as typeof import("koffi"),
    lib = koffi.load("kernel32.dll");
  return {
    open: lib.func(
      "void * __stdcall CreateFileW(const char16_t *path, uint32_t access, uint32_t sharing, void *attributes, uint32_t disposition, uint32_t flags, void *templateFile)",
    ),
    info: lib.func(
      "int __stdcall GetFileInformationByHandleEx(void *handle, int kind, _Out_ void *data, uint32_t size)",
    ),
    close: lib.func("int __stdcall CloseHandle(void *handle)"),
    error: lib.func("uint32_t __stdcall GetLastError()"),
    koffi,
  };
}
let unix: ReturnType<typeof unixApi> | undefined,
  windows: ReturnType<typeof windowsApi> | undefined;

/** Resolve each directory without following links. POSIX publication uses
 * captured directory descriptors; Windows handles deny directory rename/delete
 * for the whole path until publication finishes. No new native dependency. */
export class DirectoryPublication {
  private readonly handles: unknown[] = [];
  private fd?: number;
  constructor(
    readonly root: string,
    expectedIdentity?: string,
    readonly expectedDirectories: Record<string, string> = {},
  ) {
    if (process.platform !== "win32") {
      this.fd = fs.openSync(
        root,
        fs.constants.O_RDONLY |
          fs.constants.O_DIRECTORY |
          fs.constants.O_NOFOLLOW,
      );
      try {
        const stat = fs.fstatSync(this.fd);
        invariant(
          stat.isDirectory() &&
            (!expectedIdentity ||
              `${stat.dev}:${stat.ino}` === expectedIdentity),
          "CREATE_PATH_CHANGED",
          "Publication root changed",
        );
      } catch (error) {
        this.close();
        throw error;
      }
    } else {
      windows ??= windowsApi();
      const base = path.parse(root).root;
      let directory = base;
      try {
        this.holdWindows(directory);
        for (const segment of path
          .relative(base, root)
          .split(path.sep)
          .filter(Boolean)) {
          directory = path.join(directory, segment);
          this.holdWindows(directory);
        }
        const stat = fs.lstatSync(root);
        invariant(
          !expectedIdentity || `${stat.dev}:${stat.ino}` === expectedIdentity,
          "CREATE_PATH_CHANGED",
          "Publication root changed",
        );
      } catch (error) {
        this.close();
        throw error;
      }
    }
  }
  private holdWindows(directory: string) {
    // FILE_READ_ATTRIBUTES, shared read/write but not DELETE, OPEN_EXISTING,
    // FILE_FLAG_BACKUP_SEMANTICS | FILE_FLAG_OPEN_REPARSE_POINT.
    const handle: unknown = windows!.open(
      directory,
      0x80,
      3,
      null,
      3,
      0x02200000,
      null,
    );
    const info = Buffer.alloc(40);
    if (!handle || !windows!.info(handle, 0, info, info.length)) {
      const code: unknown = windows!.error();
      if (handle) windows!.close(handle);
      throw new ToolError(
        "CREATE_PATH_CHANGED",
        "Cannot hold a publication directory",
        { path: directory, win32_error: code },
      );
    }
    const attributes = info.readUInt32LE(32);
    if (!(attributes & 0x10) || attributes & 0x400) {
      windows!.close(handle);
      throw new ToolError(
        "CREATE_PATH_CHANGED",
        `Publication directory is a reparse point or not a directory: ${directory}`,
      );
    }
    this.handles.push(handle);
  }
  private parent(relative: string) {
    const target = inside(this.root, relative),
      segments = path
        .relative(this.root, path.dirname(target))
        .split(path.sep)
        .filter(Boolean);
    invariant(
      target !== this.root && !path.isAbsolute(relative),
      "CREATE_PATH_CHANGED",
      "Publication requires a relative child path",
    );
    if (process.platform === "win32") {
      const count = this.handles.length;
      let directory = this.root;
      try {
        for (const segment of segments) {
          directory = path.join(directory, segment);
          this.holdWindows(directory);
          const stat = fs.lstatSync(directory),
            expected =
              this.expectedDirectories[path.relative(this.root, directory)];
          invariant(
            !expected || `${stat.dev}:${stat.ino}` === expected,
            "CREATE_PATH_CHANGED",
            "Publication directory changed",
          );
        }
      } catch (error) {
        while (this.handles.length > count) windows!.close(this.handles.pop());
        throw error;
      }
      return {
        fd: -1,
        name: path.basename(target),
        path: target,
        close: () => {
          while (this.handles.length > count)
            windows!.close(this.handles.pop());
        },
      };
    }
    unix ??= unixApi();
    const descriptors: number[] = [];
    let fd = this.fd!;
    try {
      let relativeDirectory = "";
      for (const segment of segments) {
        const opened = Number(
          unix.open(
            fd,
            segment,
            fs.constants.O_RDONLY |
              fs.constants.O_DIRECTORY |
              fs.constants.O_NOFOLLOW,
          ),
        );
        if (opened < 0)
          throw new ToolError(
            "CREATE_PATH_CHANGED",
            `Publication ancestor changed: ${relative}`,
            { errno: unix.koffi.errno() },
          );
        descriptors.push(opened);
        fd = opened;
        relativeDirectory = path.join(relativeDirectory, segment);
        const stat = fs.fstatSync(fd),
          expected = this.expectedDirectories[relativeDirectory];
        invariant(
          !expected || `${stat.dev}:${stat.ino}` === expected,
          "CREATE_PATH_CHANGED",
          "Publication directory changed",
        );
      }
      return {
        fd,
        name: path.basename(target),
        path: target,
        close: () =>
          descriptors.reverse().forEach((item) => fs.closeSync(item)),
      };
    } catch (error) {
      descriptors.reverse().forEach((item) => fs.closeSync(item));
      throw error;
    }
  }
  mkdir(relative: string) {
    const parent = this.parent(relative);
    try {
      if (process.platform === "win32")
        fs.mkdirSync(parent.path, { mode: 0o700 });
      else if (unix!.mkdir(parent.fd, parent.name, 0o700) !== 0)
        this.failed(relative);
    } finally {
      parent.close();
    }
  }
  link(source: DirectoryPublication, relative: string) {
    const from = source.parent(relative);
    try {
      const destination = this.parent(relative);
      try {
        if (process.platform === "win32")
          fs.linkSync(from.path, destination.path);
        else if (
          unix!.link(
            from.fd,
            from.name,
            destination.fd,
            destination.name,
            0,
          ) !== 0
        )
          this.failed(relative);
      } finally {
        destination.close();
      }
    } finally {
      from.close();
    }
  }
  write(relative: string, content: string) {
    const parent = this.parent(relative);
    const temporary = `.create-${randomUUID()}.tmp`,
      temporaryPath = path.join(path.dirname(parent.path), temporary);
    let created = false;
    try {
      const fd =
        process.platform === "win32"
          ? fs.openSync(temporaryPath, "wx", 0o600)
          : Number(
              unix!.open(
                parent.fd,
                temporary,
                fs.constants.O_WRONLY |
                  fs.constants.O_CREAT |
                  fs.constants.O_EXCL |
                  fs.constants.O_NOFOLLOW,
                "uint32_t",
                0o600,
              ),
            );
      if (fd < 0) this.failed(relative);
      created = true;
      try {
        fs.writeFileSync(fd, content);
        fs.fsyncSync(fd);
      } finally {
        fs.closeSync(fd);
      }
      if (process.platform === "win32") fs.linkSync(temporaryPath, parent.path);
      else if (
        unix!.link(parent.fd, temporary, parent.fd, parent.name, 0) !== 0
      )
        this.failed(relative);
      if (process.platform !== "win32") fs.fsyncSync(parent.fd);
    } finally {
      try {
        if (created) {
          if (process.platform === "win32") fs.unlinkSync(temporaryPath);
          else unix!.unlink(parent.fd, temporary, 0);
        }
      } finally {
        parent.close();
      }
    }
  }
  private failed(relative: string): never {
    throw new ToolError(
      "CREATE_CONFLICT",
      `Exclusive publication failed for ${relative}`,
      { conflicts: [relative], errno: unix?.koffi.errno() },
    );
  }
  close() {
    if (this.fd !== undefined) {
      fs.closeSync(this.fd);
      this.fd = undefined;
    }
    while (this.handles.length) windows!.close(this.handles.pop());
  }
}
