import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  // outputFileTracingRoot: path.resolve(__dirname, '../../'),  // Uncomment and add 'import path from "path"' if needed
  /* config options here */
  allowedDevOrigins: ['*.dev.coze.site'],
  // better-sqlite3 是原生模块必须外置；ws 外置正常。
  // ssh2 外置后 Turbopack 会解析成带哈希的别名并加载失败，故交由 Turbopack 打包。
  serverExternalPackages: ['better-sqlite3', 'ws'],
  images: {
    remotePatterns: [
      {
        protocol: 'https',
        hostname: '*',
        pathname: '/**',
      },
    ],
  },
};

export default nextConfig;
