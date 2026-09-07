import { createRequire } from "node:module";
import { randomUUID } from "node:crypto";
import { invariant, ToolError } from "./errors.js";

type NativeFunction = (...args: unknown[]) => unknown;
let cached: ReturnType<typeof loadApi> | undefined;
const owned = new Set<WindowsJob>();
process.once("exit", () => {
  for (const job of owned) {
    try {
      job.close();
    } catch {
      /* OS process exit also closes these handles. */
    }
  }
});
function loadApi() {
  invariant(
    process.platform === "win32",
    "PLATFORM_UNAVAILABLE",
    "Windows job API requires Windows",
  );
  // Load the N-API binding only when executing a native Windows command.
  const koffi = createRequire(import.meta.url)(
      "koffi",
    ) as typeof import("koffi"),
    kernel = koffi.load("kernel32.dll"),
    bind = (declaration: string): NativeFunction => kernel.func(declaration),
    basic = koffi.struct({
      PerProcessUserTimeLimit: "int64_t",
      PerJobUserTimeLimit: "int64_t",
      LimitFlags: "uint32_t",
      MinimumWorkingSetSize: "size_t",
      MaximumWorkingSetSize: "size_t",
      ActiveProcessLimit: "uint32_t",
      Affinity: "uintptr_t",
      PriorityClass: "uint32_t",
      SchedulingClass: "uint32_t",
    }),
    io = koffi.struct({
      ReadOperationCount: "uint64_t",
      WriteOperationCount: "uint64_t",
      OtherOperationCount: "uint64_t",
      ReadTransferCount: "uint64_t",
      WriteTransferCount: "uint64_t",
      OtherTransferCount: "uint64_t",
    }),
    extended = koffi.struct({
      BasicLimitInformation: basic,
      IoInfo: io,
      ProcessMemoryLimit: "size_t",
      JobMemoryLimit: "size_t",
      PeakProcessMemoryUsed: "size_t",
      PeakJobMemoryUsed: "size_t",
    });
  return {
    create: bind(
      "void * __stdcall CreateJobObjectW(void *attributes, const char16_t *name)",
    ),
    open: bind(
      "void * __stdcall OpenJobObjectW(uint32_t access, int inherit, const char16_t *name)",
    ),
    set: bind(
      "int __stdcall SetInformationJobObject(void *job, int kind, const void *data, uint32_t size)",
    ),
    query: bind(
      "int __stdcall QueryInformationJobObject(void *job, int kind, _Out_ void *data, uint32_t size, _Out_ uint32_t *returned)",
    ),
    assign: bind(
      "int __stdcall AssignProcessToJobObject(void *job, void *process)",
    ),
    openProcess: bind(
      "void * __stdcall OpenProcess(uint32_t access, int inherit, uint32_t pid)",
    ),
    terminate: bind(
      "int __stdcall TerminateJobObject(void *job, uint32_t code)",
    ),
    close: bind("int __stdcall CloseHandle(void *handle)"),
    error: bind("uint32_t __stdcall GetLastError()"),
    limitSize: koffi.sizeof(extended),
    flagsOffset: koffi.offsetof(basic, "LimitFlags"),
  };
}
function api() {
  return (cached ??= loadApi());
}
function failure(operation: string): ToolError {
  return new ToolError("WINDOWS_JOB_FAILED", `Windows ${operation} failed`, {
    win32_error: api().error(),
  });
}
function count(handle: unknown): number {
  // JOBOBJECT_BASIC_ACCOUNTING_INFORMATION: four LARGE_INTEGERs and four DWORDs.
  const data = Buffer.alloc(48),
    returned = [0];
  if (!api().query(handle, 1, data, data.length, returned))
    throw failure("job query");
  invariant(
    returned[0] === data.length,
    "WINDOWS_JOB_FAILED",
    "Windows returned an incomplete job accounting record",
  );
  return data.readUInt32LE(40);
}
/** Named job identity survives a launcher exit and is queryable by peer MCPs. */
export function windowsJobAlive(name: string): boolean {
  const handle = api().open(4, 0, name); // JOB_OBJECT_QUERY, non-inheritable
  if (!handle) {
    if (api().error() === 2) return false; // ERROR_FILE_NOT_FOUND
    throw failure("job open");
  }
  try {
    return count(handle) > 0;
  } finally {
    api().close(handle);
  }
}
export class WindowsJob {
  readonly name = `Local\\deveco-${randomUUID()}`;
  private handle: unknown;
  constructor() {
    this.handle = api().create(null, this.name);
    if (!this.handle) throw failure("job creation");
    const limits = Buffer.alloc(api().limitSize);
    // No BREAKAWAY flags: every native descendant remains in this job.
    limits.writeUInt32LE(0x2000, api().flagsOffset); // KILL_ON_JOB_CLOSE
    if (!api().set(this.handle, 9, limits, limits.length)) {
      const error = failure("job limits");
      this.close();
      throw error;
    }
    owned.add(this);
  }
  assign(pid: number) {
    // The TS bootstrap waits for IPC; it cannot start the SDK before assignment.
    const processHandle = api().openProcess(0x101, 0, pid); // SET_QUOTA | TERMINATE
    if (!processHandle) throw failure("process open");
    try {
      if (!api().assign(this.handle, processHandle))
        throw failure("job assignment");
    } finally {
      api().close(processHandle);
    }
  }
  alive() {
    return this.handle ? count(this.handle) > 0 : false;
  }
  terminate() {
    if (this.handle && !api().terminate(this.handle, 1))
      throw failure("job termination");
  }
  close() {
    if (this.handle) {
      if (!api().close(this.handle)) throw failure("job handle close");
      this.handle = undefined;
      owned.delete(this);
    }
  }
}
