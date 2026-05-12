import { app, BrowserWindow, ipcMain, shell } from 'electron'
import { promises as fs } from 'node:fs'
import path from 'node:path'
import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const appRoot = path.resolve(__dirname, '..')
const isDev = !app.isPackaged
let mainWindow

function sanitizeFileSegment(value) {
  return value.replace(/[^a-z0-9._-]+/gi, '_')
}

async function downloadFileToTemp(url, storagePath) {
  const response = await fetch(url)

  if (!response.ok) {
    throw new Error(`Score download failed with ${response.status}`)
  }

  const fileBuffer = Buffer.from(await response.arrayBuffer())
  const tempDir = path.join(appRoot, 'tmp')
  const baseName = sanitizeFileSegment(path.basename(storagePath || 'score.mscz') || 'score.mscz')
  const timestamp = Date.now()
  const fileName = `${timestamp}-${baseName.endsWith('.mscz') ? baseName : `${baseName}.mscz`}`
  const filePath = path.join(tempDir, fileName)
  const metadataPath = `${filePath}.source.json`

  await fs.mkdir(tempDir, { recursive: true })
  await fs.writeFile(filePath, fileBuffer)
  await fs.writeFile(
    metadataPath,
    JSON.stringify(
      {
        storagePath,
        sourceUrl: url,
        localFile: fileName,
        downloadedAt: new Date(timestamp).toISOString(),
      },
      null,
      2,
    ),
  )

  return filePath
}

async function downloadScoreFile(url, storagePath) {
  return downloadFileToTemp(url, storagePath)
}

async function fileExists(filePath) {
  if (!filePath) {
    return false
  }

  try {
    await fs.access(filePath)
    return true
  } catch {
    return false
  }
}

async function findTempFileByStoragePath(storagePath) {
  if (!storagePath) {
    return ''
  }

  const tempDir = path.join(appRoot, 'tmp')

  try {
    const entries = await fs.readdir(tempDir)
    const metadataFiles = entries
      .filter((entry) => entry.endsWith('.source.json'))
      .map((entry) => path.join(tempDir, entry))
      .sort()
      .reverse()

    for (const metadataPath of metadataFiles) {
      try {
        const metadataRaw = await fs.readFile(metadataPath, 'utf8')
        const metadata = JSON.parse(metadataRaw)

        if (metadata?.storagePath !== storagePath) {
          continue
        }

        const localPath = metadata.localFile
          ? path.join(tempDir, metadata.localFile)
          : metadataPath.replace(/\.source\.json$/, '')

        if (await fileExists(localPath)) {
          return localPath
        }
      } catch {
        // Ignore malformed metadata files and continue scanning.
      }
    }
  } catch {
    return ''
  }

  return ''
}

async function findMuseScoreMacCommands() {
  const appNames = ['MuseScore Studio', 'MuseScore 4', 'MuseScore', 'MuseScore 3']
  const executableNames = ['mscore', 'MuseScore', 'MuseScore Studio', 'MuseScore4', 'musescore']
  const appDirs = [
    '/Applications',
    path.join(app.getPath('home'), 'Applications'),
  ]
  const commands = []

  for (const appDir of appDirs) {
    for (const appName of appNames) {
      const bundlePath = path.join(appDir, `${appName}.app`, 'Contents', 'MacOS')

      for (const executableName of executableNames) {
        const executablePath = path.join(bundlePath, executableName)

        if (await fileExists(executablePath)) {
          commands.push({
            command: executablePath,
            label: executablePath,
          })
        }
      }
    }
  }

  return commands
}

function sendMuseScoreLog(storagePath, filePath, stream, message) {
  if (!message || !mainWindow || mainWindow.isDestroyed()) {
    return
  }

  mainWindow.webContents.send('musescore-log', {
    storagePath,
    filePath,
    stream,
    message,
  })
}

async function launchMuseScoreWithCommand(filePath, storagePath, command) {
  sendMuseScoreLog(storagePath, filePath, 'launcher', `Trying executable: ${command}`)

  await new Promise((resolve, reject) => {
    const child = spawn(command, [filePath], {
      detached: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    })

    const forwardLog = (stream, chunk) => {
      const message = chunk.toString().trim()

      if (!message || !mainWindow || mainWindow.isDestroyed()) {
        return
      }

      sendMuseScoreLog(storagePath, filePath, stream, message)
    }

    child.stdout?.on('data', (chunk) => forwardLog('stdout', chunk))
    child.stderr?.on('data', (chunk) => forwardLog('stderr', chunk))
    child.once('error', reject)
    child.once('spawn', () => {
      child.unref()
      resolve()
    })
  })

  sendMuseScoreLog(storagePath, filePath, 'launcher', `Spawned executable: ${command}`)
  return command
}

async function launchMuseScoreWithMacApp(filePath, storagePath) {
  const appNames = ['MuseScore Studio', 'MuseScore 4', 'MuseScore', 'MuseScore 3']

  for (const appName of appNames) {
    try {
      sendMuseScoreLog(storagePath, filePath, 'launcher', `Trying macOS app: ${appName}`)

      await new Promise((resolve, reject) => {
        let stderr = ''
        const child = spawn('open', ['-a', appName, filePath], {
          stdio: ['ignore', 'ignore', 'pipe'],
        })

        child.stderr?.on('data', (chunk) => {
          stderr += chunk.toString()
        })
        child.once('error', reject)
        child.once('close', (code) => {
          if (code === 0) {
            resolve()
            return
          }

          reject(new Error(stderr.trim() || `Could not open ${appName}.`))
        })
      })

      sendMuseScoreLog(storagePath, filePath, 'launcher', `macOS accepted open request: ${appName}`)
      return `open -a "${appName}"`
    } catch (error) {
      sendMuseScoreLog(
        storagePath,
        filePath,
        'launcher',
        `macOS app failed: ${appName}: ${
          error instanceof Error ? error.message : 'unknown error'
        }`,
      )
      // Try the next likely macOS application name.
    }
  }

  if (process.platform === 'darwin') {
    for (const { command } of await findMuseScoreMacCommands()) {
      try {
        return await launchMuseScoreWithCommand(filePath, storagePath, command)
      } catch {
        // Try the next bundled executable as a fallback.
      }
    }
  }

  throw new Error('MuseScore app not found.')
}

async function launchMuseScore(filePath, storagePath) {
  if (process.platform === 'darwin') {
    if (process.env.MUSESCORE_LAUNCH_MODE === 'mac') {
      return launchMuseScoreWithMacApp(filePath, storagePath)
    }

    for (const { command } of await findMuseScoreMacCommands()) {
      try {
        return await launchMuseScoreWithCommand(filePath, storagePath, command)
      } catch {
        // Try the next bundled executable.
      }
    }

    return launchMuseScoreWithMacApp(filePath, storagePath)
  }

  const commands = ['musescore', 'mscore', 'MuseScore4', 'MuseScore']

  for (const command of commands) {
    try {
      return await launchMuseScoreWithCommand(filePath, storagePath, command)
    } catch (error) {
      if (error?.code === 'ENOENT') {
        continue
      }

      throw error
    }
  }

  throw new Error(
    process.platform === 'darwin'
      ? 'MuseScore app not found. Expected MuseScore Studio, MuseScore 4, MuseScore, or MuseScore 3 in /Applications or ~/Applications.'
      : 'MuseScore command not found. Expected `musescore <file>` to be available.',
  )
}

async function launchVSCode(filePath) {
  const commands = ['code', 'codium']

  for (const command of commands) {
    try {
      await new Promise((resolve, reject) => {
        const child = spawn(command, [filePath], {
          detached: true,
          stdio: 'ignore',
        })

        child.once('error', reject)
        child.once('spawn', () => {
          child.unref()
          resolve()
        })
      })

      return command
    } catch (error) {
      if (error?.code === 'ENOENT') {
        continue
      }

      throw error
    }
  }

  throw new Error('VS Code command not found. Expected `code <file>` to be available.')
}

async function runLocalCommand(command, runId = '') {
  return new Promise((resolve, reject) => {
    const child = spawn('/bin/bash', ['-lc', command], {
      cwd: appRoot,
      stdio: ['ignore', 'pipe', 'pipe'],
    })

    const forwardLog = (stream, chunk) => {
      const text = chunk.toString()
      const lines = text.split(/\r?\n/)

      for (const line of lines) {
        const message = line.trim()

        if (!message || !mainWindow || mainWindow.isDestroyed()) {
          continue
        }

        mainWindow.webContents.send('export-command-log', {
          runId,
          stream,
          message,
        })
      }
    }

    child.stdout?.on('data', (chunk) => forwardLog('stdout', chunk))
    child.stderr?.on('data', (chunk) => forwardLog('stderr', chunk))
    child.once('error', reject)
    child.once('close', (code, signal) => {
      resolve({
        ok: code === 0,
        code: code ?? null,
        signal: signal ?? null,
      })
    })
  })
}

async function runScriptWithArgs(command, args, runId = '') {
  console.log('[run-script]', command, args)
  return new Promise((resolve, reject) => {
    const child = spawn('/bin/bash', [command, ...args], {
      cwd: appRoot,
      stdio: ['ignore', 'pipe', 'pipe'],
    })

    const forwardLog = (stream, chunk) => {
      const text = chunk.toString()
      const lines = text.split(/\r?\n/)

      for (const line of lines) {
        const message = line.trim()

        if (!message || !mainWindow || mainWindow.isDestroyed()) {
          continue
        }

        mainWindow.webContents.send('export-command-log', {
          runId,
          stream,
          message,
        })
      }
    }

    child.stdout?.on('data', (chunk) => forwardLog('stdout', chunk))
    child.stderr?.on('data', (chunk) => forwardLog('stderr', chunk))
    child.once('error', reject)
    child.once('close', (code, signal) => {
      resolve({
        ok: code === 0,
        code: code ?? null,
        signal: signal ?? null,
      })
    })
  })
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: 960,
    minHeight: 680,
    backgroundColor: '#111318',
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  })

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url)
    return { action: 'deny' }
  })

  if (isDev) {
    mainWindow.loadURL('http://127.0.0.1:3001')
    mainWindow.webContents.openDevTools({ mode: 'detach' })
    return
  }

  mainWindow.loadFile(path.join(appRoot, 'dist', 'index.html'))
}

app.whenReady().then(() => {
  ipcMain.handle('open-score-in-musescore', async (_event, payload) => {
    const url = payload?.url
    const storagePath = payload?.storagePath

    if (!url || !storagePath) {
      return {
        ok: false,
        message: 'A score URL and storage path are required.',
      }
    }

    try {
      const filePath = await downloadScoreFile(url, storagePath)
      const command = await launchMuseScore(filePath, storagePath)

      return {
        ok: true,
        command,
        filePath,
      }
    } catch (error) {
      return {
        ok: false,
        message: error instanceof Error ? error.message : 'Failed to open the score in MuseScore.',
      }
    }
  })

  ipcMain.handle('open-file-in-vscode', async (_event, payload) => {
    const url = payload?.url
    const storagePath = payload?.storagePath

    if (!url || !storagePath) {
      return {
        ok: false,
        message: 'A file URL and storage path are required.',
      }
    }

    try {
      const filePath = await downloadFileToTemp(url, storagePath)
      const command = await launchVSCode(filePath)

      return {
        ok: true,
        command,
        filePath,
      }
    } catch (error) {
      return {
        ok: false,
        message: error instanceof Error ? error.message : 'Failed to open the file in VS Code.',
      }
    }
  })

  ipcMain.handle('run-export-command', async (_event, payload) => {
    const command = payload?.command
    const runId = payload?.runId

    if (!command) {
      return {
        ok: false,
        message: 'An export command is required.',
      }
    }

    try {
      return await runLocalCommand(command, runId)
    } catch (error) {
      return {
        ok: false,
        message: error instanceof Error ? error.message : 'Failed to run export command.',
      }
    }
  })

  ipcMain.handle('run-media-generation', async (_event, payload) => {
    console.log('[run-media-generation] payload', payload)
    const inputScorePath = payload?.inputScorePath
    const scoreUrl = payload?.scoreUrl
    const storagePath = payload?.storagePath
    const inputVideoPath = payload?.inputVideoPath
    const videoUrl = payload?.videoUrl
    const videoStoragePath = payload?.videoStoragePath
    const nHoles = payload?.nHoles
    const runId = payload?.runId

    if ((!inputScorePath && !(scoreUrl && storagePath)) || !Number.isFinite(nHoles)) {
      return {
        ok: false,
        message: 'A local score path or downloadable score URL, plus nHoles, is required.',
      }
    }

    const scriptPath = path.join(appRoot, 'mscore_scripts', 'run_new_plugin_batch.sh')

    try {
      const existingTempPath = await findTempFileByStoragePath(storagePath)
      const resolvedInputPath =
        (await fileExists(inputScorePath))
          ? inputScorePath
          : existingTempPath
            ? existingTempPath
            : await downloadScoreFile(scoreUrl, storagePath)
      const existingTempVideoPath = await findTempFileByStoragePath(videoStoragePath)
      const resolvedVideoPath =
        (await fileExists(inputVideoPath))
          ? inputVideoPath
          : existingTempVideoPath
            ? existingTempVideoPath
            : videoUrl && videoStoragePath
              ? await downloadFileToTemp(videoUrl, videoStoragePath)
              : ''
      console.log('[run-media-generation] existingTempPath', existingTempPath)
      console.log('[run-media-generation] resolvedInputPath', resolvedInputPath)
      console.log('[run-media-generation] existingTempVideoPath', existingTempVideoPath)
      console.log('[run-media-generation] resolvedVideoPath', resolvedVideoPath)

      const generationResult = await runScriptWithArgs(
        scriptPath,
        [
          resolvedInputPath,
          resolvedVideoPath,
          String(nHoles),
          String(Boolean(payload?.updateJson)),
          String(Boolean(payload?.updateSvg)),
          String(Boolean(payload?.updateHarmonica)),
          String(Boolean(payload?.updateAccompaniment)),
          String(Boolean(payload?.updateMetronome)),
        ],
        runId,
      )

      const outputDir = path.join(appRoot, 'tmp')

      return {
        ...generationResult,
        outputDir,
        outputPaths: {
          countInAndMetronome: path.join(outputDir, 'countInAndMetronome.mid'),
          events: path.join(outputDir, 'events.json'),
          positions: path.join(outputDir, 'positions.spos'),
          songWithTabs: path.join(outputDir, 'song_with_tabs.mscz'),
          scoreSvg: path.join(outputDir, 'score.svg'),
          video: path.join(outputDir, 'video.mp4'),
        },
      }
    } catch (error) {
      console.error('[run-media-generation] failed', error)
      return {
        ok: false,
        message:
          error instanceof Error ? error.message : 'Failed to run media generation.',
      }
    }
  })

  ipcMain.handle('list-local-files', async (_event, payload) => {
    const directoryPath = payload?.directoryPath
    const prefix = payload?.prefix ?? ''
    const extension = payload?.extension ?? ''

    if (!directoryPath) {
      return {
        ok: false,
        message: 'A local directory path is required.',
      }
    }

    try {
      const entries = await fs.readdir(directoryPath, { withFileTypes: true })
      const files = entries
        .filter((entry) => entry.isFile())
        .map((entry) => entry.name)
        .filter((name) => (!prefix || name.startsWith(prefix)) && (!extension || name.endsWith(extension)))
        .sort((left, right) => left.localeCompare(right, undefined, { numeric: true }))
        .map((name) => ({
          name,
          path: path.join(directoryPath, name),
        }))

      return {
        ok: true,
        directoryPath,
        files,
      }
    } catch (error) {
      return {
        ok: false,
        message: error instanceof Error ? error.message : 'Failed to list local files.',
      }
    }
  })

  ipcMain.handle('delete-local-files', async (_event, payload) => {
    const filePaths = Array.isArray(payload?.filePaths) ? payload.filePaths : []

    if (!filePaths.length) {
      return {
        ok: true,
        deleted: [],
      }
    }

    const deleted = []

    for (const filePath of filePaths) {
      if (!filePath) {
        continue
      }

      try {
        await fs.rm(filePath, { force: true })
        deleted.push(filePath)
      } catch (error) {
        return {
          ok: false,
          message: error instanceof Error ? error.message : 'Failed to delete local files.',
          deleted,
        }
      }
    }

    return {
      ok: true,
      deleted,
    }
  })

  ipcMain.handle('read-local-file', async (_event, payload) => {
    const filePath = payload?.filePath

    if (!filePath) {
      return {
        ok: false,
        message: 'A local file path is required.',
      }
    }

    try {
      const data = await fs.readFile(filePath)
      return {
        ok: true,
        filePath,
        base64: data.toString('base64'),
      }
    } catch (error) {
      return {
        ok: false,
        message: error instanceof Error ? error.message : 'Failed to read local file.',
      }
    }
  })

  createWindow()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow()
    }
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
  }
})
