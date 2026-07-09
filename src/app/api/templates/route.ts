import { NextRequest, NextResponse } from 'next/server';
import fs from 'fs';
import path from 'path';

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
  createdAt: number;
  updatedAt: number;
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
      return JSON.parse(data);
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

export async function GET() {
  const templates = readTemplates();
  return NextResponse.json({ success: true, data: templates });
}

export async function POST(request: NextRequest) {
  const body = await request.json();
  const { action } = body;

  if (action === 'save') {
    const { template } = body;
    const templates = readTemplates();
    const existing = templates.findIndex((t: Template) => t.id === template.id);
    if (existing >= 0) {
      templates[existing] = template;
    } else {
      templates.push(template);
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
      const existing = templates.findIndex((t: Template) => t.id === tpl.id);
      if (existing >= 0) {
        templates[existing] = tpl;
      } else {
        templates.push(tpl);
      }
    }
    writeTemplates(templates);
    return NextResponse.json({ success: true, data: templates });
  }

  return NextResponse.json({ success: false, message: 'Unknown action' }, { status: 400 });
}
