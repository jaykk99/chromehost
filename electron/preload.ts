import { contextBridge } from "electron";

contextBridge.exposeInMainWorld("vortex", {
  isDesktop: true,
  platform: process.platform,
});
