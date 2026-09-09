# 原生进程所有权与取消

执行协议 `native-6`。部署状态保留完整包集合、Windows Job 身份、设备执行回执及已确认结束的失败状态；同步和构建新增分阶段命令完成记录。历史开发协议不能恢复到本协议，使用新的状态目录，无旧格式解码器。下文历史 CI 记录按其提交保留，不能代替当前协议的最终矩阵验收。

POSIX 使用进程组，先发 TERM，再按期限升级为 KILL，等待受管组退出。未能确认停止时返回 `CANCEL_UNCONFIRMED`，持久化记录继续阻止冲突资源复用。MCP 意外死亡后仍存活的组不会被下一进程直接接管或盲目重放。

Windows 使用本项目的 TypeScript 启动器与系统 Job Object。Koffi 3.2.1（MIT，锁文件固定）提供 N-API FFI，只在执行 Windows 原生命令时加载。没有自有 C/C++ 宿主组件或 `taskkill` 回退路径。

1. 创建非继承句柄的命名 Job，启用 `KILL_ON_JOB_CLOSE`，不允许后代脱离。
2. 启动只等待 IPC 的 TypeScript 启动器；它的环境不包含 `NODE_OPTIONS` 或 `NODE_PATH` 预加载配置。
3. 把启动器加入 Job，并先持久化进程与 Job 身份，再发送捕获的 SDK 命令。加入失败时不执行 SDK。
4. 启动器直接继承三路标准流，使用参数数组启动 SDK；不复制输出或解析 CLI 协议。SDK 收到原来捕获的环境。
5. 普通命令或失败会话的启动器退出后清理剩余后代；成功的显式长期会话可以保留其后代，直到所属服务停止会话。
6. 取消前获取受管进程的同步句柄并核对 Job 归属，再调用 `TerminateJobObject`。等待进程流关闭、同步句柄收到退出信号且系统报告 `ActiveProcesses=0`，才结束任务并释放记录。只检查活动数可能早于 Windows 完成文件映射释放；查询失败保留未确认状态。

命名 Job 让其他 MCP 进程可以核对已经退出的启动器所留下的会话。句柄不传给 SDK；宿主进程死亡会关闭最后的拥有者句柄。工作线程正常退出也会关闭自己的句柄。现有共享守护进程没有被加入 Job，不按进程名称或全局枚举终止其他 SDK 实例。

测试包含 Windows 上主动脱离 libuv 默认 Job 的子进程、独立命令隔离、启动器提前退出、长期会话持久化保护和 MCP 直接被杀死。Windows 真实执行证据必须由 CI 记录；本机 POSIX 通过不能代替 Windows 证明。启动器新增一个 Node 进程，其启动/RSS 成本仍须纳入最终性能对比，不能据此宣称没有启动或内存开销；旧 5% 相对耗时阈值已改为观察项。通过外部系统服务另行启动的进程必须由具体 SDK 会话服务核对。

## 重启和清理失败

`deveco_restart` 关闭原生运行 Worker，下一次请求按需启动新的 Worker。旧 `target` 选择分支已删除，官方 CLI/子 MCP 不再是原生服务的重启对象。

并发重启共用同一个关闭 Promise；关闭开始后拒绝新业务请求。关闭成功必须等到 Worker 的实际退出事件。清理失败回执不会立刻清除旧 Worker 身份：退出前继续拒绝新请求和创建替代 Worker，避免尚未确认的 SDK 操作与新实例并存。

运行服务依次关闭工作流、录制、watch、模拟器、LSP、认证、UI、CPU 池、受管进程、文档索引和存储。某一项失败不跳过后续清理，最终汇总 `CANCEL_UNCONFIRMED`。重复关闭复用结果，避免重入已关闭数据库。

`test/native-shutdown.test.ts` 使用真实运行 Worker 验证并发关闭和再次启动，使用持有端口的故障 Worker 验证失败回执后的隔离，并注入引擎/文档关闭错误来核对其他子进程和 SQLite 仍然退出。录制中断、watch 停止和进程所有权另由对应行为回归验证；这些测试不能代替真实设备热补丁验收。

2026-09-08，提交 `6f206053873ac962707ba8c9c8c4cde098abe278` 的 [CI 34161610703](https://github.com/like3213934360-lab/deveco_tool/actions/runs/34161610703) 六组 Node 22/24 × macOS/Windows/Linux 均通过，每组 182 项回归；Windows 两组还分别完成 20 轮进程压力检查。并发重启、清理失败隔离和 Windows 路径身份已覆盖，`deveco_restart` 迁移项据此完成行为验收。真实 SDK 会话的最终性能和设备操作仍受各自门槛约束。

当前运行摘要 `23758f48`、编译摘要 `25b0b62c` 的 [CI 34248473227](https://github.com/like3213934360-lab/deveco_tool/actions/runs/34248473227) 六组通过；Windows × Node 22/24 各 319 项适用回归及各 20 轮进程压力检查通过。下载报告已核对实际运行轮次、编译身份和无失败结果；不扩展为 Windows 真实 SDK 会话已验收。

依据：[Microsoft Job Objects](https://learn.microsoft.com/en-us/windows/win32/procthread/job-objects)、[QueryInformationJobObject](https://learn.microsoft.com/en-us/windows/win32/api/jobapi2/nf-jobapi2-queryinformationjobobject)、[Koffi 文档](https://koffi.dev/output)、[libuv Windows 进程实现](https://github.com/libuv/libuv/blob/v1.x/src/win/process.c)。
