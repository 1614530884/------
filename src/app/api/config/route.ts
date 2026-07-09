import { NextRequest, NextResponse } from 'next/server';
import fs from 'fs';
import path from 'path';
import { encrypt, decrypt, isEncrypted } from '@/lib/crypto';
import { MfyService } from '@/lib/services/mfy-service';
import { clearBaseUrlCache } from '@/app/api/idc/shared/config';

const CONFIG_PATH = path.join(process.cwd(), 'idc-config.json');

// 需要加密的顶层字段
const SENSITIVE_FIELDS = ['mfyPassword'] as const;

// 需要加密的 mfyAccounts 内部字段
const SENSITIVE_ACCOUNT_FIELDS = ['mfyPassword'] as const;

interface MfyAccount {
  loginUser: string;
  mfyUrl: string;
  mfyUsername: string;
  mfyPassword: string;
}

interface Config {
  baseUrl: string;
  financeUrl: string;
  mfyUrl: string;
  mfyUsername: string;
  mfyPassword: string;
  remoteUrl: string;
  productSortOrder: number[];
  hiddenProductIds: number[];
  adminUsernames: string;
  mfyAccounts: MfyAccount[];
}

/**
 * 从文件读取原始配置（密码可能是密文或明文）
 */
function readRawConfig(): Config {
  try {
    const raw = fs.readFileSync(CONFIG_PATH, 'utf-8');
    return JSON.parse(raw);
  } catch {
    return { baseUrl: '', financeUrl: '', mfyUrl: '', mfyUsername: '', mfyPassword: '', remoteUrl: '', productSortOrder: [], hiddenProductIds: [], adminUsernames: '', mfyAccounts: [] };
  }
}

/**
 * 解密配置中的敏感字段，返回明文配置
 */
function decryptConfig(config: Config): Config {
  const result = { ...config };
  // 解密顶层敏感字段
  for (const field of SENSITIVE_FIELDS) {
    if (result[field]) {
      result[field] = decrypt(result[field]);
    }
  }
  // 解密 mfyAccounts 中的敏感字段
  if (Array.isArray(result.mfyAccounts)) {
    result.mfyAccounts = result.mfyAccounts.map(account => {
      const decrypted = { ...account };
      for (const field of SENSITIVE_ACCOUNT_FIELDS) {
        if (decrypted[field]) {
          decrypted[field] = decrypt(decrypted[field]);
        }
      }
      return decrypted;
    });
  }
  return result;
}

/**
 * 加密配置中的敏感字段，返回密文配置（用于写入文件）
 */
function encryptConfig(config: Config): Config {
  const result = { ...config };
  // 加密顶层敏感字段（已经是密文的先解密再重新加密，保证一致性）
  for (const field of SENSITIVE_FIELDS) {
    if (result[field]) {
      const plaintext = isEncrypted(result[field]) ? decrypt(result[field]) : result[field];
      result[field] = encrypt(plaintext);
    }
  }
  // 加密 mfyAccounts 中的敏感字段
  if (Array.isArray(result.mfyAccounts)) {
    result.mfyAccounts = result.mfyAccounts.map(account => {
      const encrypted = { ...account };
      for (const field of SENSITIVE_ACCOUNT_FIELDS) {
        if (encrypted[field]) {
          const plaintext = isEncrypted(encrypted[field]) ? decrypt(encrypted[field]) : encrypted[field];
          encrypted[field] = encrypt(plaintext);
        }
      }
      return encrypted;
    });
  }
  return result;
}

/**
 * 检查配置中是否有明文敏感字段需要迁移
 */
function hasPlaintextSensitive(config: Config): boolean {
  for (const field of SENSITIVE_FIELDS) {
    if (config[field] && !isEncrypted(config[field])) return true;
  }
  if (Array.isArray(config.mfyAccounts)) {
    for (const account of config.mfyAccounts) {
      for (const field of SENSITIVE_ACCOUNT_FIELDS) {
        if (account[field] && !isEncrypted(account[field])) return true;
      }
    }
  }
  return false;
}

function writeConfig(config: Config): void {
  fs.writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2), 'utf-8');
}

// GET: 读取配置（返回明文给前端）
export async function GET() {
  const raw = readRawConfig();
  // 自动迁移：如果文件中有明文密码，加密后写回文件
  if (hasPlaintextSensitive(raw)) {
    const encrypted = encryptConfig(raw);
    writeConfig(encrypted);
  }
  const decrypted = decryptConfig(raw);
  return NextResponse.json(decrypted);
}

// POST: 保存配置（前端传来明文，加密后写入文件）
export async function POST(request: NextRequest) {
  const body = await request.json();
  // 从文件读取当前配置（可能是密文），先解密
  const current = decryptConfig(readRawConfig());

  if (typeof body.financeUrl === 'string') {
    current.financeUrl = body.financeUrl;
  }
  if (typeof body.mfyUrl === 'string') {
    current.mfyUrl = body.mfyUrl;
  }
  if (typeof body.mfyUsername === 'string') {
    current.mfyUsername = body.mfyUsername;
  }
  if (typeof body.mfyPassword === 'string') {
    current.mfyPassword = body.mfyPassword;
  }
  if (typeof body.remoteUrl === 'string') {
    current.remoteUrl = body.remoteUrl;
  }
  if (Array.isArray(body.productSortOrder)) {
    current.productSortOrder = body.productSortOrder.map(Number);
  }
  if (Array.isArray(body.hiddenProductIds)) {
    current.hiddenProductIds = body.hiddenProductIds.map(Number);
  }
  if (typeof body.adminUsernames === 'string') {
    current.adminUsernames = body.adminUsernames;
  }
  if (Array.isArray(body.mfyAccounts)) {
    current.mfyAccounts = body.mfyAccounts.filter(
      (item: unknown) => typeof item === 'object' && item !== null && 'loginUser' in (item as Record<string, unknown>)
    ) as MfyAccount[];
  }

  // 加密敏感字段后写入文件
  const encrypted = encryptConfig(current);
  writeConfig(encrypted);
  MfyService.clearConfigCache();
  clearBaseUrlCache();
  return NextResponse.json({ success: true });
}
