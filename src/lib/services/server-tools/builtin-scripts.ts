/**
 * 服务器管理工具 - 内置脚本 seed
 *
 * 在服务启动时调用 seedBuiltinScripts() 把内置脚本写入 DB（INSERT OR IGNORE）
 * 内置脚本 owner='system', builtin=1，不可修改/删除
 */
import { scriptStore } from './store';
import { getDb } from './db';
import type { ScriptDefInput } from './types';

const BUILTIN_SCRIPTS: ScriptDefInput[] = [
  // ─── maintenance 维护 ────────────────────────────────────
  {
    name: '换阿里云源',
    category: 'maintenance',
    description: '把 CentOS/Ubuntu/Debian 的软件源替换为阿里云源',
    content: `#!/bin/bash
set -e
OS_ID=$(grep ^ID= /etc/os-release | cut -d= -f2 | tr -d '"')
echo "检测到系统: $OS_ID"

case "$OS_ID" in
  centos|rhel|rocky|almalinux)
    if [ -f /etc/yum.repos.d/CentOS-Base.repo ]; then
      cp /etc/yum.repos.d/CentOS-Base.repo /etc/yum.repos.d/CentOS-Base.repo.bak
    fi
    cat > /etc/yum.repos.d/CentOS-Base.repo << 'EOF'
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
EOF
    yum clean all && yum makecache
    ;;
  ubuntu|debian)
    cp /etc/apt/sources.list /etc/apt/sources.list.bak 2>/dev/null || true
    if [ "$OS_ID" = "ubuntu" ]; then
      sed -i 's|http://.*archive.ubuntu.com|https://mirrors.aliyun.com|g' /etc/apt/sources.list
      sed -i 's|http://.*security.ubuntu.com|https://mirrors.aliyun.com|g' /etc/apt/sources.list
    else
      sed -i 's|http://.*deb.debian.org|https://mirrors.aliyun.com|g' /etc/apt/sources.list
      sed -i 's|http://.*security.debian.org|https://mirrors.aliyun.com|g' /etc/apt/sources.list
    fi
    apt update
    ;;
  *)
    echo "不支持的系统: $OS_ID"
    exit 1
    ;;
esac
echo "换源完成"`,
    params: [],
  },
  {
    name: '清理系统缓存',
    category: 'maintenance',
    description: '清理 yum/apt 缓存、临时文件、旧日志',
    content: `#!/bin/bash
echo "=== 清理包管理器缓存 ==="
if command -v yum &>/dev/null; then
  yum clean all
  rm -rf /var/cache/yum
elif command -v apt &>/dev/null; then
  apt clean
  apt autoremove -y
  rm -rf /var/cache/apt/archives/*
fi

echo "=== 清理临时文件 ==="
find /tmp -type f -atime +7 -delete 2>/dev/null || true
find /var/tmp -type f -atime +7 -delete 2>/dev/null || true

echo "=== 清理旧日志 ==="
journalctl --vacuum-time={{retain_days}} 2>/dev/null || true
find /var/log -name "*.gz" -mtime +{{retain_days}} -delete 2>/dev/null || true
find /var/log -name "*.old" -mtime +{{retain_days}} -delete 2>/dev/null || true

echo "=== 清理后磁盘状态 ==="
df -h /`,
    params: [
      { name: 'retain_days', label: '日志保留天数', defaultValue: '30', required: false, placeholder: '30' },
    ],
  },
  {
    name: '查看进程 TOP20',
    category: 'maintenance',
    description: '按 CPU 和内存排序查看前 20 个进程',
    content: `#!/bin/bash
echo "=== 按 CPU 排序 TOP20 ==="
ps aux --sort=-%cpu | head -21
echo ""
echo "=== 按内存排序 TOP20 ==="
ps aux --sort=-%mem | head -21
echo ""
echo "=== 总进程数 ==="
ps aux | wc -l`,
    params: [],
  },
  {
    name: '查看磁盘使用',
    category: 'maintenance',
    description: '查看磁盘使用情况及大目录',
    content: `#!/bin/bash
echo "=== 磁盘使用情况 ==="
df -h
echo ""
echo "=== inode 使用情况 ==="
df -i
echo ""
echo "=== 根目录下各目录大小 ==="
du -sh /* 2>/dev/null | sort -rh | head -20`,
    params: [],
  },

  // ─── install 安装 ────────────────────────────────────────
  {
    name: '安装宝塔面板',
    category: 'install',
    description: '安装宝塔面板（国际版 aapanel 可选）',
    content: `#!/bin/bash
if [ "{{edition}}" = "aapanel" ]; then
  echo "安装国际版 aapanel..."
  curl -sSO https://raw.githubusercontent.com/aapanel/aapanel_install/main/install/aapanel.sh
  bash aapanel.sh
else
  echo "安装宝塔面板国内版..."
  curl -sSO https://download.bt.cn/install/install_panel.sh
  bash install_panel.sh 02a5b375
fi`,
    params: [
      { name: 'edition', label: '版本', defaultValue: 'bt', required: false, placeholder: 'bt 或 aapanel' },
    ],
  },
  {
    name: '安装 Docker',
    category: 'install',
    description: '使用官方脚本安装 Docker 及 Docker Compose',
    content: `#!/bin/bash
set -e
echo "=== 安装 Docker ==="
curl -fsSL https://get.docker.com | bash
systemctl enable docker
systemctl start docker

echo "=== 安装 Docker Compose ==="
COMPOSE_VERSION=$(curl -s https://api.github.com/repos/docker/compose/releases/latest | grep tag_name | cut -d '"' -f 4)
curl -L "https://github.com/docker/compose/releases/download/$COMPOSE_VERSION/docker-compose-$(uname -s)-$(uname -m)" -o /usr/local/bin/docker-compose
chmod +x /usr/local/bin/docker-compose

echo "=== 验证安装 ==="
docker --version
docker-compose --version
echo "Docker 安装完成"`,
    params: [],
  },
  {
    name: '安装 Node.js',
    category: 'install',
    description: '通过 nvm 安装指定版本的 Node.js',
    content: `#!/bin/bash
set -e
NODE_VERSION="{{version}}"
echo "=== 安装 nvm ==="
curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.39.7/install.sh | bash
export NVM_DIR="$HOME/.nvm"
[ -s "$NVM_DIR/nvm.sh" ] && . "$NVM_DIR/nvm.sh"

echo "=== 安装 Node.js $NODE_VERSION ==="
nvm install $NODE_VERSION
nvm use $NODE_VERSION
nvm alias default $NODE_VERSION

echo "=== 配置 npm 阿里云镜像 ==="
npm config set registry https://registry.npmmirror.com

echo "=== 验证安装 ==="
node -v
npm -v
echo "Node.js 安装完成"`,
    params: [
      { name: 'version', label: 'Node.js 版本', defaultValue: '20', required: false, placeholder: '20' },
    ],
  },
  {
    name: '安装 Nginx',
    category: 'install',
    description: '安装 Nginx 并启动',
    content: `#!/bin/bash
set -e
if command -v yum &>/dev/null; then
  yum install -y nginx
elif command -v apt &>/dev/null; then
  apt update
  apt install -y nginx
fi

systemctl enable nginx
systemctl start nginx

echo "=== 验证安装 ==="
nginx -v
systemctl status nginx --no-pager
echo "Nginx 安装完成，默认配置文件: /etc/nginx/nginx.conf"`,
    params: [],
  },

  // ─── inspect 检查 ────────────────────────────────────────
  {
    name: '系统信息总览',
    category: 'inspect',
    description: '查看操作系统、CPU、内存、磁盘、网络等系统信息',
    content: `#!/bin/bash
echo "=== 操作系统 ==="
cat /etc/os-release | head -5
echo ""
echo "=== 内核 ==="
uname -a
echo ""
echo "=== 运行时间和负载 ==="
uptime
echo ""
echo "=== CPU 信息 ==="
lscpu | grep -E "^(Model name|CPU\(s\)|Thread|Core|Socket)" 
echo ""
echo "=== 内存使用 ==="
free -h
echo ""
echo "=== 磁盘使用 ==="
df -h | grep -v tmpfs
echo ""
echo "=== 网络接口 ==="
ip -brief addr`,
    params: [],
  },
  {
    name: '网络诊断',
    category: 'inspect',
    description: '对指定目标进行 ping、traceroute、端口检测',
    content: `#!/bin/bash
TARGET="{{target}}"
PORT="{{port}}"

echo "=== Ping $TARGET ==="
ping -c 4 $TARGET

echo ""
echo "=== Traceroute $TARGET ==="
if command -v traceroute &>/dev/null; then
  traceroute -m 20 $TARGET
else
  echo "traceroute 未安装，跳过"
fi

echo ""
echo "=== 端口检测 $TARGET:$PORT ==="
if command -v nc &>/dev/null; then
  nc -zv -w 3 $TARGET $PORT 2>&1
elif command -v telnet &>/dev/null; then
  echo "exit" | telnet $TARGET $PORT 2>&1 | head -5
else
  timeout 3 bash -c "echo > /dev/tcp/$TARGET/$PORT" && echo "端口 $PORT 开放" || echo "端口 $PORT 不可达"
fi

echo ""
echo "=== DNS 解析 ==="
nslookup $TARGET 2>/dev/null || host $TARGET 2>/dev/null || echo "DNS 工具不可用"`,
    params: [
      { name: 'target', label: '目标地址', required: true, placeholder: 'example.com 或 IP' },
      { name: 'port', label: '检测端口', defaultValue: '80', required: false, placeholder: '80' },
    ],
  },
  {
    name: '安全检查',
    category: 'inspect',
    description: '检查 SSH 配置、防火墙、登录记录、可疑文件',
    content: `#!/bin/bash
echo "=== SSH 配置检查 ==="
grep -E "^(PermitRootLogin|PasswordAuthentication|Port|Protocol)" /etc/ssh/sshd_config 2>/dev/null || echo "无法读取 sshd_config"
echo ""

echo "=== 防火墙状态 ==="
if command -v firewall-cmd &>/dev/null; then
  firewall-cmd --state 2>/dev/null
  firewall-cmd --list-all 2>/dev/null
elif command -v ufw &>/dev/null; then
  ufw status
elif command -v iptables &>/dev/null; then
  iptables -L -n | head -20
fi
echo ""

echo "=== 最近登录记录 ==="
last -n 10
echo ""

echo "=== 失败登录尝试 ==="
if [ -f /var/log/secure ]; then
  grep "Failed password" /var/log/secure | tail -10
elif [ -f /var/log/auth.log ]; then
  grep "Failed password" /var/log/auth.log | tail -10
fi
echo ""

echo "=== SUID 文件检查（前 20 个）==="
find / -perm -4000 -type f 2>/dev/null | head -20
echo ""

echo "=== /tmp 下可执行文件 ==="
find /tmp -type f -executable 2>/dev/null | head -10`,
    params: [],
  },
];

/**
 * 清理重复的内置脚本（按 name+category 分组，保留最早创建的那条）
 * 修复历史 bug：之前 createBuiltin 每次重启生成新 UUID 导致重复
 */
function dedupBuiltinScripts(): number {
  const db = getDb();
  // 查出所有内置脚本，按 name+category 分组
  const rows = db.prepare(
    'SELECT id, name, category, created_at FROM scripts WHERE builtin = 1 ORDER BY created_at ASC'
  ).all() as { id: string; name: string; category: string; created_at: string }[];

  const groups = new Map<string, typeof rows>();
  for (const row of rows) {
    const key = `${row.name}::${row.category}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(row);
  }

  const toDelete: string[] = [];
  for (const [, group] of groups) {
    if (group.length > 1) {
      // 保留第一个（created_at 最早的），删除其余
      for (let i = 1; i < group.length; i++) {
        toDelete.push(group[i].id);
      }
    }
  }

  if (toDelete.length > 0) {
    const placeholders = toDelete.map(() => '?').join(',');
    db.prepare(`DELETE FROM scripts WHERE id IN (${placeholders})`).run(...toDelete);
  }
  return toDelete.length;
}

/**
 * 初始化内置脚本（启动时调用）
 * 先清理历史重复，再 seed（按 name+category 去重）
 */
export function seedBuiltinScripts(): void {
  // 先清理历史遗留的重复内置脚本
  const removed = dedupBuiltinScripts();
  if (removed > 0) {
    console.log(`[ServerTools] 已清理 ${removed} 个重复的内置脚本`);
  }

  for (const script of BUILTIN_SCRIPTS) {
    scriptStore.createBuiltin(script);
  }
  console.log(`[ServerTools] 已 seed ${BUILTIN_SCRIPTS.length} 个内置脚本`);
}
