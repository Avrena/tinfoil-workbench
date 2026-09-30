'use strict';
const { contextBridge, ipcRenderer } = require('electron');
// The approval window's only bridge: the request it was opened for, one decision, and its content height. The
// conversation page has none of these, and the main process answers only the window it opened for that request.
contextBridge.exposeInMainWorld('approval', Object.freeze({
  request: () => ipcRenderer.invoke('approval:request'),
  decide: approve => ipcRenderer.send('approval:decide', approve === true),
  fit: height => ipcRenderer.send('approval:fit', Number(height) || 0),
}));
