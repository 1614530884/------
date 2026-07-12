import { NextRequest, NextResponse } from 'next/server';
import fs from 'fs';
import path from 'path';
import { verifySessionToken, SESSION_COOKIE_NAME } from '@/lib/auth-server';
import { logUnauthorizedAccess } from '@/lib/access-log';

const DATA_DIR = path.join(process.cwd(), 'data');
const TEMPLATES_FILE = path.join(DATA_DIR, 'templates.json');

interface Template {
  id: string;
  name: string;
  content: string;
  osFilters: string[];
  productIds: number[];
  isDefault: boolean;
  perServer: boolean;
  scene: 'provision' | 'renew';  // 场景：开通 / 续费
  createdAt: number;
  updatedAt: number;
}

function normalizeTemplate(t: Partial<Template>): Template {
  return {
    id: String(t.id || ''),
    name: String(t.name || ''),
    content: String(t.content || ''),
    osFilters: Array.isArray(t.osFilters) ? t.osFilters : [],
    productIds: Array.isArray(t.productIds) ? t.productIds : [],
    isDefault: !!t.isDefault,
    perServer: !!t.perServer,
    // 向后兼容：旧数据无 scene 字段视为 provision
    scene: t.scene === 'renew' ? 'renew' : 'provision',
    createdAt: Number(t.createdAt) || 0,
    updatedAt: Number(t.updatedAt) || 0,
  };
}

function ensureDataDir() {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }
}

function readTemplates(): Template[] {
  try {
    if (fs.existsSync(TEMPLATES_FILE)) {
      const data = fs.readFileSync(TEMPLATES_FILE, 'utf-8');
      const parsed = JSON.parse(data);
      if (!Array.isArray(parsed)) return [];
      // 规范化：为旧数据补 scene 字段
      return parsed.map((t: Partial<Template>) => normalizeTemplate(t));
    }
  } catch {
    // ignore
  }
  return [];
}

function writeTemplates(templates: Template[]) {
  ensureDataDir();
  fs.writeFileSync(TEMPLATES_FILE, JSON.stringify(templates, null, 2), 'utf-8');
}

export async function GET(request: NextRequest) {
  const sessionCookie = request.cookies.get(SESSION_COOKIE_NAME)?.value;
  if (!verifySessionToken(sessionCookie)) {
    logUnauthorizedAccess(request, 'templates-get');
    return NextResponse.json({ success: false, message: '未授权，请先登录' }, { status: 401 });
  }
  const templates = readTemplates();
  return NextResponse.json({ success: true, data: templates });
}

export async function POST(request: NextRequest) {
  const sessionCookie = request.cookies.get(SESSION_COOKIE_NAME)?.value;
  if (!verifySessionToken(sessionCookie)) {
    logUnauthorizedAccess(request, 'templates-post');
    return NextResponse.json({ success: false, message: '未授权，请先登录' }, { status: 401 });
  }
  const body = await request.json();
  const { action } = body;

  if (action === 'save') {
    const { template } = body;
    const normalized = normalizeTemplate(template);
    const templates = readTemplates();
    const existing = templates.findIndex((t: Template) => t.id === normalized.id);
    if (existing >= 0) {
      templates[existing] = normalized;
    } else {
      templates.push(normalized);
    }
    writeTemplates(templates);
    return NextResponse.json({ success: true, data: templates });
  }

  if (action === 'delete') {
    const templates = readTemplates();
    const filtered = templates.filter((t: Template) => t.id !== body.id);
    writeTemplates(filtered);
    return NextResponse.json({ success: true, data: filtered });
  }

  if (action === 'batchSave') {
    const { templates: newTemplates } = body;
    if (!Array.isArray(newTemplates)) {
      return NextResponse.json({ success: false, message: 'templates must be array' }, { status: 400 });
    }
    const templates = readTemplates();
    for (const tpl of newTemplates) {
      const normalized = normalizeTemplate(tpl);
      const existing = templates.findIndex((t: Template) => t.id === normalized.id);
      if (existing >= 0) {
        templates[existing] = normalized;
      } else {
        templates.push(normalized);
      }
    }
    writeTemplates(templates);
    return NextResponse.json({ success: true, data: templates });
  }

  return NextResponse.json({ success: false, message: 'Unknown action' }, { status: 400 });
}
