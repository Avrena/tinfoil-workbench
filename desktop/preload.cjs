'use strict';
const { contextBridge, ipcRenderer } = require('electron');
// Only data crosses the bridge; Electron event objects and ipcRenderer are never exposed.
contextBridge.exposeInMainWorld('tinfoil', Object.freeze({
  onCloseRequested: callback => {
    if (typeof callback !== 'function') throw new TypeError('A callback is required.');
    const listener = (_event, requestId) => { if (typeof requestId === 'string') callback(requestId); };
    ipcRenderer.on('workbench:close-request', listener);
    return () => ipcRenderer.removeListener('workbench:close-request', listener);
  },
  snapshot: async () => unwrap(await ipcRenderer.invoke('workbench:snapshot')),
  command: async command => unwrap(await ipcRenderer.invoke('workbench:command', command)),
  subscribe: callback => {
    if (typeof callback !== 'function') throw new TypeError('A callback is required.');
    const listener = (_event, snapshot) => callback(snapshot);
    ipcRenderer.on('workbench:changed', listener);
    return () => ipcRenderer.removeListener('workbench:changed', listener);
  },
}));
function unwrap(result) {
  if (!result.ok) throw new Error(result.error || 'The operation failed.');
  return result.value;
}
