/**
 * 服务器管理工具 - 后台任务执行器
 *
 * 任务在 server 进程内运行，独立于 HTTP 请求生命周期：
 * - 创建任务后立即返回 taskId
 * - 任务执行时实时 appendLog + updateProgress + 广播给 WS 订阅者
 * - 关闭页面后任务继续运行
 * - 重新访问页面可通过 WS 订阅获取后续日志
 *
 * 支持 4 种任务类型：
 * - custom_cmd: 执行自定义命令
 * - mount_disk: 挂载数据盘
 * - install_bt: 安装宝塔面板（BtCapture 解析输出）
 * - run_script: 运行脚本
 */
import type { WebSocket } from 'ws';
import { sshClientManager } from './ssh-client';
import { connectionStore, taskStore, taskLogStore, btPanelStore, scriptStore } from './store';
import { BtCapture } from './bt-capture';
import { renderScript } from './script-engine';
import type { ServerTask, TaskLog, ScriptParam } from './types';

// 剥离 ANSI 转义码（与 bt-capture.ts 中保持一致）
const ANSI_RE = /\x1b\[[0-9;?]*[ -/]*[@-~]|\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)|\x1b[@-Z\\-_]|\r/g;
function stripAnsi(s: string): string {
  return s.replace(ANSI_RE, '');
}

interface TaskContext {
  task: ServerTask;
  abortController: AbortController;
  startedAt: Date;
  /** SSH client 连接（用于取消时立即关闭，确保任务真正停止） */
  client?: Parameters<typeof sshClientManager.executeCommand>[0];
}

class TaskRunner {
  private runningTasks = new Map<string, TaskContext>();
  private taskSubscribers = new Map<string, Set<WebSocket>>();

  /**
   * 启动任务（不阻塞，立即返回）
   */
  startTask(taskId: string, owner: string): void {
    if (this.runningTasks.has(taskId)) return; // 已在运行

    const task = taskStore.getByIdInternal(taskId);
    if (!task) return;
    if (task.owner !== owner) return; // 安全校验

    const connection = connectionStore.getByIdInternal(task.connectionId);
    if (!connection) {
      taskStore.updateStatus(taskId, 'failed', { error: '关联的连接不存在' });
      return;
    }

    const abortController = new AbortController();
    this.runningTasks.set(taskId, { task, abortController, startedAt: new Date() });

    // 异步执行
    this.runTask(task, connection, abortController.signal, taskId).catch(err => {
      const message = err instanceof Error ? err.message : String(err);
      this.appendLog(taskId, 'error', `任务执行异常: ${message}`);
      taskStore.updateStatus(taskId, 'failed', { error: message });
      this.broadcast(taskId, { type: 'task_finished', payload: { id: taskId, status: 'failed' } });
    }).finally(() => {
      this.runningTasks.delete(taskId);
    });
  }

  /**
   * 取消任务
   */
  cancelTask(taskId: string): boolean {
    const ctx = this.runningTasks.get(taskId);
    if (!ctx) return false;
    ctx.abortController.abort();
    // 立即关闭 SSH 连接，强制终止远程进程（仅靠 abort signal 无法停止已发出的 exec）
    if (ctx.client) {
      try { sshClientManager.closeConnection(ctx.client); } catch { /* ignore */ }
    }
    this.appendLog(taskId, 'warn', '用户取消任务，SSH 连接已关闭');
    taskStore.updateStatus(taskId, 'cancelled');
    this.broadcast(taskId, { type: 'task_finished', payload: { id: taskId, status: 'cancelled' } });
    this.runningTasks.delete(taskId);
    return true;
  }

  /**
   * WS 客户端订阅任务
   */
  subscribe(taskId: string, ws: WebSocket): void {
    if (!this.taskSubscribers.has(taskId)) {
      this.taskSubscribers.set(taskId, new Set());
    }
    this.taskSubscribers.get(taskId)!.add(ws);
  }

  unsubscribe(taskId: string, ws: WebSocket): void {
    this.taskSubscribers.get(taskId)?.delete(ws);
  }

  unsubscribeAll(ws: WebSocket): void {
    for (const set of this.taskSubscribers.values()) {
      set.delete(ws);
    }
  }

  /**
   * 任务执行主循环
   */
  private async runTask(
    task: ServerTask,
    connection: NonNullable<ReturnType<typeof connectionStore.getByIdInternal>>,
    signal: AbortSignal,
    taskId: string,
  ): Promise<void> {
    taskStore.updateStatus(task.id, 'running');
    this.broadcast(task.id, { type: 'task_status', payload: { id: task.id, status: 'running', progress: 0 } });
    this.appendLog(task.id, 'info', `开始执行任务: ${task.title}`);

    // 建立 SSH 连接
    let client;
    try {
      this.appendLog(task.id, 'info', `连接 ${connection.host}:${connection.port}...`);
      client = await sshClientManager.createConnection({
        host: connection.host,
        port: connection.port,
        username: connection.username,
        password: connection.password,
        readyTimeout: 30000,
      });
      // 存入 context，供 cancelTask 立即关闭连接终止远程进程
      const ctx = this.runningTasks.get(taskId);
      if (ctx) ctx.client = client;
      this.appendLog(task.id, 'success', 'SSH 连接成功');
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.appendLog(task.id, 'error', `SSH 连接失败: ${message}`);
      taskStore.updateStatus(task.id, 'failed', { error: `SSH 连接失败: ${message}` });
      this.broadcast(task.id, { type: 'task_finished', payload: { id: task.id, status: 'failed' } });
      return;
    }

    if (signal.aborted) {
      sshClientManager.closeConnection(client);
      return;
    }

    try {
      let result: { success: boolean; btPanelId?: string; error?: string };
      switch (task.type) {
        case 'custom_cmd':
          result = await this.runCustomCmd(task, client, signal);
          break;
        case 'mount_disk':
          result = await this.runMountDisk(task, client, signal);
          break;
        case 'install_bt':
          result = await this.runInstallBt(task, client, signal);
          break;
        case 'run_script':
          result = await this.runScript(task, client, signal);
          break;
        default:
          result = { success: false, error: `未知任务类型: ${task.type}` };
      }

      if (signal.aborted) return;

      if (result.success) {
        taskStore.updateStatus(task.id, 'success', { progress: 100 });
        this.appendLog(task.id, 'success', '任务完成');
        this.broadcast(task.id, { type: 'task_finished', payload: { id: task.id, status: 'success', btPanelId: result.btPanelId } });
      } else {
        taskStore.updateStatus(task.id, 'failed', { error: result.error });
        this.appendLog(task.id, 'error', result.error || '任务失败');
        this.broadcast(task.id, { type: 'task_finished', payload: { id: task.id, status: 'failed' } });
      }
    } finally {
      sshClientManager.closeConnection(client);
    }
  }

  /**
   * 执行自定义命令
   */
  private async runCustomCmd(
    task: ServerTask,
    client: Parameters<typeof sshClientManager.executeCommand>[0],
    signal: AbortSignal,
  ): Promise<{ success: boolean; error?: string }> {
    const cmd = String(task.params.cmd ?? '');
    if (!cmd) return { success: false, error: '命令不能为空' };
    this.appendLog(task.id, 'info', `执行命令: ${cmd}`);
    taskStore.updateProgress(task.id, 30);
    this.broadcast(task.id, { type: 'task_status', payload: { id: task.id, status: 'running', progress: 30 } });

    const output = await sshClientManager.executeCommand(client, cmd);
    if (signal.aborted) return { success: false };
    // 输出按行广播
    const lines = output.split('\n');
    for (const line of lines) {
      if (line.trim()) this.appendLog(task.id, 'info', line);
    }
    return { success: true };
  }

  /**
   * 挂载数据盘
   * params: { disk: '/dev/vdb', mountPoint: '/www', fstype: 'ext4' }
   */
  private async runMountDisk(
    task: ServerTask,
    client: Parameters<typeof sshClientManager.executeCommand>[0],
    signal: AbortSignal,
  ): Promise<{ success: boolean; error?: string }> {
    const disk = String(task.params.disk ?? '');
    const mountPoint = String(task.params.mountPoint ?? '/www');
    const fstype = String(task.params.fstype ?? 'ext4');
    if (!disk) return { success: false, error: '未指定磁盘' };
    if (signal.aborted) return { success: false };

    // 根盘保护校验：executeCommand 不因 exit code reject（只看流错误），需单独执行并检测输出标记
    const diskShort = disk.replace(/^\/dev\//, '');
    this.appendLog(task.id, 'info', '根盘保护校验');
    const rootCheck = await sshClientManager.executeCommand(
      client,
      `ROOT_PART=$(findmnt -no SOURCE /); ROOT_DISK=$(lsblk -no PKNAME "$ROOT_PART" 2>/dev/null | head -1); if [ "$ROOT_DISK" = "${diskShort}" ]; then echo "ROOT_DISK_BLOCKED"; exit 1; fi`,
    );
    if (signal.aborted) return { success: false };
    if (rootCheck.includes('ROOT_DISK_BLOCKED')) {
      this.appendLog(task.id, 'error', `安全拦截：${disk} 是系统盘，拒绝格式化`);
      return { success: false, error: `安全拦截：${disk} 是系统盘，不能格式化` };
    }

    const steps: Array<{ name: string; cmd: string }> = [
      { name: `检查磁盘 ${disk}`, cmd: `lsblk ${disk} 2>/dev/null` },
      { name: `卸载已有挂载`, cmd: `umount ${disk} 2>/dev/null; umount ${mountPoint} 2>/dev/null; true` },
      { name: `创建挂载点 ${mountPoint}`, cmd: `mkdir -p ${mountPoint}` },
      { name: `分区（如未分区）`, cmd: `(echo 'n'; echo 'p'; echo '1'; echo ''; echo ''; echo 'w') | fdisk ${disk} 2>/dev/null; true` },
      { name: `格式化 ${disk}1 为 ${fstype}`, cmd: `mkfs.${fstype} -F ${disk}1 2>&1` },
      { name: `挂载 ${disk}1 到 ${mountPoint}`, cmd: `mount ${disk}1 ${mountPoint}` },
      { name: `写入 /etc/fstab`, cmd: `grep -q "${disk}1" /etc/fstab || echo "${disk}1 ${mountPoint} ${fstype} defaults 0 0" >> /etc/fstab` },
      { name: `验证挂载`, cmd: `df -h ${mountPoint}` },
    ];

    for (let i = 0; i < steps.length; i++) {
      if (signal.aborted) return { success: false };
      const step = steps[i];
      const progress = Math.round(((i + 1) / steps.length) * 100);
      taskStore.updateProgress(task.id, progress);
      this.broadcast(task.id, { type: 'task_status', payload: { id: task.id, status: 'running', progress } });
      this.appendLog(task.id, 'info', `[${i + 1}/${steps.length}] ${step.name}`);

      try {
        const output = await sshClientManager.executeCommand(client, step.cmd);
        if (output.trim()) {
          for (const line of output.trim().split('\n').slice(0, 5)) {
            this.appendLog(task.id, 'info', `  ${line}`);
          }
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        // 部分步骤允许失败（如卸载）
        if (i === 1 || i === 3) {
          this.appendLog(task.id, 'warn', `  步骤跳过: ${message}`);
          continue;
        }
        return { success: false, error: `${step.name} 失败: ${message}` };
      }
    }
    return { success: true };
  }

  /**
   * 安装宝塔面板（三步流程）
   * params: { version?: 'aapanel'|'baota' }
   *
   * 流程：
   * 1. 自动换阿里云源（检测系统 CentOS/Ubuntu/Debian）
   * 2. 宝塔官方挂载数据盘工具（auto_disk.sh）
   * 3. 安装宝塔面板（install_panel.sh 02a5b375）
   *
   * 关键点：
   * - pty: true 模拟终端，宝塔脚本依赖 tty
   * - 不严格依赖 code === 0，而是看是否捕获到宝塔信息
   * - 30 分钟超时保护
   * - 通过输出标记 === [x/3] 检测阶段并更新进度
   */
  private async runInstallBt(
    task: ServerTask,
    client: Parameters<typeof sshClientManager.executeCommand>[0],
    signal: AbortSignal,
  ): Promise<{ success: boolean; btPanelId?: string; error?: string }> {
    const version = String(task.params.version ?? 'baota');
    const isAapanel = version === 'aapanel';

    // 构造三步合一的安装脚本，写入临时文件后执行
    // 用 quoted heredoc 防止变量提前展开，内层 heredoc 由远端 bash 执行时处理
    const scriptContent = isAapanel
      ? `#!/bin/bash
# === [1/3] 换阿里云源 ===
OS_ID=$(grep ^ID= /etc/os-release | cut -d= -f2 | tr -d '"')
echo "=== [1/3] 检测到系统: \${OS_ID}, 开始换阿里云源 ==="
case "\${OS_ID}" in
  centos|rhel|rocky|almalinux)
    if [ -f /etc/yum.repos.d/CentOS-Base.repo ]; then
      cp /etc/yum.repos.d/CentOS-Base.repo /etc/yum.repos.d/CentOS-Base.repo.bak 2>/dev/null || true
    fi
    cat > /etc/yum.repos.d/CentOS-Base.repo << 'REPOEOF'
[base]
name=CentOS-$releasever - Base - mirrors.aliyun.com
baseurl=https://mirrors.aliyun.com/centos/$releasever/os/$basearch/
gpgcheck=1
gpgkey=https://mirrors.aliyun.com/centos/RPM-GPG-KEY-CentOS-7
[updates]
name=CentOS-$releasever - Updates - mirrors.aliyun.com
baseurl=https://mirrors.aliyun.com/centos/$releasever/updates/$basearch/
gpgcheck=1
gpgkey=https://mirrors.aliyun.com/centos/RPM-GPG-KEY-CentOS-7
[extras]
name=CentOS-$releasever - Extras - mirrors.aliyun.com
baseurl=https://mirrors.aliyun.com/centos/$releasever/extras/$basearch/
gpgcheck=1
gpgkey=https://mirrors.aliyun.com/centos/RPM-GPG-KEY-CentOS-7
REPOEOF
    yum clean all && yum makecache
    ;;
  ubuntu)
    cp /etc/apt/sources.list /etc/apt/sources.list.bak 2>/dev/null || true
    sed -i 's|http://.*archive.ubuntu.com|https://mirrors.aliyun.com|g' /etc/apt/sources.list
    sed -i 's|http://.*security.ubuntu.com|https://mirrors.aliyun.com|g' /etc/apt/sources.list
    apt update
    ;;
  debian)
    cp /etc/apt/sources.list /etc/apt/sources.list.bak 2>/dev/null || true
    sed -i 's|http://.*deb.debian.org|https://mirrors.aliyun.com|g' /etc/apt/sources.list
    sed -i 's|http://.*security.debian.org|https://mirrors.aliyun.com|g' /etc/apt/sources.list
    apt update
    ;;
  *)
    echo "不支持的系统: \${OS_ID}, 跳过换源步骤"
    ;;
esac
echo "=== [1/3] 换源完成 ==="

# === [2/3] 宝塔官方数据盘挂载工具 ===
echo "=== [2/3] 开始挂载数据盘 ==="
echo "=== 宝塔官方数据盘挂载工具 ==="
if [ -f /etc/redhat-release ]; then
  echo "检测到 CentOS/RHEL 系统, 使用 yum 安装依赖..."
  yum install wget -y && wget -O auto_disk.sh http://download.bt.cn/tools/auto_disk.sh && yes y | bash auto_disk.sh
elif [ -f /etc/lsb-release ] && grep -q "Ubuntu" /etc/lsb-release 2>/dev/null; then
  echo "检测到 Ubuntu 系统, 使用 sudo 执行..."
  wget -O auto_disk.sh http://download.bt.cn/tools/auto_disk.sh && yes y | sudo bash auto_disk.sh
elif [ -f /etc/debian_version ]; then
  echo "检测到 Debian 系统, 使用 bash 执行..."
  wget -O auto_disk.sh http://download.bt.cn/tools/auto_disk.sh && yes y | bash auto_disk.sh
else
  echo "检测到其他 Linux 系统, 尝试通用方式..."
  if command -v wget &>/dev/null; then
    wget -O auto_disk.sh http://download.bt.cn/tools/auto_disk.sh && yes y | bash auto_disk.sh
  elif command -v curl &>/dev/null; then
    curl -o auto_disk.sh http://download.bt.cn/tools/auto_disk.sh && yes y | bash auto_disk.sh
  else
    echo "错误: 需要 wget 或 curl 工具!"
  fi
fi
echo "=== 挂载结果 ==="
df -h
echo "=== [2/3] 挂载数据盘完成 ==="

# === [3/3] 安装 aaPanel ===
echo "=== [3/3] 开始安装 aaPanel ==="
if [ -f /usr/bin/curl ]; then
  curl -sSO https://raw.githubusercontent.com/aapanel/aapanel/main/script/aapanel.sh
else
  wget -O aapanel.sh https://raw.githubusercontent.com/aapanel/aapanel/main/script/aapanel.sh
fi
yes y | bash aapanel.sh`
      : `#!/bin/bash
# === [1/3] 换阿里云源 ===
OS_ID=$(grep ^ID= /etc/os-release | cut -d= -f2 | tr -d '"')
echo "=== [1/3] 检测到系统: \${OS_ID}, 开始换阿里云源 ==="
case "\${OS_ID}" in
  centos|rhel|rocky|almalinux)
    if [ -f /etc/yum.repos.d/CentOS-Base.repo ]; then
      cp /etc/yum.repos.d/CentOS-Base.repo /etc/yum.repos.d/CentOS-Base.repo.bak 2>/dev/null || true
    fi
    cat > /etc/yum.repos.d/CentOS-Base.repo << 'REPOEOF'
[base]
name=CentOS-$releasever - Base - mirrors.aliyun.com
baseurl=https://mirrors.aliyun.com/centos/$releasever/os/$basearch/
gpgcheck=1
gpgkey=https://mirrors.aliyun.com/centos/RPM-GPG-KEY-CentOS-7
[updates]
name=CentOS-$releasever - Updates - mirrors.aliyun.com
baseurl=https://mirrors.aliyun.com/centos/$releasever/updates/$basearch/
gpgcheck=1
gpgkey=https://mirrors.aliyun.com/centos/RPM-GPG-KEY-CentOS-7
[extras]
name=CentOS-$releasever - Extras - mirrors.aliyun.com
baseurl=https://mirrors.aliyun.com/centos/$releasever/extras/$basearch/
gpgcheck=1
gpgkey=https://mirrors.aliyun.com/centos/RPM-GPG-KEY-CentOS-7
REPOEOF
    yum clean all && yum makecache
    ;;
  ubuntu)
    cp /etc/apt/sources.list /etc/apt/sources.list.bak 2>/dev/null || true
    sed -i 's|http://.*archive.ubuntu.com|https://mirrors.aliyun.com|g' /etc/apt/sources.list
    sed -i 's|http://.*security.ubuntu.com|https://mirrors.aliyun.com|g' /etc/apt/sources.list
    apt update
    ;;
  debian)
    cp /etc/apt/sources.list /etc/apt/sources.list.bak 2>/dev/null || true
    sed -i 's|http://.*deb.debian.org|https://mirrors.aliyun.com|g' /etc/apt/sources.list
    sed -i 's|http://.*security.debian.org|https://mirrors.aliyun.com|g' /etc/apt/sources.list
    apt update
    ;;
  *)
    echo "不支持的系统: \${OS_ID}, 跳过换源步骤"
    ;;
esac
echo "=== [1/3] 换源完成 ==="

# === [2/3] 宝塔官方数据盘挂载工具 ===
echo "=== [2/3] 开始挂载数据盘 ==="
echo "=== 宝塔官方数据盘挂载工具 ==="
if [ -f /etc/redhat-release ]; then
  echo "检测到 CentOS/RHEL 系统, 使用 yum 安装依赖..."
  yum install wget -y && wget -O auto_disk.sh http://download.bt.cn/tools/auto_disk.sh && yes y | bash auto_disk.sh
elif [ -f /etc/lsb-release ] && grep -q "Ubuntu" /etc/lsb-release 2>/dev/null; then
  echo "检测到 Ubuntu 系统, 使用 sudo 执行..."
  wget -O auto_disk.sh http://download.bt.cn/tools/auto_disk.sh && yes y | sudo bash auto_disk.sh
elif [ -f /etc/debian_version ]; then
  echo "检测到 Debian 系统, 使用 bash 执行..."
  wget -O auto_disk.sh http://download.bt.cn/tools/auto_disk.sh && yes y | bash auto_disk.sh
else
  echo "检测到其他 Linux 系统, 尝试通用方式..."
  if command -v wget &>/dev/null; then
    wget -O auto_disk.sh http://download.bt.cn/tools/auto_disk.sh && yes y | bash auto_disk.sh
  elif command -v curl &>/dev/null; then
    curl -o auto_disk.sh http://download.bt.cn/tools/auto_disk.sh && yes y | bash auto_disk.sh
  else
    echo "错误: 需要 wget 或 curl 工具!"
  fi
fi
echo "=== 挂载结果 ==="
df -h
echo "=== [2/3] 挂载数据盘完成 ==="

# === [3/3] 安装宝塔面板 ===
echo "=== [3/3] 开始安装宝塔面板 ==="
if [ -f /usr/bin/curl ]; then
  curl -sSO https://download.bt.cn/install/install_panel.sh
else
  wget -O install_panel.sh https://download.bt.cn/install/install_panel.sh
fi
yes y | bash install_panel.sh 02a5b375`;

    // 写入临时文件后执行，避免 shell 转义问题
    const tmpFile = `/tmp/.bt_install_${Date.now()}.sh`;
    const marker = `BTINSTALL_EOF_${Date.now()}`;
    const writeCmd = `cat > ${tmpFile} << '${marker}'\n${scriptContent}\n${marker}\nchmod +x ${tmpFile}`;
    await sshClientManager.executeCommand(client, writeCmd);

    if (signal.aborted) {
      await sshClientManager.executeCommand(client, `rm -f ${tmpFile}`);
      return { success: false };
    }

    const cmd = `bash ${tmpFile} 2>&1; rm -f ${tmpFile}`;

    this.appendLog(task.id, 'info', `开始安装${isAapanel ? 'aaPanel' : '宝塔面板'}（换源 → 挂载数据盘 → 安装面板）`);
    this.appendLog(task.id, 'info', '完整流程约 5-15 分钟，请耐心等待...');
    taskStore.updateProgress(task.id, 2);
    this.broadcast(task.id, { type: 'task_status', payload: { id: task.id, status: 'running', progress: 2 } });

    const btCapture = new BtCapture();
    let capturedPanelId: string | undefined;
    btCapture.onComplete(async (info) => {
      this.appendLog(task.id, 'success', `捕获宝塔信息: ${info.url ?? ''}`);
      this.appendLog(task.id, 'info', `用户名: ${info.username ?? ''} 密码: ${info.password ?? ''}`);
      try {
        const btPanel = btPanelStore.createInternal({
          owner: task.owner,
          connectionId: task.connectionId,
          url: info.url,
          innerUrl: info.innerUrl,
          username: info.username,
          password: info.password,
        });
        capturedPanelId = btPanel.id;
        this.appendLog(task.id, 'success', '宝塔面板信息已保存');
      } catch (err) {
        this.appendLog(task.id, 'error', `保存宝塔信息失败: ${err instanceof Error ? err.message : String(err)}`);
      }
    });

    return new Promise(resolve => {
      // 30 分钟超时保护
      const timeoutId = setTimeout(() => {
        this.appendLog(task.id, 'error', '安装超时（30 分钟）');
        resolve({ success: false, error: '安装超时（30 分钟）' });
      }, 30 * 60 * 1000);

      // pty: true 让 exec 模拟终端，宝塔脚本依赖 tty
      client.exec(cmd, { pty: true }, (err, stream) => {
        if (err) {
          clearTimeout(timeoutId);
          resolve({ success: false, error: `执行失败: ${err.message}` });
          return;
        }
        let buffer = '';
        let lineCount = 0;
        let lastProgressUpdate = 0;
        // 当前阶段：1=换源 2=挂载 3=安装
        let currentPhase = 1;
        let fullOutput = '';

        const updateProgress = () => {
          let progress: number;
          if (btCapture.isCompleted()) {
            progress = 95;
          } else if (currentPhase === 1) {
            progress = Math.min(10, 2 + Math.floor(lineCount / 5));
          } else if (currentPhase === 2) {
            progress = Math.min(25, 10 + Math.floor(lineCount / 5));
          } else {
            progress = Math.min(90, 25 + Math.floor(lineCount / 10) * 2);
          }
          taskStore.updateProgress(task.id, progress);
          this.broadcast(task.id, { type: 'task_status', payload: { id: task.id, status: 'running', progress } });
        };

        stream
          .on('data', (chunk: Buffer) => {
            const text = chunk.toString('utf-8');
            buffer += text;
            fullOutput += text;
            btCapture.feed(text);
            const lines = buffer.split('\n');
            buffer = lines.pop() ?? '';
            for (const line of lines) {
              if (line.trim()) {
                lineCount++;
                const cleaned = stripAnsi(line).trimEnd();
                if (!cleaned) continue;
                const display = cleaned.length > 500 ? cleaned.slice(0, 500) + '...(截断)' : cleaned;
                this.appendLog(task.id, 'info', display);
                // 检测阶段标记
                if (cleaned.includes('[2/3]')) {
                  currentPhase = 2;
                  lineCount = 0;
                  this.appendLog(task.id, 'info', '--- 进入挂载数据盘阶段 ---');
                } else if (cleaned.includes('[3/3]')) {
                  currentPhase = 3;
                  lineCount = 0;
                  this.appendLog(task.id, 'info', '--- 进入安装宝塔面板阶段 ---');
                }
                if (lineCount - lastProgressUpdate >= 5) {
                  lastProgressUpdate = lineCount;
                  updateProgress();
                }
              }
            }
          })
          .stderr.on('data', (chunk: Buffer) => {
            const text = chunk.toString('utf-8');
            buffer += text;
            fullOutput += text;
            btCapture.feed(text);
          })
          .on('close', (code: number | null) => {
            clearTimeout(timeoutId);
            if (buffer.trim()) {
              const tail = stripAnsi(buffer).trim();
              if (tail) this.appendLog(task.id, 'info', tail);
            }
            if (signal.aborted) {
              resolve({ success: false });
              return;
            }
            this.appendLog(task.id, 'info', `安装进程退出，code=${code}`);

            if (!btCapture.isCompleted() && fullOutput.length > 0) {
              btCapture.feed(fullOutput);
            }

            const captured = btCapture.getCaptured();
            const hasCoreInfo = !!(captured.url && captured.username && captured.password);
            const hasPartialInfo = !!(captured.url || captured.username || captured.password);

            if (hasCoreInfo) {
              taskStore.updateProgress(task.id, 100);
              this.broadcast(task.id, { type: 'task_status', payload: { id: task.id, status: 'running', progress: 100 } });
              this.appendLog(task.id, 'success', `面板地址: ${captured.url}`);
              this.appendLog(task.id, 'success', `账号: ${captured.username} / 密码: ${captured.password}`);
              if (captured.innerUrl) {
                this.appendLog(task.id, 'info', `内网地址: ${captured.innerUrl}`);
              }
              resolve({ success: true, btPanelId: capturedPanelId ?? 'pending' });
            } else if (hasPartialInfo) {
              this.appendLog(task.id, 'warn', `仅捕获到部分宝塔信息（url=${captured.url ?? '无'}, username=${captured.username ?? '无'}, password=${captured.password ?? '无'}）`);
              if (captured.url) {
                this.appendLog(task.id, 'success', `面板地址: ${captured.url}`);
              }
              taskStore.updateProgress(task.id, 100);
              resolve({ success: true, btPanelId: capturedPanelId ?? 'pending' });
            } else if (code === 0 || code === null || code === undefined) {
              this.appendLog(task.id, 'warn', '安装进程已退出，但未捕获到面板信息（可手动登录服务器查看 /www/server/panel/default.pl）');
              taskStore.updateProgress(task.id, 100);
              resolve({ success: true });
            } else {
              resolve({ success: false, error: `安装过程异常退出（code=${code}），且未捕获到面板信息` });
            }
          })
          .on('error', err => {
            clearTimeout(timeoutId);
            resolve({ success: false, error: `流错误: ${err.message}` });
          });
      });
    });
  }

  /**
   * 运行脚本
   * 支持两种模式：
   * 1. scriptId: 从脚本库查找（paramValues 传参）
   * 2. content: 直接执行（content + paramDefs + paramValues）
   */
  private async runScript(
    task: ServerTask,
    client: Parameters<typeof sshClientManager.executeCommand>[0],
    signal: AbortSignal,
  ): Promise<{ success: boolean; error?: string }> {
    let content: string;
    let paramDefs: ScriptParam[];
    let scriptName: string;

    const scriptId = task.params.scriptId as string | undefined;
    if (scriptId) {
      const script = scriptStore.getByIdInternal(scriptId);
      if (!script) return { success: false, error: '脚本不存在' };
      content = script.content;
      paramDefs = script.params;
      scriptName = script.name;
    } else {
      content = String(task.params.content ?? '');
      if (!content) return { success: false, error: '脚本内容为空' };
      paramDefs = (task.params.paramDefs as ScriptParam[] | undefined) ?? [];
      scriptName = (task.params.scriptName as string | undefined) ?? '自定义脚本';
    }

    this.appendLog(task.id, 'info', `执行脚本: ${scriptName}`);
    const paramValues = (task.params.paramValues as Record<string, string> | undefined) ?? {};
    const renderResult = renderScript(content, paramDefs, paramValues);
    if (!renderResult.ok || !renderResult.rendered) {
      return { success: false, error: renderResult.error ?? '脚本渲染失败' };
    }
    const rendered = renderResult.rendered;

    // 预览前 10 行
    this.appendLog(task.id, 'info', '--- 脚本内容 ---');
    const allLines = rendered.split('\n');
    for (const line of allLines.slice(0, 10)) {
      this.appendLog(task.id, 'info', line);
    }
    if (allLines.length > 10) {
      this.appendLog(task.id, 'info', `... (共 ${allLines.length} 行，已省略)`);
    }
    taskStore.updateProgress(task.id, 30);
    this.broadcast(task.id, { type: 'task_status', payload: { id: task.id, status: 'running', progress: 30 } });

    // 写到临时文件再执行，避免 shell 转义问题
    const marker = `EOF_SCRIPT_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    const tmpFile = `/tmp/.server-tools-script-${Date.now()}.sh`;
    const writeCmd = `cat > ${tmpFile} << '${marker}'\n${rendered}\n${marker}\nchmod +x ${tmpFile}`;
    await sshClientManager.executeCommand(client, writeCmd);

    if (signal.aborted) {
      await sshClientManager.executeCommand(client, `rm -f ${tmpFile}`);
      return { success: false };
    }

    const output = await sshClientManager.executeCommand(client, `bash ${tmpFile} 2>&1; rm -f ${tmpFile}`);
    if (signal.aborted) return { success: false };
    for (const line of output.split('\n')) {
      if (line.trim()) this.appendLog(task.id, 'info', line);
    }
    return { success: true };
  }

  /**
   * 追加日志（同时持久化 + 广播）
   */
  private appendLog(taskId: string, level: TaskLog['level'], msg: string): void {
    const log = taskLogStore.append({ taskId, level, msg });
    this.broadcast(taskId, {
      type: 'task_log',
      payload: { taskId: log.taskId, seq: log.seq, ts: log.ts, level: log.level, msg: log.msg },
    });
  }

  /**
   * 广播消息给任务订阅者
   */
  private broadcast(taskId: string, msg: unknown): void {
    const subs = this.taskSubscribers.get(taskId);
    if (!subs || subs.size === 0) return;
    const text = JSON.stringify(msg);
    for (const ws of subs) {
      if (ws.readyState === ws.OPEN) {
        ws.send(text);
      }
    }
  }

  /**
   * 获取任务运行状态
   */
  isRunning(taskId: string): boolean {
    return this.runningTasks.has(taskId);
  }
}

// 使用 globalThis 确保单例（Next.js dev 模式下 server.ts 和 ws-handlers 可能各自加载一份模块）
const globalForTaskRunner = globalThis as unknown as { __taskRunner?: TaskRunner };
if (!globalForTaskRunner.__taskRunner) {
  globalForTaskRunner.__taskRunner = new TaskRunner();
}
export const taskRunner = globalForTaskRunner.__taskRunner;
