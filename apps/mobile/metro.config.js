// Expo detecta o monorepo (workspaces pnpm, node-linker=hoisted) e ajusta watchFolders/nodeModulesPaths.
const { getDefaultConfig } = require('expo/metro-config');
const path = require('node:path');

const config = getDefaultConfig(__dirname);

// RF-18: o simulador de share (app/dev, src/dev) não pode existir no bundle de produção.
// Fora da blockList o expo-router nem enxerga a rota; scripts/check-prod-bundle.mjs confere o bundle.
if (process.env.APP_VARIANT === 'production') {
  const SEP = '[\\\\/]'; // aceita separador do Windows e do POSIX
  const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const dirPattern = (dir) =>
    new RegExp('^' + path.join(__dirname, dir).split(path.sep).map(escapeRe).join(SEP) + SEP + '.*');
  const existing = config.resolver.blockList;
  config.resolver.blockList = [
    ...(Array.isArray(existing) ? existing : existing ? [existing] : []),
    dirPattern('app/dev'),
    dirPattern('src/dev'),
  ];
}

module.exports = config;
