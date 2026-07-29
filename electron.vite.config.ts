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
              external: ['bull', 'ioredis', 'electron']
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
