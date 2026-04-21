const { clipboard, contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('electronAPI', {
  writeClipboardText: async (text) => {
    clipboard.writeText(text)
  },
  openScoreInMuseScore: (payload) => ipcRenderer.invoke('open-score-in-musescore', payload),
  openFileInVSCode: (payload) => ipcRenderer.invoke('open-file-in-vscode', payload),
  runExportCommand: (payload) => ipcRenderer.invoke('run-export-command', payload),
  runMediaGeneration: (payload) => ipcRenderer.invoke('run-media-generation', payload),
  listLocalFiles: (payload) => ipcRenderer.invoke('list-local-files', payload),
  deleteLocalFiles: (payload) => ipcRenderer.invoke('delete-local-files', payload),
  readLocalFile: (payload) => ipcRenderer.invoke('read-local-file', payload),
  onMuseScoreLog: (callback) => {
    const listener = (_event, payload) => callback(payload)
    ipcRenderer.on('musescore-log', listener)

    return () => {
      ipcRenderer.removeListener('musescore-log', listener)
    }
  },
  onExportCommandLog: (callback) => {
    const listener = (_event, payload) => callback(payload)
    ipcRenderer.on('export-command-log', listener)

    return () => {
      ipcRenderer.removeListener('export-command-log', listener)
    }
  },
})
