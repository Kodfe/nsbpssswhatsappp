const { existsSync } = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

process.env.PUPPETEER_CACHE_DIR = process.env.PUPPETEER_CACHE_DIR || path.join(__dirname, '.cache', 'puppeteer');

function hasSystemChrome() {
  if (process.env.PUPPETEER_EXECUTABLE_PATH && existsSync(process.env.PUPPETEER_EXECUTABLE_PATH)) return true;
  if (process.env.CHROME_PATH && existsSync(process.env.CHROME_PATH)) return true;

  for (const command of ['chromium', 'chromium-browser', 'google-chrome', 'google-chrome-stable']) {
    const result = spawnSync('which', [command], { encoding: 'utf8' });
    if (result.status === 0 && result.stdout.trim()) return true;
  }

  return false;
}

function hasPuppeteerChrome() {
  try {
    const puppeteer = require('puppeteer');
    const executablePath = puppeteer.executablePath();
    return executablePath && existsSync(executablePath);
  } catch {
    return false;
  }
}

if (hasSystemChrome() || hasPuppeteerChrome()) {
  console.log('Chrome is already available for Puppeteer.');
  process.exit(0);
}

console.log(`Installing Puppeteer Chrome into ${process.env.PUPPETEER_CACHE_DIR}...`);
const installer = process.platform === 'win32' ? 'npx.cmd' : 'npx';
const result = spawnSync(installer, ['puppeteer', 'browsers', 'install', 'chrome', '--path', './.cache/puppeteer'], {
  cwd: __dirname,
  env: process.env,
  stdio: 'inherit',
});

if (result.status !== 0) {
  process.exit(result.status || 1);
}
