'use client';

import { useState, useCallback, useRef, useEffect } from 'react';
import { Star, Paperclip, FileText, X, ZoomIn, ZoomOut, RotateCcw, Headphones, User as UserIcon } from 'lucide-react';
import {
  Dialog, DialogContent, DialogClose, DialogTitle,
} from '@/components/ui/dialog';

export interface TicketMessage {
  id: number;
  type: string;
  content: string;
  format_time: string;
  user: string;
  realname: string;
  user_type: string;
  attachment?: string[] | null;
  star?: number;
  mode?: string;
  mode_zh?: string;
  desc?: string;
  remarks?: string;
  from?: string;
  to?: string;
}

interface TicketConversationProps {
  messages: TicketMessage[];
  loading?: boolean;
  userAvatar?: string;
}

function formatShortTime(timeStr: string): string {
  if (!timeStr) return '';
  const d = new Date(String(timeStr).replace(/-/g, '/'));
  if (isNaN(d.getTime())) return timeStr;
  const now = new Date();
  const hh = String(d.getHours()).padStart(2, '0');
  const mm = String(d.getMinutes()).padStart(2, '0');
  if (d.toDateString() === now.toDateString()) return `${hh}:${mm}`;
  const mo = d.getMonth() + 1;
  const dd = d.getDate();
  if (d.getFullYear() === now.getFullYear()) return `${mo}/${dd} ${hh}:${mm}`;
  return `${d.getFullYear()}/${mo}/${dd} ${hh}:${mm}`;
}

function renderContent(content: string): string {
  if (!content) return '';
  let text = content;
  // 先解码HTML实体（处理被实体编码的HTML内容，如 &lt;!DOCTYPE）
  text = text.replace(/&nbsp;/g, ' ');
  text = text.replace(/&lt;/g, '<');
  text = text.replace(/&gt;/g, '>');
  text = text.replace(/&quot;/g, '"');
  text = text.replace(/&#39;/g, "'");
  text = text.replace(/&amp;/g, '&');
  // 解码后重新检测HTML标签
  const hasHtmlTag = /<[a-z/!][^>]*>/i.test(text);
  if (hasHtmlTag) {
    if (text.includes('<html') || text.includes('<!DOCTYPE') || text.includes('<body')) {
      const bodyMatch = text.match(/<body[^>]*>([\s\S]*?)<\/body>/i);
      if (bodyMatch) text = bodyMatch[1];
    }
    text = text.replace(/<br\s*\/?>/gi, '\n');
    text = text.replace(/<\/p>\s*<p[^>]*>/gi, '\n\n');
    text = text.replace(/<p[^>]*>/gi, '');
    text = text.replace(/<\/p>/gi, '');
    text = text.replace(/<[^>]+>/g, '');
  }
  return text.trim();
}

function normalizeAttachUrl(raw: string): string {
  const url = String(raw || '').trim();
  if (!url) return '';
  if (/^https?:\/\//i.test(url)) return url;
  if (/^\/\//.test(url)) return `https:${url}`;
  if (/^\//.test(url)) return `https://www.95vps.com${url}`;
  return `https://${url}`;
}

function isImageUrl(url: string): boolean {
  if (!url) return false;
  const cleanUrl = url.split('?')[0].split('#')[0];
  return /\.(jpg|jpeg|png|gif|webp|bmp|svg)$/i.test(cleanUrl);
}

function getAttachments(attachment: unknown): string[] {
  if (!attachment) return [];
  if (Array.isArray(attachment)) {
    return attachment
      .map((item) => (typeof item === 'string' ? item.trim() : ''))
      .filter((s) => s.length > 0);
  }
  if (typeof attachment === 'string') {
    const trimmed = attachment.trim();
    return trimmed ? [trimmed] : [];
  }
  return [];
}

function AttachmentList({ attachments, onPreview }: {
  attachments: string[];
  onPreview: (img: string, name: string) => void;
}) {
  if (!attachments || attachments.length === 0) return null;
  return (
    <div className="mt-2 flex flex-wrap gap-2">
      {attachments.map((rawUrl, idx) => {
        const url = normalizeAttachUrl(rawUrl);
        const fileName = url.split('/').pop() || `附件${idx + 1}`;
        if (isImageUrl(url)) {
          return (
            <div
              key={idx}
              className="rounded-lg overflow-hidden border border-border/50 max-w-[200px] cursor-pointer group relative"
              onClick={(e) => {
                e.stopPropagation();
                onPreview(url, fileName);
              }}
            >
              <img src={url} alt={fileName} className="w-full h-auto block max-h-[200px] object-cover" />
              <div className="absolute inset-0 bg-black/0 group-hover:bg-black/40 transition-colors flex items-center justify-center">
                <ZoomIn className="w-5 h-5 text-white opacity-0 group-hover:opacity-100 transition-opacity" />
              </div>
            </div>
          );
        }
        return (
          <a
            key={idx}
            href={url}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1.5 text-xs text-primary hover:underline rounded-md border border-border/50 px-2 py-1 max-w-[220px]"
          >
            <Paperclip className="w-3.5 h-3.5 shrink-0" />
            <span className="truncate">{fileName}</span>
          </a>
        );
      })}
    </div>
  );
}

function StarRating({ star }: { star?: number }) {
  if (!star || star <= 0) return null;
  return (
    <div className="flex items-center gap-0.5 mt-1">
      {Array.from({ length: 5 }).map((_, i) => (
        <Star
          key={i}
          className={`w-3 h-3 ${i < star ? 'fill-amber-400 text-amber-400' : 'text-muted-foreground/30'}`}
        />
      ))}
    </div>
  );
}

function isAdminType(msg: TicketMessage): boolean {
  const v = String(msg.user_type || '').trim();
  if (v === '管理员' || v === 'admin' || v === '1') return true;
  if (v === '用户' || v === 'user' || v === '0') return false;
  if (msg.realname && String(msg.realname).trim() !== '') return true;
  return false;
}

function Avatar({ isAdmin, userAvatar, displayName }: { isAdmin: boolean; userAvatar?: string; displayName: string }) {
  const [imgError, setImgError] = useState(false);
  if (userAvatar && !imgError) {
    return (
      <img
        src={userAvatar}
        alt={displayName}
        onError={() => setImgError(true)}
        className="w-8 h-8 rounded-full shrink-0 object-cover border border-border"
        referrerPolicy="no-referrer"
      />
    );
  }
  return (
    <div className={`w-8 h-8 rounded-full shrink-0 flex items-center justify-center ${
      isAdmin ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground border border-border'
    }`}>
      {isAdmin ? <Headphones className="w-4 h-4" /> : <UserIcon className="w-4 h-4" />}
    </div>
  );
}

function TicketOriginCard({ msg, onPreview, userAvatar }: { msg: TicketMessage; onPreview: (img: string, name: string) => void; userAvatar?: string }) {
  const attachments = getAttachments(msg.attachment);
  const isAdmin = isAdminType(msg);
  const displayName = msg.realname || msg.user || (isAdmin ? '客服' : '用户');
  const avatar = isAdmin ? undefined : userAvatar;
  return (
    <div className="flex justify-center my-4">
      <div className="max-w-[90%] rounded-xl border border-border bg-muted/30 px-4 py-3 text-center">
        <div className="flex items-center justify-center gap-2 mb-2">
          <Avatar isAdmin={isAdmin} userAvatar={avatar} displayName={displayName} />
          <div className="text-xs text-muted-foreground text-left min-w-0">
            <span className="font-medium text-foreground">{displayName}</span>
            <span className="ml-1 shrink-0">创建工单 · {formatShortTime(msg.format_time)}</span>
          </div>
        </div>
        <p className="text-sm text-foreground whitespace-pre-wrap break-words text-left">
          {renderContent(msg.content)}
        </p>
        <AttachmentList attachments={attachments} onPreview={onPreview} />
      </div>
    </div>
  );
}

function TicketNoteBlock({ msg }: { msg: TicketMessage }) {
  return (
    <div className="my-2">
      <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2">
        <div className="flex items-center gap-1.5 text-xs text-amber-600 dark:text-amber-400 mb-1">
          <FileText className="w-3 h-3" />
          <span className="font-medium">内部备注</span>
          <span>· {msg.realname || msg.user || '管理员'}</span>
          <span className="shrink-0">· {formatShortTime(msg.format_time)}</span>
        </div>
        <p className="text-sm text-foreground whitespace-pre-wrap break-words">
          {renderContent(msg.content)}
        </p>
      </div>
    </div>
  );
}

function TicketTransferLog({ msg }: { msg: TicketMessage }) {
  return (
    <div className="flex justify-center my-2">
      <div className="text-xs text-muted-foreground bg-muted/50 rounded-full px-3 py-1">
        {msg.mode_zh || '工单转移'}：{msg.from || '?'} → {msg.to || '?'}
        {msg.remarks ? `（${msg.remarks}）` : ''}
        <span className="ml-1 shrink-0">· {formatShortTime(msg.format_time)}</span>
      </div>
    </div>
  );
}

function ReplyBubble({ msg, onPreview, userAvatar }: { msg: TicketMessage; onPreview: (img: string, name: string) => void; userAvatar?: string }) {
  const isAdmin = isAdminType(msg);
  const displayName = msg.realname || msg.user || (isAdmin ? '客服' : '用户');
  const attachments = getAttachments(msg.attachment);
  const avatar = isAdmin ? undefined : userAvatar;

  return (
    <div className={`flex ${isAdmin ? 'justify-end' : 'justify-start'} my-2`}>
      <div className={`flex items-end gap-2 max-w-[85%] ${isAdmin ? 'flex-row-reverse' : 'flex-row'}`}>
        <Avatar isAdmin={isAdmin} userAvatar={avatar} displayName={displayName} />
        <div className={`max-w-[calc(100%-2.5rem)] rounded-2xl px-3.5 py-2.5 ${
          isAdmin
            ? 'bg-primary text-primary-foreground rounded-tr-sm'
            : 'bg-muted text-foreground rounded-tl-sm'
        }`}>
          <div className={`flex items-center gap-1.5 text-xs mb-1 min-w-0 ${isAdmin ? 'text-primary-foreground/70' : 'text-muted-foreground'}`}>
            <span className="font-medium truncate">{displayName}</span>
            <span className="opacity-80 shrink-0 whitespace-nowrap">{formatShortTime(msg.format_time)}</span>
          </div>
          <div className="text-sm whitespace-pre-wrap break-words leading-relaxed">
            {renderContent(msg.content)}
          </div>
          <AttachmentList attachments={attachments} onPreview={onPreview} />
          {isAdmin && <StarRating star={msg.star} />}
        </div>
      </div>
    </div>
  );
}

export function TicketConversation({ messages, loading, userAvatar }: TicketConversationProps) {
  const [previewImg, setPreviewImg] = useState<{ img: string; name: string } | null>(null);
  const messagesEndRef = useRef<HTMLDivElement | null>(null);

  const [zoom, setZoom] = useState(1);
  const [offset, setOffset] = useState<{ x: number; y: number }>({ x: 0, y: 0 });
  const [isDragging, setIsDragging] = useState(false);
  const dragStartRef = useRef<{ x: number; y: number; ox: number; oy: number }>({ x: 0, y: 0, ox: 0, oy: 0 });
  const imgContainerRef = useRef<HTMLDivElement | null>(null);

  const handlePreview = useCallback((img: string, name: string) => {
    setPreviewImg({ img, name });
  }, []);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
  }, [messages]);

  // 切换图片时重置缩放和偏移
  useEffect(() => {
    if (previewImg) {
      setZoom(1);
      setOffset({ x: 0, y: 0 });
    }
  }, [previewImg]);

  // 滚轮缩放：需用原生 addEventListener 才能阻止 passive 默认滚动
  useEffect(() => {
    if (!previewImg) return;
    const el = imgContainerRef.current;
    if (!el) return;
    const handleWheel = (e: WheelEvent) => {
      e.preventDefault();
      const delta = e.deltaY > 0 ? -0.15 : 0.15;
      setZoom((z) => {
        const next = Math.min(5, Math.max(1, +(z + delta).toFixed(2)));
        if (next <= 1) setOffset({ x: 0, y: 0 });
        return next;
      });
    };
    el.addEventListener('wheel', handleWheel, { passive: false });
    return () => el.removeEventListener('wheel', handleWheel);
  }, [previewImg]);

  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    if (zoom <= 1) return;
    setIsDragging(true);
    dragStartRef.current = { x: e.clientX, y: e.clientY, ox: offset.x, oy: offset.y };
  }, [zoom, offset]);

  const handleMouseMove = useCallback((e: React.MouseEvent) => {
    if (!isDragging) return;
    setOffset({
      x: dragStartRef.current.ox + (e.clientX - dragStartRef.current.x),
      y: dragStartRef.current.oy + (e.clientY - dragStartRef.current.y),
    });
  }, [isDragging]);

  const handleMouseUp = useCallback(() => {
    setIsDragging(false);
  }, []);

  const resetZoom = useCallback(() => {
    setZoom(1);
    setOffset({ x: 0, y: 0 });
  }, []);

  if (loading) {
    return (
      <div className="space-y-3 py-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className={`flex ${i % 2 === 0 ? 'justify-start' : 'justify-end'}`}>
            <div className="max-w-[70%] h-16 rounded-2xl bg-accent animate-pulse" />
          </div>
        ))}
      </div>
    );
  }

  if (!messages || messages.length === 0) {
    return (
      <div className="py-12 text-center text-sm text-muted-foreground">
        暂无沟通记录
      </div>
    );
  }

  return (
    <>
      <div className="py-2">
        {messages.map((msg, idx) => {
          const key = `${msg.id}-${idx}`;
          if (msg.type === 't') return <TicketOriginCard key={key} msg={msg} onPreview={handlePreview} userAvatar={userAvatar} />;
          if (msg.type === 'n') return <TicketNoteBlock key={key} msg={msg} />;
          if (msg.mode_zh || (msg.from && msg.to)) return <TicketTransferLog key={key} msg={msg} />;
          if (msg.type === 'r') return <ReplyBubble key={key} msg={msg} onPreview={handlePreview} userAvatar={userAvatar} />;
          return (
            <div key={key} className="text-xs text-muted-foreground text-center my-1">
              {msg.content} · {formatShortTime(msg.format_time)}
            </div>
          );
        })}
        <div ref={messagesEndRef} />
      </div>

      <Dialog open={!!previewImg} onOpenChange={(open) => { if (!open) setPreviewImg(null); }}>
        <DialogContent className="max-w-[90vw] sm:max-w-[90vw] max-h-[90dvh] p-0 bg-black/95 border-none overflow-hidden flex flex-col gap-0 w-auto min-w-[260px]" showCloseButton={false}>
          <DialogTitle className="sr-only">附件预览</DialogTitle>
          {previewImg && (
            <>
              <div className="shrink-0 flex items-center justify-between gap-2 px-3 py-2">
                <span className="text-xs text-white/80 truncate flex-1 min-w-0">
                  {previewImg.name}
                </span>
                <DialogClose className="w-9 h-9 rounded-full bg-white/10 text-white flex items-center justify-center hover:bg-white/20 transition-colors shrink-0">
                  <X className="w-4 h-4" />
                </DialogClose>
              </div>

              <div
                ref={imgContainerRef}
                className="flex items-center justify-center overflow-hidden"
                onMouseDown={handleMouseDown}
                onMouseMove={handleMouseMove}
                onMouseUp={handleMouseUp}
                onMouseLeave={handleMouseUp}
              >
                <img
                  src={previewImg.img}
                  alt={previewImg.name}
                  draggable={false}
                  className="max-w-[90vw] object-contain transition-transform duration-150 ease-out select-none block"
                  style={{
                    maxHeight: 'calc(90dvh - 6rem)',
                    transform: `translate(${offset.x}px, ${offset.y}px) scale(${zoom})`,
                    cursor: zoom > 1 ? (isDragging ? 'grabbing' : 'grab') : 'default',
                  }}
                />
              </div>

              <div className="shrink-0 flex items-center justify-center py-2">
                <div className="flex items-center gap-2 bg-black/70 rounded-full px-3 py-1.5">
                  <button
                    type="button"
                    onClick={() => setZoom((z) => Math.max(1, +(z - 0.25).toFixed(2)))}
                    className="text-white/90 hover:text-white p-1 transition-colors"
                    aria-label="缩小"
                  >
                    <ZoomOut className="w-4 h-4" />
                  </button>
                  <span className="text-xs text-white/80 min-w-[3rem] text-center tabular-nums">
                    {Math.round(zoom * 100)}%
                  </span>
                  <button
                    type="button"
                    onClick={() => setZoom((z) => Math.min(5, +(z + 0.25).toFixed(2)))}
                    className="text-white/90 hover:text-white p-1 transition-colors"
                    aria-label="放大"
                  >
                    <ZoomIn className="w-4 h-4" />
                  </button>
                  <div className="w-px h-4 bg-white/20 mx-1" />
                  <button
                    type="button"
                    onClick={resetZoom}
                    className="text-white/90 hover:text-white p-1 transition-colors"
                    aria-label="重置"
                  >
                    <RotateCcw className="w-4 h-4" />
                  </button>
                </div>
              </div>
            </>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}
