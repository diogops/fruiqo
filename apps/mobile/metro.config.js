// Expo detecta o monorepo (workspaces pnpm, node-linker=hoisted) e ajusta watchFolders/nodeModulesPaths.
const { getDefaultConfig } = require('expo/metro-config');

module.exports = getDefaultConfig(__dirname);
