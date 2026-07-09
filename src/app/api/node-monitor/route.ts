import { NextRequest, NextResponse } from 'next/server';
import { randomUUID } from 'crypto';
import { readConfig, writeConfig, readLogs, clearLogs } from '@/lib/services/node-monitor-store';
import { nodeMonitorService } from '@/lib/services/node-monitor-service';
import type { MonitorRule } from '@/lib/services/node-monitor-types';

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const action = searchParams.get('action') || 'listRules';

  try {
    switch (action) {
      case 'listRules': {
        const config = readConfig();
        return NextResponse.json({ success: true, data: config });
      }
      case 'listLogs': {
        const page = Math.max(1, Number(searchParams.get('page')) || 1);
        const perPage = Math.min(100, Math.max(1, Number(searchParams.get('perPage')) || 50));
        const logs = readLogs();
        const total = logs.length;
        const start = (page - 1) * perPage;
        const items = logs.slice(start, start + perPage);
        return NextResponse.json({ success: true, data: { items, total, page, perPage } });
      }
      case 'status': {
        const status = nodeMonitorService.getStatus();
        return NextResponse.json({ success: true, data: status });
      }
      default:
        return NextResponse.json({ success: false, message: `未知操作: ${action}` });
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : '服务异常';
    return NextResponse.json({ success: false, message });
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { action } = body;

    switch (action) {
      case 'saveRule': {
        const config = readConfig();
        const rule = body.rule as MonitorRule | undefined;
        if (!rule) return NextResponse.json({ success: false, message: '缺少规则数据' });

        // 验证
        if (!rule.name?.trim()) return NextResponse.json({ success: false, message: '规则名称不能为空' });
        if (!rule.nodeIds?.length) return NextResponse.json({ success: false, message: '请选择至少一个节点' });
        if (rule.threshold < 0 || rule.threshold > 100) return NextResponse.json({ success: false, message: '阈值须在0-100之间' });
        if (rule.interval < 60) return NextResponse.json({ success: false, message: '检查间隔最小60秒' });
        if (rule.cooldown < 60) return NextResponse.json({ success: false, message: '冷却时间最小60秒' });

        if (rule.id) {
          const idx = config.rules.findIndex(r => r.id === rule.id);
          if (idx >= 0) {
            config.rules[idx] = rule;
          } else {
            config.rules.push(rule);
          }
        } else {
          rule.id = randomUUID();
          rule.createdAt = Date.now();
          config.rules.push(rule);
        }

        writeConfig(config);
        nodeMonitorService.restart();
        return NextResponse.json({ success: true, data: rule });
      }

      case 'deleteRule': {
        const config = readConfig();
        const ruleId = body.ruleId as string | undefined;
        if (!ruleId) return NextResponse.json({ success: false, message: '缺少规则ID' });

        config.rules = config.rules.filter(r => r.id !== ruleId);
        writeConfig(config);
        nodeMonitorService.restart();
        return NextResponse.json({ success: true });
      }

      case 'toggleRule': {
        const config = readConfig();
        const ruleId = body.ruleId as string | undefined;
        const enabled = body.enabled as boolean | undefined;
        if (!ruleId || enabled === undefined) return NextResponse.json({ success: false, message: '参数不完整' });

        const rule = config.rules.find(r => r.id === ruleId);
        if (!rule) return NextResponse.json({ success: false, message: '规则不存在' });

        rule.enabled = enabled;
        writeConfig(config);
        nodeMonitorService.restart();
        return NextResponse.json({ success: true });
      }

      case 'toggleGlobal': {
        const config = readConfig();
        const enabled = body.enabled as boolean | undefined;
        if (enabled === undefined) return NextResponse.json({ success: false, message: '参数不完整' });

        config.globalEnabled = enabled;
        writeConfig(config);
        nodeMonitorService.restart();
        return NextResponse.json({ success: true });
      }

      case 'clearLogs': {
        clearLogs();
        return NextResponse.json({ success: true });
      }

      case 'manualCheck': {
        nodeMonitorService.runCheckCycle().catch(err => {
          console.error('[NodeMonitor] 手动触发检查失败:', err);
        });
        return NextResponse.json({ success: true, message: '已触发检查' });
      }

      default:
        return NextResponse.json({ success: false, message: `未知操作: ${action}` });
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : '服务异常';
    return NextResponse.json({ success: false, message });
  }
}
