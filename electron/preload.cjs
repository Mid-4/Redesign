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
  gemini: { login: () => ipcRenderer.invoke('gemini:login'), check: () => ipcRenderer.invoke('gemini:check') },
  setEngine: (e) => ipcRenderer.invoke('engine:set', e),
  watch: (on) => ipcRenderer.invoke('chatgpt:watch', on),
  start: (payload) => ipcRenderer.invoke('job:start', payload),
  regen: (id, i, note) => ipcRenderer.invoke('job:regen', id, i, note),
  pick: (id, picks) => ipcRenderer.invoke('job:pick', id, picks),
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
  products: {
    list: () => ipcRenderer.invoke('products:list'), save: (item, oldName) => ipcRenderer.invoke('products:save', item, oldName),
    remove: (name) => ipcRenderer.invoke('products:delete', name),
  },
  setup: {
    status: () => ipcRenderer.invoke('setup:status'),
    check: () => ipcRenderer.invoke('setup:check'),
    installSkill: () => ipcRenderer.invoke('setup:installSkill'),
    showSkillFile: () => ipcRenderer.invoke('setup:showSkillFile'),
    confirmOutDir: (dir) => ipcRenderer.invoke('setup:confirmOutDir', dir),
    getChrome: () => ipcRenderer.invoke('setup:getChrome'),
    claudeCheck: () => ipcRenderer.invoke('setup:claudeCheck'),
    claudeInstall: () => ipcRenderer.invoke('setup:claudeInstall'),
    claudeLogin: () => ipcRenderer.invoke('setup:claudeLogin'),
    claudeCode: (code) => ipcRenderer.invoke('setup:claudeCode', code),
    claudeOpenLogin: () => ipcRenderer.invoke('setup:claudeOpenLogin'),
    claudeCancelLogin: () => ipcRenderer.invoke('setup:claudeCancelLogin'),
  },
  onSetup: on('setup:update'),
  update: { get: () => ipcRenderer.invoke('update:get'), install: () => ipcRenderer.invoke('update:install'), onStatus: on('update:status') },
  version: () => ipcRenderer.invoke('app:version'),
  account: { get: () => ipcRenderer.invoke('account:get'), refresh: () => ipcRenderer.invoke('account:refresh') },
  profile: {
    get: () => ipcRenderer.invoke('profile:get'), setName: (n) => ipcRenderer.invoke('profile:setName', n),
    pickAvatar: () => ipcRenderer.invoke('profile:pickAvatar'), clearAvatar: () => ipcRenderer.invoke('profile:clearAvatar'),
  },
  onJobs: on('jobs:update'),
  onLog: on('log'),
});
