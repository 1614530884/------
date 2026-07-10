'use client';

/**
 * 通用错误边界组件
 *
 * 捕获子组件渲染时的同步错误，防止整个页面崩溃。
 * 提供友好的错误提示和重试按钮。
 */
import { Component, type ReactNode } from 'react';
import { AlertTriangle, RefreshCw } from 'lucide-react';

interface ErrorBoundaryProps {
  children: ReactNode;
  /** 自定义错误提示文案 */
  fallbackTitle?: string;
  /** 重试回调（可触发外部刷新） */
  onReset?: () => void;
}

interface ErrorBoundaryState {
  hasError: boolean;
  error: Error | null;
}

export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  constructor(props: ErrorBoundaryProps) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo): void {
    console.error('[ErrorBoundary]', error, info.componentStack);
  }

  handleReset = (): void => {
    this.props.onReset?.();
    this.setState({ hasError: false, error: null });
  };

  render(): ReactNode {
    if (!this.state.hasError) return this.props.children;
    return (
      <div className="flex flex-col items-center justify-center h-full p-6 text-center">
        <AlertTriangle className="w-8 h-8 text-warning mb-3" />
        <div className="text-sm text-foreground/80 mb-1">{this.props.fallbackTitle ?? '组件渲染出错'}</div>
        <div className="text-xs text-muted-foreground mb-4 max-w-md break-all">
          {this.state.error?.message ?? '未知错误'}
        </div>
        <button
          onClick={this.handleReset}
          className="flex items-center gap-1.5 px-3 py-1.5 text-xs bg-muted hover:bg-accent text-foreground rounded border border-border"
        >
          <RefreshCw className="w-3.5 h-3.5" />
          重试
        </button>
      </div>
    );
  }
}

export default ErrorBoundary;
