import { spawn } from 'node:child_process';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Compile only the engine-independent brain classes with the installed JDK; no Gradle/Minecraft downloads.
const root = fileURLToPath(new URL('../../', import.meta.url));
const output = path.join(root, 'build', 'cinema-bridge');
const source = path.join(root, 'src', 'main', 'java', 'com', 'fruitfly', 'brain');
const executable = (name) => process.env.JAVA_HOME
  ? path.join(process.env.JAVA_HOME, 'bin', `${name}${process.platform === 'win32' ? '.exe' : ''}`)
  : name;
const classes = ['Connectome', 'LifConfig', 'LifNetwork', 'PopulationIndex', 'RetinaGeometry',
  'SensoryFrame', 'SensoryEncoders', 'MotorMap', 'MotorDecoder'];
let child;
let stopping = false;

function run(command, args) {
  return new Promise((resolve, reject) => {
    child = spawn(command, args, { cwd: root, stdio: 'inherit', windowsHide: true });
    child.once('error', (error) => reject(new Error(
      `${command}: ${error.message}. Install a JDK 21 or newer and set JAVA_HOME or add its bin directory to PATH.`)));
    child.once('exit', (code, signal) => code === 0 || stopping || signal === 'SIGINT' || signal === 'SIGTERM'
      ? resolve() : reject(new Error(`${command} exited with ${code ?? signal}`)));
  });
}

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => { stopping = true; child?.kill(signal); });
}

try {
  await mkdir(output, { recursive: true });
  console.log('Compiling the headless connectome bridge (JDK 21+)...');
  await run(executable('javac'), ['--release', '21', '-encoding', 'UTF-8', '-d', output,
    ...classes.map((name) => path.join(source, `${name}.java`)), path.join(source, 'tools', 'CinemaBridge.java')]);
  if (!stopping) await run(executable('java'), ['-Xmx4g', '-cp', output, 'com.fruitfly.brain.tools.CinemaBridge',
    '--flyb', path.join(root, 'src', 'main', 'resources', 'connectome', 'malecns-v1.0.flyb.gz'),
    '--port', process.env.BRAIN_PORT || '8766', ...process.argv.slice(2)]);
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
