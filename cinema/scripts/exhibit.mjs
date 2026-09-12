import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import nextEnv from '@next/env';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
// Use the same .env files as `next dev`, including custom local bridge settings.
nextEnv.loadEnvConfig(root, true);
const children = new Set();
const startup = new AbortController();
let stopping = false;

function launch(args, label) {
  if (stopping) return;
  const child = spawn(process.execPath, args, {
    cwd: root, stdio: 'inherit', windowsHide: true,
    // A process group lets POSIX cleanup include Java and Next's workers.
    detached: process.platform !== 'win32',
  });
  children.add(child);
  child.once('error', error => { console.error(`${label}: ${error.message}`); void stop(1); });
  child.once('exit', (code, signal) => {
    children.delete(child);
    if (!stopping) {
      console.error(`${label} exited (${code ?? signal ?? 'unknown'}).`);
      void stop(code ?? 1);
    }
  });
  return child;
}

const exited = child => child.exitCode !== null || child.signalCode !== null;
function waitForExit(child, milliseconds) {
  if (exited(child)) return Promise.resolve(true);
  return new Promise(resolve => {
    const finish = result => { clearTimeout(timer); child.removeListener('exit', onExit); resolve(result); };
    const onExit = () => finish(true);
    const timer = setTimeout(() => finish(false), milliseconds);
    child.once('exit', onExit);
  });
}

function taskkill(pid, force) {
  return new Promise(resolve => {
    const args = ['/pid', String(pid), '/t', ...(force ? ['/f'] : [])];
    // Never enumerate or kill by executable name: this exact child tree is ours.
    const killer = spawn('taskkill', args, { windowsHide: true, stdio: 'ignore' });
    const timer = setTimeout(() => { killer.kill(); resolve(false); }, 3_000);
    const finish = success => { clearTimeout(timer); resolve(success); };
    killer.once('error', () => finish(false));
    killer.once('exit', code => finish(code === 0));
  });
}

async function terminate(child) {
  if (!child.pid || exited(child)) return;
  if (process.platform === 'win32') {
    // Allow normal shutdown first; headless processes may require /f. Await both
    // attempts instead of exiting while an unobserved taskkill is still running.
    await taskkill(child.pid, false);
    if (!await waitForExit(child, 750)) {
      await taskkill(child.pid, true);
      if (!await waitForExit(child, 1_500)) console.error(`Could not stop child process ${child.pid}.`);
    }
  } else {
    try { process.kill(-child.pid, 'SIGTERM'); } catch { return; }
    await waitForExit(child, 750);
    // Descendants may remain in our process group after the parent has exited.
    try { process.kill(-child.pid, 'SIGKILL'); } catch { /* group already closed */ }
  }
}

async function stop(code = 0) {
  if (stopping) return;
  stopping = true;
  startup.abort();
  await Promise.all([...children].map(terminate));
  process.exit(code);
}
process.on('SIGINT', () => { void stop(); });
process.on('SIGTERM', () => { void stop(); });

try {
  const brainUrl = new URL(process.env.BRAIN_URL || `http://127.0.0.1:${process.env.BRAIN_PORT || '8766'}`);
  if (brainUrl.protocol !== 'http:' || !['localhost', '127.0.0.1', '[::1]'].includes(brainUrl.hostname) || brainUrl.username || brainUrl.password) {
    throw new Error('BRAIN_URL must be an HTTP address on localhost.');
  }
  process.env.BRAIN_URL = brainUrl.origin;
  process.env.BRAIN_PORT = brainUrl.port || '80';
  let response;
  try {
    response = await fetch(`${brainUrl.origin}/health`, {
      signal: AbortSignal.any([startup.signal, AbortSignal.timeout(1_200)]),
    });
  } catch { /* An unused port is expected on first launch. */ }
  if (!stopping) {
    if (response) {
      const health = await response.json().catch(() => null);
      if (!response.ok || health?.ok !== true || health?.source !== 'connectome') {
        throw new Error(`The service at ${brainUrl.origin} is not a healthy brain bridge. Check that process or choose another BRAIN_URL.`);
      }
      console.log(`Using the brain already running at ${brainUrl.origin}.`);
    } else launch(['scripts/brain.mjs'], 'Brain bridge');
    launch(['node_modules/next/dist/bin/next', 'dev', '--hostname', '127.0.0.1', '--port', '3000'], 'Cinema');
  }
} catch (error) {
  console.error(error.message);
  await stop(1);
}
