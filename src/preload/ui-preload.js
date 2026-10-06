/**
 * Ponte mínima entre a interface do launcher e o processo principal.
 * A interface não tem acesso ao Node.js; só a estas 4 funções.
 */
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('launcher', {
  loadCfg: () => ipcRenderer.invoke('cfg:load'),
  saveCfg: (d) => ipcRenderer.invoke('cfg:save', d),
  openExternal: (u) => ipcRenderer.invoke('open:external', u),
  metrics: () => ipcRenderer.invoke('metrics:get'),
});
