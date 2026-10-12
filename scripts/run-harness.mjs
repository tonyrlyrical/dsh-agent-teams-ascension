import { spawn } from 'node:child_process'
import { join } from 'node:path'

const appDir = 'C:\\Users\\Anthony R\\AppData\\Local\\Programs\\DeepSeek Harness'
const appExe = join(appDir, 'DeepSeek Harness.exe')

console.log('Launching DeepSeek Harness as a managed daemon process...')

const child = spawn(appExe, [], {
  cwd: appDir,
  env: {
    ...process.env,
    ELECTRON_ENABLE_LOGGING: '1',
  },
  stdio: 'inherit',
})

child.on('error', (err) => {
  console.error('Failed to start DeepSeek Harness:', err)
})

child.on('exit', (code, signal) => {
  console.log(`DeepSeek Harness exited with code ${code}, signal ${signal}`)
})
