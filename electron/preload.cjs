// preload.cjs — cầu nối renderer <-> main (window.api).
const { contextBridge, ipcRenderer } = require('electron');

const on = (ch) => (cb) => {
  const h = (_e, data) => cb(data);
  ipcRenderer.on(ch, h);
  return () => ipcRenderer.removeListener(ch, h);
};

contextBridge.exposeInMainWorld('api', {
  getSettings: () => ipcRenderer.invoke('settings:get'),
  setSettings: (s) => ipcRenderer.invoke('settings:set', s),
  pickDir: () => ipcRenderer.invoke('settings:pickDir'),
  login: () => ipcRenderer.invoke('chatgpt:login'),
  watch: (on) => ipcRenderer.invoke('chatgpt:watch', on),
  start: (payload) => ipcRenderer.invoke('job:start', payload),
  regen: (id, i) => ipcRenderer.invoke('job:regen', id, i),
  remove: (id) => ipcRenderer.invoke('job:remove', id),
  cancel: (id) => ipcRenderer.invoke('job:cancel', id),
  retry: (id) => ipcRenderer.invoke('job:retry', id),
  getJobs: () => ipcRenderer.invoke('jobs:get'),
  openDir: (id) => ipcRenderer.invoke('open:dir', id),
  openFile: (f) => ipcRenderer.invoke('open:file', f),
  openConv: (id) => ipcRenderer.invoke('open:conv', id),
  collect: (id) => ipcRenderer.invoke('job:collect', id),
  colors: () => ipcRenderer.invoke('colors'),
  catalog: () => ipcRenderer.invoke('catalog'),
  setup: {
    status: () => ipcRenderer.invoke('setup:status'),
    check: () => ipcRenderer.invoke('setup:check'),
    installSkill: () => ipcRenderer.invoke('setup:installSkill'),
    showSkillFile: () => ipcRenderer.invoke('setup:showSkillFile'),
    confirmOutDir: (dir) => ipcRenderer.invoke('setup:confirmOutDir', dir),
    getChrome: () => ipcRenderer.invoke('setup:getChrome'),
  },
  onSetup: on('setup:update'),
  update: { get: () => ipcRenderer.invoke('update:get'), install: () => ipcRenderer.invoke('update:install'), onStatus: on('update:status') },
  version: () => ipcRenderer.invoke('app:version'),
  onJobs: on('jobs:update'),
  onLog: on('log'),
});
