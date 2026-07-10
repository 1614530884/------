/**
 * 宝塔面板信息捕获器
 *
 * 监听 SSH 输出流，正则匹配宝塔安装完成后的关键信息：
 * - 外网面板地址
 * - 内网面板地址
 * - panel username
 * - panel password
 *
 * 关键：pty 输出包含 ANSI 转义码（颜色/光标控制），会嵌入在文本中间
 * 破坏正则匹配。feed() 时先剥离 ANSI 再放入 buffer。
 *
 * 完成后调用 onComplete 回调
 */
interface BtPanelCaptured {
  url?: string;
  innerUrl?: string;
  username?: string;
  password?: string;
  panelPort?: number;
}

/**
 * 剥离 ANSI 转义码
 * 匹配：
 * - CSI 序列：\x1b[ ... 字母  （颜色、光标移动等）
 * - OSC 序列：\x1b] ... \x07 或 \x1b\\  （标题设置等）
 * - 其他单字符 ESC 序列：\x1b + 单字符
 * - 制表符 \r 也去除（pty 输出 \r\n 换行）
 */
const ANSI_RE = /\x1b\[[0-9;?]*[ -/]*[@-~]|\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)|\x1b[@-Z\\-_]|\r/g;
function stripAnsi(s: string): string {
  return s.replace(ANSI_RE, '');
}

const BT_PATTERNS = {
  // 匹配"外网面板地址"或"外网ipv4面板地址"等变体，URL 可能被反引号包围
  url: /外网[^\n：:]*面板地址[:：]\s*`?(https?:\/\/[^\s`]+)/,
  innerUrl: /内网[^\n：:]*面板地址[:：]\s*`?(https?:\/\/[^\s`]+)/,
  // 匹配 "username:" 或 "panel username:" 等
  username: /(?:panel\s*)?username[:：]\s*`?([^\s`]+)/i,
  password: /(?:panel\s*)?password[:：]\s*`?([^\s`]+)/i,
  port: /(?:panel\s*)?port[:：]\s*(\d+)/i,
};

// 国际版 aapanel 兼容
const AAPANEL_PATTERNS = {
  url: /External Panel[:：]\s*`?(https?:\/\/[^\s`]+)/,
  innerUrl: /Internal Panel[:：]\s*`?(https?:\/\/[^\s`]+)/,
  username: /(?:panel\s*)?username[:：]\s*`?([^\s`]+)/i,
  password: /(?:panel\s*)?password[:：]\s*`?([^\s`]+)/i,
};

export class BtCapture {
  private buffer = '';
  private captured: BtPanelCaptured = {};
  private completed = false;
  private onCompleteCallback?: (info: BtPanelCaptured) => void | Promise<void>;

  onComplete(cb: (info: BtPanelCaptured) => void | Promise<void>): void {
    this.onCompleteCallback = cb;
  }

  feed(text: string): void {
    if (this.completed) return;
    // 先剥离 ANSI 转义码，避免颜色码嵌入文本中间破坏正则匹配
    this.buffer += stripAnsi(text);

    // 防止 buffer 无限增长（增大容量避免截断关键信息）
    if (this.buffer.length > 500000) {
      this.buffer = this.buffer.slice(-300000);
    }

    // 中文版
    for (const [key, pattern] of Object.entries(BT_PATTERNS)) {
      if (!this.captured[key as keyof BtPanelCaptured]) {
        const m = this.buffer.match(pattern);
        if (m) {
          (this.captured as Record<string, unknown>)[key] = m[1];
        }
      }
    }
    // 英文版 fallback
    for (const [key, pattern] of Object.entries(AAPANEL_PATTERNS)) {
      if (!this.captured[key as keyof BtPanelCaptured]) {
        const m = this.buffer.match(pattern);
        if (m) {
          (this.captured as Record<string, unknown>)[key] = m[1];
        }
      }
    }

    // 4 个核心字段（URL + username + password）齐了就算完成
    if (this.captured.url && this.captured.username && this.captured.password && !this.completed) {
      this.completed = true;
      // 提取端口
      if (this.captured.url) {
        try {
          const u = new URL(this.captured.url);
          if (u.port) this.captured.panelPort = parseInt(u.port, 10);
        } catch {
          // ignore
        }
      }
      void this.onCompleteCallback?.(this.captured);
    }
  }

  getCaptured(): BtPanelCaptured {
    return { ...this.captured };
  }

  isCompleted(): boolean {
    return this.completed;
  }
}
