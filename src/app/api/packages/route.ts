import { NextRequest, NextResponse } from 'next/server';
import fs from 'fs';
import path from 'path';

const PACKAGES_FILE = path.join(process.cwd(), 'packages.json');

function readPackages(): PackageConfig[] {
  try {
    if (fs.existsSync(PACKAGES_FILE)) {
      const data = fs.readFileSync(PACKAGES_FILE, 'utf-8');
      return JSON.parse(data);
    }
  } catch {
    // ignore
  }
  return [];
}

function writePackages(packages: PackageConfig[]) {
  fs.writeFileSync(PACKAGES_FILE, JSON.stringify(packages, null, 2), 'utf-8');
}

interface PackageConfig {
  id: string;
  name: string;
  productId: number;
  productName: string;
  billingCycle: string;
  billingCycleName: string;
  configValues: Record<string, string>;
  customFieldValues: Record<string, string>;
  qty: number;
  firstPrice: string;
  renewPrice: string;
  gateway: string;
  useCredit: boolean;
  autoRecharge: boolean;
  createdAt: number;
}

export async function GET() {
  const packages = readPackages();
  return NextResponse.json({ success: true, data: packages });
}

export async function POST(request: NextRequest) {
  const body = await request.json();
  const { action, pkg } = body;

  if (action === 'save') {
    const packages = readPackages();
    const existing = packages.findIndex((p: PackageConfig) => p.id === pkg.id);
    if (existing >= 0) {
      packages[existing] = pkg;
    } else {
      packages.push(pkg);
    }
    writePackages(packages);
    return NextResponse.json({ success: true, data: packages });
  }

  if (action === 'delete') {
    const packages = readPackages();
    const filtered = packages.filter((p: PackageConfig) => p.id !== body.id);
    writePackages(filtered);
    return NextResponse.json({ success: true, data: filtered });
  }

  if (action === 'batchSave') {
    const { packages: newPkgs } = body;
    if (!Array.isArray(newPkgs)) {
      return NextResponse.json({ success: false, message: 'packages must be array' }, { status: 400 });
    }
    const packages = readPackages();
    for (const pkg of newPkgs) {
      const existing = packages.findIndex((p: PackageConfig) => p.id === pkg.id);
      if (existing >= 0) {
        packages[existing] = pkg;
      } else {
        packages.push(pkg);
      }
    }
    writePackages(packages);
    return NextResponse.json({ success: true, data: packages });
  }

  if (action === 'reorder') {
    const { ids } = body;
    const packages = readPackages();
    const reordered = ids
      .map((id: string) => packages.find((p: PackageConfig) => p.id === id))
      .filter(Boolean) as PackageConfig[];
    // Add any packages not in the ids list (shouldn't happen, but safe)
    for (const pkg of packages) {
      if (!reordered.find((p: PackageConfig) => p.id === pkg.id)) {
        reordered.push(pkg);
      }
    }
    writePackages(reordered);
    return NextResponse.json({ success: true, data: reordered });
  }

  return NextResponse.json({ success: false, message: 'Unknown action' }, { status: 400 });
}
