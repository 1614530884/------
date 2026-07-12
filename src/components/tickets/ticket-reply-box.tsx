'use client';

import { useState, useRef, useCallback } from 'react';
import { Loader2, Send, Eraser } from 'lucide-react';

interface TicketReplyBoxProps {
  ticketId: number;
  disabled?: boolean;
  onReplySent: () => void;
  callApi: (action: string, params: Record<string, unknown>) => Promise<Record<string, unknown>>;
}

export function TicketReplyBox({ ticketId, disabled, onReplySent, callApi }: TicketReplyBoxProps) {
  const [content, setContent] = useState('');
  const [sending, setSending] = useState(false);
  const [error, setError] = useState('');
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const handleSubmit = useCallback(async () => {
    if (!content.trim() || sending || disabled) return;
    setSending(true);
    setError('');
    try {
      const res = await callApi('ticketReply', { id: ticketId, content: content.trim() });
      if (res.success === false || (res.status && res.status !== 200 && res.status !== 1)) {
        setError(String(res.msg || res.message || '回复失败'));
        return;
      }
      setContent('');
      onReplySent();
    } catch (err) {
      setError(err instanceof Error ? err.message : '回复失败');
    } finally {
      setSending(false);
    }
  }, [content, sending, disabled, ticketId, callApi, onReplySent]);

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
      e.preventDefault();
      void handleSubmit();
    }
  };

  const insertText = (before: string, after: string = '') => {
    const textarea = textareaRef.current;
    if (!textarea) return;
    const start = textarea.selectionStart;
    const end = textarea.selectionEnd;
    const selected = content.substring(start, end);
    const newContent = content.substring(0, start) + before + selected + after + content.substring(end);
    setContent(newContent);
    requestAnimationFrame(() => {
      textarea.focus();
      textarea.setSelectionRange(start + before.length, end + before.length);
    });
  };

  return (
    <div className="border-t border-border bg-card p-3 shrink-0 z-10">
      {error && (
        <div className="mb-2 text-xs text-destructive bg-destructive/10 rounded-lg px-3 py-1.5">
          {error}
        </div>
      )}
      <div className="flex items-center gap-1 mb-2">
        <button
          type="button"
          onClick={() => insertText('<b>', '</b>')}
          className="px-2 py-1 text-xs rounded border border-border hover:bg-accent text-muted-foreground hover:text-foreground transition-colors font-bold"
          title="加粗"
        >
          B
        </button>
        <button
          type="button"
          onClick={() => insertText('<i>', '</i>')}
          className="px-2 py-1 text-xs rounded border border-border hover:bg-accent text-muted-foreground hover:text-foreground transition-colors italic"
          title="斜体"
        >
          I
        </button>
        <button
          type="button"
          onClick={() => insertText('<code>', '</code>')}
          className="px-2 py-1 text-xs rounded border border-border hover:bg-accent text-muted-foreground hover:text-foreground transition-colors font-mono"
          title="代码"
        >
          {'</>'}
        </button>
        <div className="h-4 w-px bg-border mx-1" />
        <button
          type="button"
          onClick={() => insertText('\n• ')}
          className="px-2 py-1 text-xs rounded border border-border hover:bg-accent text-muted-foreground hover:text-foreground transition-colors"
          title="列表项"
        >
          •
        </button>
        <div className="flex-1" />
        <button
          type="button"
          onClick={() => setContent('')}
          disabled={!content || sending}
          className="inline-flex items-center gap-1 px-2 py-1 text-xs rounded border border-border hover:bg-accent text-muted-foreground hover:text-foreground transition-colors disabled:opacity-50"
        >
          <Eraser className="w-3 h-3" />
          清空
        </button>
      </div>
      <textarea
        ref={textareaRef}
        value={content}
        onChange={(e) => setContent(e.target.value)}
        onKeyDown={handleKeyDown}
        disabled={disabled || sending}
        placeholder={disabled ? '工单已关闭，无法回复' : '输入回复内容... (Ctrl+Enter 发送)'}
        className="w-full min-h-[80px] max-h-[200px] resize-y rounded-lg border border-border bg-background p-3 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:border-primary focus:ring-1 focus:ring-primary/30 transition-colors disabled:opacity-60"
      />
      <div className="flex items-center justify-between mt-2">
        <span className="text-xs text-muted-foreground">
          {content.length > 0 && `${content.length} 字`}
        </span>
        <button
          type="button"
          onClick={handleSubmit}
          disabled={!content.trim() || sending || disabled}
          className="inline-flex items-center gap-1.5 rounded-lg bg-primary text-primary-foreground px-4 py-1.5 text-sm font-medium hover:bg-primary/90 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {sending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
          {sending ? '发送中...' : '发送回复'}
        </button>
      </div>
    </div>
  );
}
