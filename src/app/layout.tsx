import type { Metadata } from 'next';
import { Inspector } from 'react-dev-inspector';
import './globals.css';

export const metadata: Metadata = {
  title: {
    default: '桔子数据淘宝一键下单',
    template: '%s | 桔子数据',
  },
  description:
    '桔子数据淘宝订单开通系统，连接IDCSmart后台，一键开通云服务器，支持续费、退款、批量管理等操作。',
  keywords: [
    '桔子数据',
    '淘宝下单',
    '云服务器',
    'IDCSmart',
    '一键开通',
    '服务器管理',
  ],
  authors: [{ name: '桔子数据' }],
  generator: '桔子数据',
  // icons: {
  //   icon: '',
  // },
  openGraph: {
    title: '桔子数据淘宝一键下单',
    description:
      '连接IDCSmart后台，一键开通云服务器，支持续费、退款、批量管理等操作。',
    url: 'https://juzi.idc',
    siteName: '桔子数据',
    locale: 'zh_CN',
    type: 'website',
    // images: [
    //   {
    //     url: '',
    //     width: 1200,
    //     height: 630,
    //     alt: '扣子编程 - 你的 AI 工程师',
    //   },
    // ],
  },
  // twitter: {
  //   card: 'summary_large_image',
  //   title: 'Coze Code | Your AI Engineer is Here',
  //   description:
  //     'Build and deploy full-stack applications through AI conversation. No env setup, just flow.',
  //   // images: [''],
  // },
  robots: {
    index: true,
    follow: true,
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const isDev = process.env.COZE_PROJECT_ENV === 'DEV';

  return (
    <html lang="en">
      <body className={`antialiased`}>
        {isDev && <Inspector />}
        {children}
      </body>
    </html>
  );
}
