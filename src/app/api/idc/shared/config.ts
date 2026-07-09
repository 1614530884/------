import { readFileSync } from 'fs';
import { join } from 'path';

const CONFIG_PATH = join(process.cwd(), 'idc-config.json');

let cachedBaseUrl: string | null = null;

export function getBaseUrl(): string {
  if (cachedBaseUrl !== null) return cachedBaseUrl;
  try {
    const config = JSON.parse(readFileSync(CONFIG_PATH, 'utf-8'));
    if (config.baseUrl) {
      const url: string = String(config.baseUrl);
      cachedBaseUrl = url;
      return url;
    }
  } catch { /* 配置文件读取失败，使用默认值 */ }
  return '';
}

export function clearBaseUrlCache(): void {
  cachedBaseUrl = null;
}

export function buildHeaders(baseUrl: string, cookie: string, phpSessId: string): Record<string, string> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'Accept': 'application/json',
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    'Referer': `${baseUrl}/`,
    'Origin': baseUrl,
    'X-Requested-With': 'XMLHttpRequest',
  };

  const cookies: string[] = [];
  if (phpSessId) cookies.push(`PHPSESSID=${phpSessId}`);
  if (cookie) cookies.push(cookie);
  if (cookies.length > 0) {
    headers['Cookie'] = cookies.join('; ');
  }

  return headers;
}
