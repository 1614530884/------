'use client';

/**
 * SSH 终端组件
 *
 * 参考网页ssh远程项目模式重写：
 * - onData/onResize 在 xterm 初始化时一次性绑定（消除竞态条件）
 * - 使用 wsRef.current 替代闭包 ws 变量
 * - xterm 初始化后通过 setTimeout 触发连接
 * - 心跳保活（25s ping）
 * - 命令窗保持最底部（fit 后 scrollToBottom）
 * - 右键复制选中文本
 */
import { useEffect, useRef, useState, useImperativeHandle, forwardRef } from 'react';
import '@xterm/xterm/css/xterm.css';
import type { Terminal } from '@xterm/xterm';
import type { FitAddon } from '@xterm/addon-fit';
import { toast } from 'sonner';
import { Clipboard } from 'lucide-react';
import { handleAuthExpired } from '@/lib/auth-client';

export interface SshTerminalHandle {
  /** 主动建立连接 */
  connect: () => void;
  /** 主动断开 */
  disconnect: () => void;
  /** 是否已连接 */
  isConnected: () => boolean;
  /** 发送原始 WS 消息（快捷命令/检测数据盘等） */
  send: (type: string, payload?: unknown) => void;
  /** 写入终端输入（等价于 send('input', { data })） */
  write: (data: string) => void;
}

interface SshTerminalProps {
  connectionId: string;
  host: string;
  port: number;
  username: string;
  password: string;
  onStatusChange?: (status: string) => void;
  onStats?: (stats: unknown) => void;
  onDataDisk?: (result: unknown) => void;
  className?: string;
}

const SshTerminal = forwardRef<SshTerminalHandle, SshTerminalProps>(function SshTerminal(
  { connectionId, host, port, username, password, onStatusChange, onStats, onDataDisk, className },
  ref,
) {
  const containerRef = useRef<HTMLDivElement>(null);
  const termRef = useRef<Terminal | null>(null);
  const fitRef = useRef<FitAddon | null>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const isInitializedRef = useRef(false);
  const tokenRef = useRef<string | null>(null);
  const heartbeatTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const pasteFnRef = useRef<(() => void) | null>(null);

  const [connected, setConnected] = useState(false);
  const [status, setStatus] = useState<'idle' | 'connecting' | 'creating_shell' | 'connected' | 'disconnected' | 'error'>('idle');
  const [tokenReady, setTokenReady] = useState(false);

  // 更新状态并通知外部
  const updateStatus = (s: typeof status) => {
    setStatus(s);
    onStatusChange?.(s);
  };

  // ─── 获取 WS Token ──────────────────────────────────────
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const resp = await fetch('/api/ws-token');
        if (resp.status === 401) {
          toast.error('会话已过期，请重新登录');
          void handleAuthExpired();
          return;
        }
        if (!resp.ok) {
          toast.error(`获取会话凭证失败 (HTTP ${resp.status})`);
          return;
        }
        const data = await resp.json() as { token?: string };
        if (!cancelled && data.token) {
          tokenRef.current = data.token;
          setTokenReady(true);
        }
      } catch (err) {
        toast.error(err instanceof Error ? err.message : '获取会话凭证失败');
      }
    })();
    return () => { cancelled = true; };
  }, []);

  // ─── 连接 WebSocket + SSH ────────────────────────────────
  const connect = () => {
    if (!tokenRef.current) {
      toast.error('会话凭证未就绪');
      return;
    }
    if (wsRef.current && (wsRef.current.readyState === WebSocket.OPEN || wsRef.current.readyState === WebSocket.CONNECTING)) {
      return;
    }

    // 关闭旧连接
    if (wsRef.current) {
      try { wsRef.current.close(); } catch { /* ignore */ }
      wsRef.current = null;
    }
    if (heartbeatTimerRef.current) {
      clearInterval(heartbeatTimerRef.current);
      heartbeatTimerRef.current = null;
    }

    updateStatus('connecting');
    if (termRef.current) {
      termRef.current.reset();
      termRef.current.writeln('\x1b[33m正在连接 SSH 服务器...\x1b[0m\r\n');
    }

    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const ws = new WebSocket(`${protocol}//${window.location.host}/ws/ssh?token=${tokenRef.current}`);
    wsRef.current = ws;

    ws.onopen = () => {
      // 心跳保活
      heartbeatTimerRef.current = setInterval(() => {
        if (wsRef.current?.readyState === WebSocket.OPEN) {
          try { wsRef.current.send(JSON.stringify({ type: 'ping' })); } catch { /* ignore */ }
        }
      }, 25000);

      // 发送连接请求（带初始终端尺寸，避免 pty 默认 80x24 与 xterm 不匹配）
      const term = termRef.current;
      ws.send(JSON.stringify({
        type: 'connect',
        payload: {
          connectionId, host, port, username, password,
          cols: term?.cols ?? 80,
          rows: term?.rows ?? 24,
        },
      }));
    };

    ws.onmessage = event => {
      let msg: { type: string; payload?: unknown };
      try {
        msg = JSON.parse(event.data);
      } catch {
        return;
      }
      switch (msg.type) {
        case 'status': {
          const s = msg.payload as string;
          if (s === 'connected') {
            updateStatus('connected');
            setConnected(true);
            // 发送初始尺寸
            const term = termRef.current;
            if (term) {
              ws.send(JSON.stringify({ type: 'resize', payload: { cols: term.cols, rows: term.rows } }));
            }
            // 滚动到底部
            setTimeout(() => {
              termRef.current?.scrollToBottom();
            }, 50);
          } else if (s === 'disconnected') {
            setConnected(false);
            updateStatus('disconnected');
          } else if (s === 'creating_shell' || s === 'connecting') {
            updateStatus(s as typeof status);
          }
          break;
        }
        case 'output': {
          const term = termRef.current;
          if (term) {
            // 记录写入前是否处于底部，仅在用户未上滚时自动滚动到底部
            const buffer = term.buffer.active;
            const wasAtBottom = buffer.baseY + term.rows >= buffer.length;
            term.write(msg.payload as string);
            if (wasAtBottom) {
              term.scrollToBottom();
            }
          }
          break;
        }
        case 'error': {
          const term = termRef.current;
          term?.write(`\r\n\x1b[31m[错误] ${msg.payload}\x1b[0m\r\n`);
          updateStatus('error');
          setConnected(false);
          break;
        }
        case 'stats':
          onStats?.(msg.payload);
          break;
        case 'datadisk_result':
          onDataDisk?.(msg.payload);
          break;
        case 'pong':
          break;
      }
    };

    ws.onerror = () => {
      const term = termRef.current;
      term?.write(`\r\n\x1b[31m[WebSocket 错误]\x1b[0m\r\n`);
      updateStatus('error');
      setConnected(false);
    };

    ws.onclose = () => {
      if (heartbeatTimerRef.current) {
        clearInterval(heartbeatTimerRef.current);
        heartbeatTimerRef.current = null;
      }
      setConnected(false);
      // 仅在非 error 状态时显示 disconnected
      if (status !== 'error') {
        updateStatus('disconnected');
      }
    };
  };

  // ─── 断开 ────────────────────────────────────────────────
  const disconnect = () => {
    if (heartbeatTimerRef.current) {
      clearInterval(heartbeatTimerRef.current);
      heartbeatTimerRef.current = null;
    }
    if (wsRef.current) {
      try { wsRef.current.close(); } catch { /* ignore */ }
      wsRef.current = null;
    }
    setConnected(false);
    updateStatus('disconnected');
  };

  // ─── 暴露 ref handle ─────────────────────────────────────
  useImperativeHandle(ref, () => ({
    connect,
    disconnect,
    isConnected: () => connected,
    send: (type: string, payload?: unknown) => {
      if (wsRef.current?.readyState === WebSocket.OPEN) {
        wsRef.current.send(JSON.stringify({ type, payload }));
      }
    },
    write: (data: string) => {
      if (wsRef.current?.readyState === WebSocket.OPEN) {
        wsRef.current.send(JSON.stringify({ type: 'input', payload: { data } }));
      }
    },
  }), [connected]);

  // ─── 初始化 xterm（只一次）+ 绑定 onData/onResize ─────────
  useEffect(() => {
    if (isInitializedRef.current) return;
    if (!containerRef.current) return;
    let disposed = false;
    // 保存 contextmenu/auxclick 监听器引用，便于 cleanup 时移除
    let contextMenuHandler: ((e: MouseEvent) => void) | null = null;
    let auxClickHandler: ((e: MouseEvent) => void) | null = null;

    (async () => {
      const [{ Terminal }, { FitAddon }, { WebLinksAddon }] = await Promise.all([
        import('@xterm/xterm'),
        import('@xterm/addon-fit'),
        import('@xterm/addon-web-links'),
      ]);
      if (disposed || !containerRef.current) return;

      const term = new Terminal({
        cols: 80,
        rows: 24,
        cursorBlink: true,
        fontSize: 13,
        fontFamily: 'Menlo, Monaco, "Courier New", monospace',
        allowProposedApi: true,
        scrollback: 5000,
        // 不使用 rightClickSelectsWord，改为自定义右键复制（见下方 contextmenu 监听）
        theme: {
          background: '#0a0a0a',
          foreground: '#e4e4e7',
          cursor: '#e4e4e7',
          // 选择背景使用半透明蓝色，明显但不刺眼；selectionForeground 保证选中文字可读
          selectionBackground: 'rgba(59, 130, 246, 0.35)',
          selectionForeground: '#ffffff',
          black: '#0a0a0a',
          red: '#ef4444',
          green: '#22c55e',
          yellow: '#eab308',
          blue: '#3b82f6',
          magenta: '#a855f7',
          cyan: '#06b6d4',
          white: '#e4e4e7',
          brightBlack: '#525252',
          brightRed: '#f87171',
          brightGreen: '#4ade80',
          brightYellow: '#facc15',
          brightBlue: '#60a5fa',
          brightMagenta: '#c084fc',
          brightCyan: '#22d3ee',
          brightWhite: '#fafafa',
        },
      });

      const fit = new FitAddon();
      term.loadAddon(fit);
      term.loadAddon(new WebLinksAddon());
      term.open(containerRef.current);
      try { fit.fit(); } catch { /* ignore */ }

      // 粘贴剪贴板内容到终端（右键无选中时触发，或移动端粘贴按钮触发）
      const pasteToTerminal = (): void => {
        if (navigator.clipboard?.readText) {
          navigator.clipboard.readText().then(text => {
            if (text) {
              const ws = wsRef.current;
              if (ws?.readyState === WebSocket.OPEN) {
                ws.send(JSON.stringify({ type: 'input', payload: { data: text } }));
                toast.success('已粘贴', { duration: 1500 });
              }
            } else {
              toast.info('剪贴板为空', { duration: 1500 });
            }
          }).catch(() => {
            toast.error('读取剪贴板失败（浏览器可能限制了访问）', { duration: 2500 });
          });
        } else {
          toast.error('当前浏览器不支持剪贴板读取，请使用 Ctrl+V', { duration: 2500 });
        }
      };
      // 暴露给移动端按钮使用
      pasteFnRef.current = pasteToTerminal;

      // 拦截 Ctrl+V / Cmd+V：xterm 默认把 Ctrl+V 当作控制字符 ^V(quoted-insert)发送给远端，
      // 导致 bash 进入字面输入模式干扰粘贴。return false 阻止 ^V 发送，
      // 让浏览器 paste 事件触发，由 xterm 内置 paste（读取 clipboardData，http 部署也可用）写入终端
      term.attachCustomKeyEventHandler((event: KeyboardEvent) => {
        if ((event.ctrlKey || event.metaKey) && event.code === 'KeyV' && event.type === 'keydown') {
          return false;
        }
        return true;
      });

      // 右键：有选中文本 → 复制；无选中 → 粘贴剪贴板内容到终端
      // 这样用户在终端内右键即可完成复制/粘贴，无需额外快捷键
      contextMenuHandler = (e: MouseEvent) => {
        e.preventDefault();
        e.stopPropagation();
        const sel = term.getSelection();
        if (sel) {
          // 有选中 → 复制
          if (navigator.clipboard?.writeText) {
            navigator.clipboard.writeText(sel).then(
              () => toast.success('已复制', { duration: 1500 }),
              () => fallbackCopy(sel),
            );
          } else {
            fallbackCopy(sel);
          }
        } else {
          // 无选中 → 粘贴剪贴板到终端
          pasteToTerminal();
        }
      };
      containerRef.current.addEventListener('contextmenu', contextMenuHandler);

      // 中键粘贴（Linux 习惯）
      auxClickHandler = (e: MouseEvent) => {
        if (e.button !== 1) return; // 非中键
        e.preventDefault();
        if (navigator.clipboard?.readText) {
          navigator.clipboard.readText().then(text => {
            if (text) {
              const ws = wsRef.current;
              if (ws?.readyState === WebSocket.OPEN) {
                ws.send(JSON.stringify({ type: 'input', payload: { data: text } }));
              }
            }
          }).catch(() => { /* ignore */ });
        }
      };
      containerRef.current.addEventListener('auxclick', auxClickHandler);

      // 在初始化时一次性绑定 onData（使用 wsRef.current，消除竞态）
      term.onData((data: string) => {
        const ws = wsRef.current;
        if (ws && ws.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify({ type: 'input', payload: { data } }));
        }
      });

      // 在初始化时一次性绑定 onResize
      term.onResize(({ cols, rows }: { cols: number; rows: number }) => {
        const ws = wsRef.current;
        if (ws && ws.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify({ type: 'resize', payload: { cols, rows } }));
        }
      });

      termRef.current = term;
      fitRef.current = fit;
      isInitializedRef.current = true;

      // 显示欢迎信息
      term.writeln('\x1b[33m准备连接 SSH 服务器...\x1b[0m\r\n');

      // 延迟自动连接（确保 token 已就绪）
      const tryConnect = () => {
        if (tokenRef.current) {
          connect();
        } else {
          // token 还没就绪，等待 200ms 重试
          setTimeout(tryConnect, 200);
        }
      };
      setTimeout(tryConnect, 100);
    })();

    const onResize = () => {
      try {
        fitRef.current?.fit();
        // fit 后保持滚动到底部
        termRef.current?.scrollToBottom();
      } catch { /* ignore */ }
    };
    window.addEventListener('resize', onResize);

    // ResizeObserver：监听容器尺寸变化（左右栏折叠/展开、文件管理器切换等不触发 window resize 的情况）
    let resizeObserver: ResizeObserver | null = null;
    if (containerRef.current && typeof ResizeObserver !== 'undefined') {
      resizeObserver = new ResizeObserver(() => {
        // 防抖：避免快速连续触发
        try { fitRef.current?.fit(); } catch { /* ignore */ }
      });
      resizeObserver.observe(containerRef.current);
    }

    return () => {
      disposed = true;
      window.removeEventListener('resize', onResize);
      resizeObserver?.disconnect();
      if (contextMenuHandler && containerRef.current) {
        containerRef.current.removeEventListener('contextmenu', contextMenuHandler);
      }
      if (auxClickHandler && containerRef.current) {
        containerRef.current.removeEventListener('auxclick', auxClickHandler);
      }
      if (heartbeatTimerRef.current) {
        clearInterval(heartbeatTimerRef.current);
        heartbeatTimerRef.current = null;
      }
      if (wsRef.current) {
        try { wsRef.current.close(); } catch { /* ignore */ }
        wsRef.current = null;
      }
      termRef.current?.dispose();
      termRef.current = null;
      isInitializedRef.current = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ─── Token 到位后，如果尚未连接则触发连接 ────────────────
  useEffect(() => {
    if (tokenReady && !connected && status === 'idle' && isInitializedRef.current) {
      connect();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tokenReady]);

  return (
    <div className={`relative h-full w-full bg-[#0a0a0a] ${className ?? ''}`}>
      <div ref={containerRef} className="h-full w-full p-1 overflow-hidden" />
      {/* 粘贴按钮：连接时显示在右上角，方便移动端/桌面端快速粘贴 */}
      {connected && (
        <button
          onClick={() => pasteFnRef.current?.()}
          className="absolute top-1.5 right-1.5 z-10 p-1.5 bg-muted/80 hover:bg-accent text-muted-foreground hover:text-foreground rounded border border-border/50 backdrop-blur-sm transition-colors"
          title="粘贴剪贴板内容"
        >
          <Clipboard className="w-3.5 h-3.5" />
        </button>
      )}
      {!connected && status !== 'connecting' && status !== 'creating_shell' && (
        <div className="absolute inset-0 flex items-center justify-center bg-[#0a0a0a]/85 backdrop-blur-sm pointer-events-none">
          <div className="text-center pointer-events-auto">
            <div className="text-sm text-muted-foreground mb-3">
              {status === 'idle' && '准备中...'}
              {status === 'disconnected' && '连接已断开'}
              {status === 'error' && '连接失败'}
            </div>
            {(status === 'disconnected' || status === 'error' || status === 'idle') && (
              <button
                onClick={connect}
                className="px-3 py-1.5 text-xs bg-muted hover:bg-accent text-foreground rounded border border-border"
              >
                重新连接
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
});

export default SshTerminal;

/**
 * 剪贴板 API 不可用时的后备复制方案（非安全上下文 http://）
 */
function fallbackCopy(text: string): void {
  try {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.style.position = 'fixed';
    ta.style.left = '-9999px';
    ta.style.top = '0';
    ta.setAttribute('readonly', '');
    document.body.appendChild(ta);
    ta.select();
    const ok = document.execCommand('copy');
    document.body.removeChild(ta);
    if (ok) {
      toast.success('已复制', { duration: 1500 });
    } else {
      toast.error('复制失败，请手动复制');
    }
  } catch {
    toast.error('复制失败，请手动复制');
  }
}
