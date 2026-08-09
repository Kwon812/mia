import { defineConfig } from 'vite';

// 순수 Vite 멀티 엔트리 빌드 (CRXJS 등 확장 전용 플러그인 미사용).
//
// 공유 청크 방지:
// - content.ts 는 import 문이 전혀 없는 classic script 이므로 다른 엔트리와
//   모듈을 공유할 수 없다.
// - sw.ts 가 참조하는 db.ts / config.ts / dexie 는 오직 sw.ts 에서만
//   import 되므로, 두 엔트리 사이에 겹치는 모듈이 존재하지 않는다.
//   즉 Rollup 이 공용 vendor 청크를 만들 대상 자체가 없다.
// - popup.ts 는 snapshot.ts 를 `import type` 으로만 들여온다. 타입은 컴파일 시
//   완전히 사라지므로 popup.js 에도 런타임 의존성이 남지 않는다. 팝업이 필요한
//   데이터는 서비스 워커에 메시지로 물어서 받는다 — 여기에 db.ts 나 session/* 를
//   값으로 import 하는 순간 공유 청크가 생기므로 하지 않는다.
//
// popup.html 은 엔트리가 아니라 public/ 에 있다. public/ 은 vite 가 dist/ 로
// 그대로 복사하므로(manifest.json 과 같은 취급) HTML 엔트리가 만들어내는
// 에셋 해시·청크 분할이 끼어들지 않는다. 그래서 popup.html 은 './popup.js' 를
// 고정 경로로 참조할 수 있다.
// - 그래도 향후 실수로 코드가 공유되는 것을 막기 위해 output.manualChunks 를
//   명시적으로 비활성화하고, 동적 import() 로 인한 분할도 발생하지 않도록
//   inlineDynamicImports 는 사용하지 않는 대신 두 엔트리 모두 정적 import 만
//   사용하도록 강제한다 (동적 import 금지 컨벤션).
export default defineConfig({
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    target: 'esnext',
    modulePreload: false,
    rollupOptions: {
      input: {
        sw: 'src/sw.ts',
        content: 'src/content.ts',
        'connect-content': 'src/connect-content.ts',
        'run-content': 'src/run-content.ts',
        popup: 'src/popup.ts',
      },
      output: {
        entryFileNames: '[name].js',
        format: 'es',
        // 청크 생성 자체를 막아 sw.js / content.js 가 각각 단일 파일로
        // 출력되도록 강제한다 (공유 vendor 청크 방지).
        manualChunks: undefined,
        chunkFileNames: '[name].js',
      },
    },
  },
});
