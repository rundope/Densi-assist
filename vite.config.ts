import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Plugin } from 'vite';
import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

const root = dirname(fileURLToPath(import.meta.url));

// 두 가지 빌드를 한 설정에서 만든다.
//  - 기본 (npm run build): 웹 배포용 dist/. 상대 경로라 홈페이지의 어느 하위 경로에 올려도 동작
//  - standalone (vite build --mode standalone): 더블클릭으로 여는 HTML 파일 하나 (Densi-assist.html)
export default defineConfig(({ mode }) => {
  const standalone = mode === 'standalone';
  return {
    plugins: [react(), ...(standalone ? [singleFileHtml()] : [])],
    // 특정 경로로 고정하려면 BASE_PATH=/경로/ npm run build
    base: process.env.BASE_PATH || './',
    resolve: standalone
      ? {
          // 워커를 별도 파일이 아니라 HTML 안에 내장하는 버전으로 바꿔 끼운다
          alias: [{ find: /^\.\/createWorker$/, replacement: join(root, 'src/engine/createWorker.inline.ts') }],
        }
      : undefined,
    worker: standalone
      ? {
          // 파일(file://)로 연 페이지에서는 모듈 워커가 막히고 일반 워커만 허용되므로 iife로 만든다
          format: 'iife' as const,
          rollupOptions: { output: { codeSplitting: false } },
        }
      : { format: 'es' as const },
    build: standalone
      ? {
          // 중간 결과는 node_modules 안에 두어 프로젝트 폴더를 어지럽히지 않는다
          outDir: 'node_modules/.densi-standalone',
          emptyOutDir: true,
          assetsInlineLimit: 100_000_000,
          cssCodeSplit: false,
          modulePreload: false,
          chunkSizeWarningLimit: 5000,
          rollupOptions: { output: { codeSplitting: false } },
        }
      : undefined,
    test: {
      include: ['tests/**/*.test.ts'],
      environment: 'node',
    },
  };
});

/**
 * 빌드가 끝나 파일이 모두 쓰인 뒤, index.html에 JS·CSS를 넣어 파일 하나(Densi-assist.html)로 만든다.
 * (번들 단계에서 합치면 Vite가 나중에 채우는 코드가 빠지므로 디스크에 쓰인 최종 파일을 쓴다)
 * 결과는 프로젝트 폴더와, 있으면 dist/에도 둔다. 중간 결과 폴더는 지운다.
 */
function singleFileHtml(): Plugin {
  let outDir = '';
  return {
    name: 'densi-single-file-html',
    apply: 'build',
    configResolved(config) {
      outDir = join(config.root, config.build.outDir);
    },
    closeBundle() {
      const indexPath = join(outDir, 'index.html');
      if (!existsSync(indexPath)) return;
      // 파일로 열면 단독 실행판으로 이동시키는 안내는 단독 실행판 안에서는 빼야 한다 (무한 이동 방지)
      let html = readFileSync(indexPath, 'utf8').replace(/<!-- file-guard -->[\s\S]*?<!-- \/file-guard -->\s*/g, '');
      let inlined = 0;
      html = html.replace(/<script type="module"[^>]*\ssrc="\.\/([^"]+)"[^>]*><\/script>/g, (_, file: string) => {
        // HTML 안에 넣은 JS에 "</script"가 있으면 스크립트가 거기서 끝나 버리므로 바꿔 둔다
        const js = readFileSync(join(outDir, file), 'utf8').replace(/<\/script/gi, '<\\/script');
        inlined++;
        return `<script type="module">${js}</script>`;
      });
      html = html.replace(/<link rel="stylesheet"[^>]*\shref="\.\/([^"]+)"[^>]*>/g, (_, file: string) => {
        inlined++;
        return `<style>${readFileSync(join(outDir, file), 'utf8')}</style>`;
      });
      html = html.replace(/<link rel="modulepreload"[^>]*>\s*/g, '');
      if (inlined < 2) throw new Error(`JS/CSS를 HTML에 넣지 못했습니다 (${inlined}개).`);
      const leftover = html.match(/(?:src|href)="\.\/assets\/[^"]+"/g);
      if (leftover) throw new Error(`외부 파일 참조가 남아 있습니다: ${leftover.join(', ')}`);

      const targets = [join(root, 'Densi-assist.html')];
      if (existsSync(join(root, 'dist'))) targets.push(join(root, 'dist', 'Densi-assist.html'));
      for (const t of targets) {
        mkdirSync(dirname(t), { recursive: true });
        writeFileSync(t, html);
      }
      rmSync(outDir, { recursive: true, force: true });
      console.log(`✓ 단독 실행판 ${Math.round(Buffer.byteLength(html) / 1024)} KB → ${targets.map((t) => t.slice(root.length + 1)).join(', ')}`);
    },
  };
}
