export {}

declare global {
  interface Window {
    electronAPI?: {
      writeClipboardText: (text: string) => Promise<void>
      openScoreInMuseScore: (payload: {
        url: string
        storagePath: string
      }) => Promise<{
        ok: boolean
        command?: string
        filePath?: string
        message?: string
      }>
      openFileInVSCode: (payload: {
        url: string
        storagePath: string
      }) => Promise<{
        ok: boolean
        command?: string
        filePath?: string
        message?: string
      }>
      runExportCommand: (payload: {
        command: string
        runId: string
      }) => Promise<{
        ok: boolean
        code?: number | null
        signal?: string | null
        message?: string
      }>
      runMediaGeneration: (payload: {
        inputScorePath: string
        scoreUrl: string
        storagePath: string
        inputVideoPath: string
        videoUrl: string
        videoStoragePath: string
        nHoles: number
        updateJson: boolean
        updateSvg: boolean
        updateHarmonica: boolean
        updateAccompaniment: boolean
        updateMetronome: boolean
        runId: string
      }) => Promise<{
        ok: boolean
        code?: number | null
        signal?: string | null
        message?: string
      }>
      readLocalFile: (payload: {
        filePath: string
      }) => Promise<{
        ok: boolean
        filePath?: string
        base64?: string
        message?: string
      }>
      onMuseScoreLog: (callback: (payload: {
        storagePath: string
        filePath: string
        stream: 'stdout' | 'stderr'
        message: string
      }) => void) => () => void
      onExportCommandLog: (callback: (payload: {
        runId: string
        stream: 'stdout' | 'stderr'
        message: string
      }) => void) => () => void
    }
  }
}
