import './style.css';
import { Game, type Startup } from './core/Game';
import { detectDeviceProfile, isQualityTier } from './core/DeviceProfile';
import { loadRapier, type Rapier } from './core/Physics';

function showFatal(title: string, detail: string): void {
  document.getElementById('boot')?.remove();
  const box = document.createElement('div');
  box.className = 'fatal';
  const inner = document.createElement('div');
  const h = document.createElement('h1');
  h.textContent = title;
  const p = document.createElement('p');
  p.textContent = detail;
  inner.append(h, p);
  box.appendChild(inner);
  document.body.appendChild(box);
}

async function boot(): Promise<void> {
  const viewport = document.getElementById('viewport');
  const hud = document.getElementById('hud');
  if (!viewport || !hud) throw new Error('Missing #viewport / #hud');

  const profile = detectDeviceProfile();
  const q = new URLSearchParams(location.search).get('quality');
  const forced = isQualityTier(q) ? q : null;
  const params = new URLSearchParams(location.search);
  // Dev shortcuts: ?level=N jumps into a campaign level, ?test into free roam on the test ground, ?drag to the strip.
  const startup: Startup = params.has('test')
    ? { kind: 'free', levelId: null }
    : params.has('drag')
      ? { kind: 'drag' }
      : params.has('level')
        ? { kind: 'campaign', levelId: Number(params.get('level')) || 1 }
        : { kind: 'menu', joinCode: params.get('room')?.toUpperCase().replace(/[^A-Z]/g, '').slice(0, 4) || undefined };
  console.info('[DeviceProfile]', profile);

  if (profile.maxTextureSize === 0) {
    showFatal('无法启动 3D 渲染', '你的浏览器或设备不支持 WebGL。请更新浏览器，或在设置中开启硬件加速后重试。');
    return;
  }

  let rapier: Rapier;
  try {
    rapier = await loadRapier();
  } catch (err) {
    console.error(err);
    showFatal('物理引擎加载失败', '无法加载 WebAssembly 物理模块。请检查网络后刷新页面，或换用最新版 Chrome / Safari / Edge / Firefox。');
    return;
  }

  let game: Game;
  try {
    game = new Game(viewport, hud, profile, forced, rapier, startup);
  } catch (err) {
    console.error(err);
    showFatal('启动失败', '初始化渲染器时出错，请刷新页面重试。');
    return;
  }
  game.start();
  document.getElementById('boot')?.remove();
}

void boot();
