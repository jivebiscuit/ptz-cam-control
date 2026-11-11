const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('api', {
  getConfig: () => ipcRenderer.invoke('config:get'),
  startStreams: () => ipcRenderer.invoke('stream:start'),
  streamStatus: () => ipcRenderer.invoke('stream:status'),
  streamErrors: () => ipcRenderer.invoke('stream:errors'),
  setConfig: (c) => ipcRenderer.invoke('config:set', c),
  http: (i, a) => ipcRenderer.invoke('cam:http', i, a),
  visca: (i, a) => ipcRenderer.invoke('cam:visca', i, a),
});
