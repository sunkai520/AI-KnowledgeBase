import { resolve } from 'path'
import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import vue from '@vitejs/plugin-vue'
import fs from 'fs'  // 顶部导入
import path from 'path'
export default defineConfig({
    main: {
        plugins: [
            externalizeDepsPlugin(),
            {
              name: 'copy-workers',
              closeBundle() {
                const srcDir = resolve('src/main/workers')
                const destDir = resolve('out/main/workers')
                if (fs.existsSync(srcDir)) {
                  if (!fs.existsSync(destDir)) {
                    fs.mkdirSync(destDir, { recursive: true })
                  }
                  fs.readdirSync(srcDir).forEach((file: string) => {
                    if (file.endsWith('.js')) {
                      fs.copyFileSync(
                        path.join(srcDir, file),
                        path.join(destDir, file)
                      )
                    }
                  })
                  console.log('Workers copied to:', destDir)
                }
              }
            }
          ],
          build: {
            rollupOptions: {
              // pdfjs-dist 不在 package.json 里（间接依赖），默认会被 externalizeDepsPlugin 漏掉、打包内联，
              // 导致它运行时定位不到同目录下的 pdf.worker.mjs（"Setting up fake worker failed"）。
              // 显式外部化后运行时直接从 node_modules 加载，worker 文件路径才能正确解析。
              // 用正则而不是纯字符串是因为代码里 import 的是子路径（pdfjs-dist/legacy/build/pdf.mjs），
              // Rollup 的字符串 external 只做精确匹配，匹配不到子路径。
              external: ['bull', 'ioredis', 'electron', /^pdfjs-dist/]
            }
          }
    },
    preload: {
        plugins: [externalizeDepsPlugin()],
    },

    renderer: {
        resolve: {
            alias: {
                '@renderer': resolve('src/renderer/src'),
            },
        },
        plugins: [vue()],
        server: {
            port: 5174
        }
    },
   
})
