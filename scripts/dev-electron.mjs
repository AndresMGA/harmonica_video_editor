import { spawn } from 'node:child_process'
import process from 'node:process'

const children = new Set()
let shuttingDown = false

function spawnProcess(command, args, options = {}) {
  const child = spawn(command, args, {
    stdio: 'inherit',
    shell: false,
    ...options,
  })

  children.add(child)
  child.on('exit', () => {
    children.delete(child)
  })

  return child
}

function shutdown(code = 0) {
  if (shuttingDown) {
    return
  }

  shuttingDown = true

  for (const child of children) {
    if (!child.killed) {
      child.kill('SIGTERM')
    }
  }

  process.exit(code)
}

const viteProcess = spawnProcess('npx', ['vite', '--host', '127.0.0.1', '--port', '3000'])

viteProcess.on('exit', (code) => {
  if (!shuttingDown) {
    shutdown(code ?? 1)
  }
})

function waitForDevServer(attempt = 0) {
  fetch('http://127.0.0.1:3000')
    .then((response) => {
      if (!response.ok) {
        throw new Error(`Unexpected response: ${response.status}`)
      }

      const electronArgs = ['electron', '.']

      if (process.platform === 'linux') {
        electronArgs.push('--no-sandbox')
      }

      const electronProcess = spawnProcess('npx', electronArgs, {
        env: {
          ...process.env,
          ELECTRON_ENABLE_LOGGING: 'true',
        },
      })

      electronProcess.on('exit', (code) => {
        if (!shuttingDown) {
          shutdown(code ?? 0)
        }
      })
    })
    .catch(() => {
      if (attempt > 100) {
        shutdown(1)
        return
      }

      setTimeout(() => waitForDevServer(attempt + 1), 300)
    })
}

waitForDevServer()

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => shutdown(0))
}
