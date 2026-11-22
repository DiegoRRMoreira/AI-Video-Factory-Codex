import type { NextConfig } from "next";

/**
 * Footage yüklemesi (api/footage) gövdeyi dosyanın kendisi olarak gönderir. Proxy çalışan her isteğin gövdesi Next
 * tarafından kopyalanır ve varsayılan 10 MB'ta sessizce kesilir (16.4.5, `proxyClientMaxBodySize`): büyük video kesik
 * kaydedilirdi. Sınır yükleme sınırının biraz üstünde; asıl sınırı ve 413'ü uç nokta verir.
 */
const footageMb = Number(process.env.YS_FOOTAGE_MAX_MB) || 1024;

const config: NextConfig = {
  // Workspace paketleri derlenmemiş TypeScript kaynağı olarak gelir.
  transpilePackages: ["@ys/core", "@ys/db", "@ys/media-gateway", "@ys/pipeline", "@ys/storage", "@ys/video"],
  serverExternalPackages: ["@aws-sdk/client-s3", "postgres"],
  experimental: { proxyClientMaxBodySize: (footageMb + 1) * 1024 * 1024 },
};

export default config;
