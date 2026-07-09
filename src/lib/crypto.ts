import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from 'crypto';

const ALGORITHM = 'aes-256-gcm';
const ENC_PREFIX = 'ENC:';
// 密钥派生盐（防止源码直接暴露密钥）
const SECRET = 'idc-config-enc-key-2026-prod';

function deriveKey(): Buffer {
  return scryptSync(SECRET, 'idc-salt-v1', 32);
}

/**
 * 加密明文字符串，返回 ENC:base64(iv:ciphertext:authTag)
 */
export function encrypt(plaintext: string): string {
  const key = deriveKey();
  const iv = randomBytes(12);
  const cipher = createCipheriv(ALGORITHM, key, iv);
  const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const authTag = cipher.getAuthTag();
  // iv(12) + ciphertext + authTag(16)，拼在一起 base64
  const combined = Buffer.concat([iv, encrypted, authTag]);
  return ENC_PREFIX + combined.toString('base64');
}

/**
 * 解密 ENC: 前缀的密文，非前缀的明文原样返回
 */
export function decrypt(ciphertext: string): string {
  if (!ciphertext || !ciphertext.startsWith(ENC_PREFIX)) return ciphertext;
  try {
    const key = deriveKey();
    const combined = Buffer.from(ciphertext.slice(ENC_PREFIX.length), 'base64');
    const iv = combined.subarray(0, 12);
    const authTag = combined.subarray(combined.length - 16);
    const encrypted = combined.subarray(12, combined.length - 16);
    const decipher = createDecipheriv(ALGORITHM, key, iv);
    decipher.setAuthTag(authTag);
    const decrypted = Buffer.concat([decipher.update(encrypted), decipher.final()]);
    return decrypted.toString('utf8');
  } catch {
    return ciphertext; // 解密失败返回原文
  }
}

/**
 * 判断值是否已加密
 */
export function isEncrypted(value: string): boolean {
  return !!value && value.startsWith(ENC_PREFIX);
}
