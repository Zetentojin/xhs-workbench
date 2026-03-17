import type { Metadata } from "next";
import "./globals.css";
import { getServerPublicRuntimeConfig } from "@/lib/supabase/config";

export const metadata: Metadata = {
  title: "XHS 线索工作台",
  description: "小红书创业线索抓取与筛选控制台",
};

export const dynamic = "force-dynamic";

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const runtimeConfig = getServerPublicRuntimeConfig();
  const runtimeConfigScript = `window.__XHS_RUNTIME_CONFIG__ = ${JSON.stringify(runtimeConfig).replace(/</g, "\\u003c")};`;

  return (
    <html lang="zh-CN">
      <body>
        <script
          dangerouslySetInnerHTML={{
            __html: runtimeConfigScript,
          }}
        />
        {children}
      </body>
    </html>
  );
}
