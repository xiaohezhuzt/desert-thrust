import * as THREE from 'three';
import { AIDriver } from '../ai/AIDriver';
import { RacingLine } from '../ai/RacingLine';
import { CARS } from '../config/cars';
import { LEVELS, UPCOMING_LEVELS } from '../config/levels';
import { AUTO_DOWNGRADE, QUALITY, type QualityTier } from '../config/quality';
import { MS_TO_KMH, MS_TO_MPH, STUNT_TUNING } from '../config/tuning';
import { GamepadInput } from '../input/GamepadInput';
import { createEmptyActions, InputManager, type InputDevice } from '../input/InputManager';
import { KeyboardInput } from '../input/KeyboardInput';
import { TiltInput } from '../input/TiltInput';
import { TouchInput } from '../input/TouchInput';
import { GroundFX } from '../fx/GroundFX';
import { Audio } from './Audio';
import { Campaign, insideBox, type RunResult } from '../modes/Campaign';
import { DragRun, SIXTY_MPH } from '../modes/DragRun';
import { FreeRoam } from '../modes/FreeRoam';
import { OnlineRace } from '../modes/OnlineRace';
import { NetClient } from '../net/NetClient';
import { PLAYER_COLORS } from '../net/protocol';
import { lobbyScreen, onlineHome, onlineResults } from '../ui/Lobby';
import { rateRun, recordRun } from '../modes/Scoring';
import { button, formatTime } from '../ui/dom';
import { HUD } from '../ui/HUD';
import { levelSelect } from '../ui/LevelSelect';
import { loadingScreen, mainMenu, pauseMenu } from '../ui/Menu';
import { Showroom } from '../menu/Showroom';
import { Minimap } from '../ui/Minimap';
import { Overlay } from '../ui/Overlay';
import { isStandalone, RotateHint, toggleFullscreen } from '../ui/RotateHint';
import { resultScreen } from '../ui/ResultScreen';
import { settingsScreen } from '../ui/Settings';
import { TouchControls } from '../ui/TouchControls';
import { CarController } from '../vehicle/CarController';
import { createVoltR, setCarInterior, setCarPaint } from '../vehicle/CarModelFactory';
import { LandingJudge } from '../vehicle/LandingJudge';
import { createOpponentCar, opponentGeometry } from '../vehicle/OpponentModel';
import { Thrusters } from '../vehicle/Thrusters';
import { Level } from '../world/Level';
import { createSkyEnvironmentScene, createTestGround, type TestGround } from '../world/TestGround';
import { ChaseCamera } from './ChaseCamera';
import { lowerTier, type DeviceProfile } from './DeviceProfile';
import { disposeObject } from './dispose';
import { GameLoop } from './GameLoop';
import { PerfMonitor } from './PerfMonitor';
import { GROUP_AI, Physics, type Rapier } from './Physics';
import { createRng } from './Random';
import { Renderer } from './Renderer';
import { SaveSystem, type Progress, type Settings } from './SaveSystem';

interface Opponent {
  readonly driver: AIDriver;
  readonly car: CarController;
  readonly thrusters: Thrusters | null;
  readonly root: THREE.Object3D;
}

/** What to load: the title screen, a campaign level, free roam (null = test ground) or the drag strip. */
export type Startup =
  | { readonly kind: 'menu'; readonly joinCode?: string }
  | { readonly kind: 'online'; readonly levelId: number; readonly raceId: number; readonly startAt: number }
  | { readonly kind: 'campaign'; readonly levelId: number }
  | { readonly kind: 'free'; readonly levelId: number | null }
  | { readonly kind: 'drag' };

type SessionKind = Startup['kind'];

/** Everything that belongs to one loaded scene; torn down as a unit. */
interface Session {
  readonly kind: SessionKind;
  readonly levelId: number | null;
  readonly level: Level | null;
  readonly test: TestGround | null;
  readonly campaign: Campaign | null;
  readonly drag: DragRun | null;
  readonly free: FreeRoam | null;
  readonly online: OnlineRace | null;
  readonly opponents: Opponent[];
  readonly minimap: Minimap | null;
  /** title screen: the robot and the parked car */
  readonly showroom: Showroom | null;
  elapsed: number;
}

/** Beyond this distance from the player, low-tier devices update AI forces at half rate. */
const AI_FAR_DISTANCE = 150;
/** Input used while controls are locked (countdown, menus, results). */
const NEUTRAL = createEmptyActions();
const MENU_LEVEL = LEVELS[0]!.id;

export class Game {
  private readonly renderer: Renderer;
  private readonly physics: Physics;
  private readonly input: InputManager;
  private readonly touchControls: TouchControls;
  private readonly touchInput: TouchInput;
  private readonly hud: HUD;
  private readonly overlay: Overlay;
  private readonly car: CarController;
  private readonly carRoot: THREE.Object3D;
  private readonly carBody: THREE.Object3D;
  private readonly headlight: THREE.SpotLight;
  private readonly chase: ChaseCamera;
  private readonly thrusters: Thrusters | null;
  private readonly landing = new LandingJudge();
  private readonly audio = new Audio();
  private readonly tilt: TiltInput;
  private readonly groundFx: GroundFX;
  private slowMoTimer = 0;
  private readonly camFwd = new THREE.Vector3();
  private readonly carRight = new THREE.Vector3();
  private readonly loop: GameLoop;
  private readonly perf: PerfMonitor;
  private readonly settings: Settings;
  private progress: Progress;
  private tier: QualityTier;

  private session: Session | null = null;
  private userPaused = false;
  private loading = false;
  private hidden = false;
  private portrait = false;
  private stepCount = 0;
  private blur = 0;
  private menuAngle = 0;
  /** The boarding shot is on screen (switch to the chase camera when it ends). */
  private robotCam = false;
  /** Campaign phase last frame (to spot a fresh countdown after a full restart). */
  private lastPhase: string | null = null;
  private interiorShown = true;
  /** Dev-only orbit override for inspecting models: [yaw, pitch, distance]. */
  private debugOrbit: [number, number, number] | null = null;
  /** Online play (created on first use). */
  private net: NetClient | null = null;
  /** Which online screen is showing, so room updates can refresh it. */
  private onlineView: 'none' | 'home' | 'lobby' | 'results' = 'none';

  constructor(
    viewport: HTMLElement,
    private readonly hudRoot: HTMLElement,
    private readonly profile: DeviceProfile,
    forcedTier: QualityTier | null,
    rapier: Rapier,
    startup: Startup,
  ) {
    this.settings = SaveSystem.loadSettings();
    this.progress = SaveSystem.loadProgress();
    // Older saves (or newly added levels): anything after a passed level is unlocked.
    const lastId = LEVELS[LEVELS.length - 1]!.id;
    for (const [id, rec] of Object.entries(this.progress.levels)) {
      if (rec.stars > 0) this.progress.unlocked = Math.max(this.progress.unlocked, Math.min(Number(id) + 1, lastId));
    }
    // Always the best picture: no quality menu, no automatic downgrade (`?tier=` still forces one for testing).
    this.tier = forcedTier ?? 'high';

    this.renderer = new Renderer(viewport, QUALITY[this.tier]);
    this.renderer.setFog(0xe7a46a);
    this.physics = new Physics(rapier);

    const envScene = createSkyEnvironmentScene();
    this.renderer.setEnvironment(envScene);
    disposeObject(envScene);

    const rig = createVoltR({ paintColor: 0xf4f4f1, physicalPaint: QUALITY[this.tier].physicalPaint });
    this.renderer.scene.add(rig.root);
    this.carRoot = rig.root;
    this.carBody = rig.body;
    // Headlight beams for night levels.
    this.headlight = new THREE.SpotLight(0xf4f8ff, 90, 90, 0.48, 0.55, 1.4);
    this.headlight.position.set(0, 0.7, -2.1);
    this.headlight.target.position.set(0, 0, -22);
    this.headlight.visible = false;
    rig.root.add(this.headlight, this.headlight.target);
    this.car = new CarController(this.physics, rig);
    this.car.airAssist = this.settings.airAssist ?? profile.isTouch;
    this.thrusters = rig.nozzles
      ? new Thrusters(this.renderer.scene, rig.root, rig.nozzles, QUALITY[this.tier].maxParticles)
      : null;
    this.chase = new ChaseCamera(this.renderer.camera);
    this.car.onReset = () => {
      this.landing.reset();
      this.thrusters?.resetTrail();
      this.chase.snap();
    };

    this.hud = new HUD(hudRoot);
    this.hud.onAutoThrottleClick = () => this.applySettings({ ...this.settings, autoThrottle: !this.touchInput.autoThrottle });
    this.hud.onPause = () => this.setPaused(true);
    this.hud.onCamera = () => this.toggleCamera();

    this.touchControls = new TouchControls(hudRoot);
    // Auto-throttle is a phone convenience; on tablets you hold the throttle yourself.
    this.touchInput = new TouchInput(this.touchControls, this.settings.autoThrottle ?? profile.isPhone);
    this.input = new InputManager(profile.isTouch ? 'touch' : 'keyboard');
    this.input.add(new KeyboardInput());
    this.input.add(new GamepadInput());
    this.input.add(this.touchInput);
    this.tilt = new TiltInput(this.touchControls);
    this.input.add(this.tilt);
    this.groundFx = new GroundFX(this.renderer.scene, QUALITY[this.tier].maxParticles, this.tier);
    this.input.onDeviceChange = (d) => this.applyDevice(d);
    this.applyDevice(this.input.activeDevice);
    this.hud.setAutoThrottle(this.touchInput.autoThrottle);

    // Menus sit above the HUD.
    this.overlay = new Overlay(hudRoot.parentElement ?? hudRoot);
    new RotateHint(document.body, (portrait) => {
      this.portrait = portrait;
      if (this.loop) this.syncPause();
    });

    this.applyControlSettings();
    this.audio.setVolumes(this.settings.sfxVolume, this.settings.musicVolume);

    this.perf = new PerfMonitor(() => this.degrade());
    this.perf.enabled = false;

    this.loop = new GameLoop(
      1 / QUALITY[this.tier].physicsHz,
      (dt) => this.step(dt),
      (alpha, frameDt, realDt) => this.frame(alpha, frameDt, realDt),
    );
    document.addEventListener('visibilitychange', this.onVisibility);
    this.installDebug();
    this.load(startup);
  }

  start(): void {
    this.loop.start();
  }

  // ---------------------------------------------------------------------------
  // Sessions
  // ---------------------------------------------------------------------------

  /** Show a loading screen, then tear down the current scene and build the next one. */
  private load(startup: Startup): void {
    this.loading = true;
    this.userPaused = false;
    this.syncPause();
    this.overlay.show(loadingScreen(startup.kind === 'menu' ? '准备发布会场…' : '加载关卡…'));
    // Two frames so the loading screen actually paints before the heavy build.
    requestAnimationFrame(() =>
      requestAnimationFrame(() => {
        this.unload();
        this.session = this.build(startup);
        this.loading = false;
        this.syncPause();
        this.hudRoot.dataset.mode = startup.kind === 'online' ? 'campaign' : startup.kind;
        if (startup.kind === 'menu') {
          if (startup.joinCode) this.showOnlineHome(startup.joinCode);
          else if (this.net?.room) this.showLobby();
          else this.showMainMenu();
        } else {
          this.onlineView = 'none';
          this.overlay.hide();
        }
      }),
    );
  }

  private build(startup: Startup): Session {
    const kind = startup.kind;
    const levelId = kind === 'menu' ? MENU_LEVEL : kind === 'drag' ? null : startup.levelId;
    // Online races paint your car in your lobby colour; everything else uses the classic white.
    const myColor = kind === 'online' ? this.net?.room?.players.find((p) => p.id === this.net?.id)?.color : undefined;
    setCarPaint(this.carRoot, PLAYER_COLORS[myColor ?? 0] ?? 0xf4f4f1);
    const def = levelId === null ? undefined : (LEVELS.find((l) => l.id === levelId) ?? LEVELS[0]!);
    let level: Level | null = null;
    let test: TestGround | null = null;
    let spawn: THREE.Vector3;
    let heading: number;
    if (def) {
      level = new Level(def, this.physics, this.renderer);
      this.renderer.scene.add(level.group);
      spawn = level.spawn;
      heading = level.spawnHeading;
    } else {
      this.renderer.setFog(0xe7a46a);
      test = createTestGround(this.renderer.maxAnisotropy, this.physics);
      this.renderer.scene.add(test.group);
      spawn = test.spawn;
      heading = test.spawnHeading;
    }
    this.car.setSpawn(spawn, heading);
    this.headlight.visible = def?.timeOfDay === 'night';
    this.car.isSafeSpot = level ? (p) => level!.hazardAt(p) === null : null;
    this.landing.reset();

    const opponents: Opponent[] = [];
    let campaign: Campaign | null = null;
    let minimap: Minimap | null = null;
    if (kind === 'campaign' && level) {
      const line = new RacingLine(level.line, level.def);
      opponents.push(...this.spawnOpponents(level, line));
      campaign = new Campaign(
        level.def,
        line,
        this.car,
        this.physics.obstacles,
        {
          banner: (t, sub, tone, sec) => this.banner(t, sub, tone, sec),
          finished: (r) => this.onRunFinished(r),
        },
        opponents.map((o) => o.driver),
      );
      if (QUALITY[this.tier].minimap) minimap = new Minimap(this.hudRoot, line.points);
      campaign.restart();
    }

    let online: OnlineRace | null = null;
    if (kind === 'online' && level && this.net?.room) {
      const line = new RacingLine(level.line, level.def);
      campaign = new Campaign(level.def, line, this.car, this.physics.obstacles, {
        banner: (t, sub, tone, sec) => this.banner(t, sub, tone, sec),
        finished: (r) => this.onRunFinished(r),
      });
      online = new OnlineRace(
        this.net,
        this.physics,
        this.renderer.scene,
        QUALITY[this.tier],
        campaign,
        this.car,
        startup.raceId,
        startup.startAt,
        this.net.room,
      );
      online.onResults = () => {
        if (this.onlineView === 'results') this.showOnlineResults();
      };
      if (QUALITY[this.tier].minimap) minimap = new Minimap(this.hudRoot, line.points);
    }

    let drag: DragRun | null = null;
    if (kind === 'drag') {
      drag = new DragRun(this.car, spawn, heading, {
        banner: (t, sub, tone, sec) => this.banner(t, sub, tone, sec),
        done: (t) => this.onDragFinished(t),
      });
      drag.restart();
    }
    this.chase.snap();
    this.groundFx.clearMarks();
    this.audio.setMusic(kind === 'menu' ? 'menu' : (def?.biome ?? 'desert'));
    this.audio.setOpponentCount(opponents.length);
    return {
      kind,
      levelId,
      level,
      test,
      campaign,
      drag,
      free: kind === 'free' ? new FreeRoam() : null,
      online,
      opponents,
      minimap,
      showroom:
        kind === 'menu' || kind === 'campaign' ? new Showroom(this.carRoot, this.carBody, this.paintMaterial(), kind === 'menu' ? 'menu' : 'race') : null,
      elapsed: 0,
    };
  }

  /** Release the current scene: colliders, GPU resources, opponents (iOS memory is tight). */
  private unload(): void {
    const s = this.session;
    if (!s) return;
    for (const o of s.opponents) {
      o.thrusters?.dispose();
      o.car.dispose();
      disposeObject(o.root);
    }
    s.minimap?.dispose();
    s.showroom?.dispose();
    s.online?.dispose();
    s.level?.dispose();
    s.test?.dispose();
    this.session = null;
    // Biomes animate lighting; restore neutral values for the next scene.
    this.renderer.sun.intensity = 2.6;
    this.renderer.hemi.intensity = 0.45;
    this.renderer.scene.environmentIntensity = 0.8;
  }

  /** Draw `aiCount` different cars at random with random paint from their palettes. */
  private spawnOpponents(level: Level, line: RacingLine): Opponent[] {
    const def = level.def;
    const rng = createRng((Date.now() & 0xffff) + def.id);
    const pool = [...CARS];
    for (let i = pool.length - 1; i > 0; i--) {
      const j = Math.floor(rng() * (i + 1));
      [pool[i], pool[j]] = [pool[j]!, pool[i]!];
    }
    const q = QUALITY[this.tier];
    const out: Opponent[] = [];
    for (let k = 0; k < def.aiCount; k++) {
      const carDef = pool[k % pool.length]!;
      const color = carDef.palette[Math.floor(rng() * carDef.palette.length)]!;
      const rig = createOpponentCar(carDef, color, q.physicalPaint, q.tier === 'low' ? 45 : 90);
      this.renderer.scene.add(rig.root);
      const car = new CarController(this.physics, rig, carDef.perf, opponentGeometry(carDef.shape));
      car.ignoreTraffic(GROUP_AI);
      const driver = new AIDriver(car, line, carDef, def.aiSkill, def.aiRubberBand, rng);
      const thrusters = rig.nozzles
        ? new Thrusters(this.renderer.scene, rig.root, rig.nozzles, Math.floor(q.maxParticles * 0.12))
        : null;
      car.onReset = () => thrusters?.resetTrail();
      car.isSafeSpot = (p) => level.hazardAt(p) === null;
      out.push({ driver, car, thrusters, root: rig.root });
    }
    return out;
  }

  // ---------------------------------------------------------------------------
  // Menus
  // ---------------------------------------------------------------------------

  /** HUD banner plus a matching sound cue. */
  private banner(text: string, sub: string, tone: 'info' | 'good' | 'bad', seconds: number): void {
    this.hud.banner(text, sub, tone, seconds);
    if (text === 'GO!') this.audio.cue('go');
    else if (/^\d$/.test(text)) this.audio.cue('count');
    else if (tone === 'good') this.audio.cue('pass');
    else if (tone === 'bad') this.audio.cue('fail');
  }

  /** Touch scheme (stick / tilt) and tilt tuning from settings. */
  private applyControlSettings(): void {
    const tilt = this.settings.controlScheme === 'tilt';
    this.tilt.enabled = tilt;
    this.tilt.sensitivity = this.settings.tiltSensitivity;
    this.tilt.deadzone = this.settings.tiltDeadzone;
    this.touchControls.setStickVisible(!tilt);
  }

  // ---------------------------------------------------------------------------
  // Online
  // ---------------------------------------------------------------------------

  /** Create the network client once and route its messages to the screens. */
  private ensureNet(): NetClient {
    if (this.net) return this.net;
    const net = new NetClient();
    net.on('room', () => {
      if (this.onlineView === 'lobby' || this.onlineView === 'home') this.showLobby();
    });
    net.on('start', (m) => {
      this.onlineView = 'none';
      this.load({ kind: 'online', levelId: m.level, raceId: m.raceId, startAt: m.startAt });
    });
    net.on('error', (m) => {
      if (this.onlineView === 'home' || this.onlineView === 'lobby') this.showOnlineHome(null, m.message);
      else this.hud.banner('联机错误', m.message, 'bad', 2.5);
    });
    net.onDisconnect = () => {
      this.hud.banner('与服务器断开', '请检查网络后重新加入房间', 'bad', 3);
      if (this.session?.kind === 'online') this.load({ kind: 'menu' });
      else if (this.onlineView !== 'none') this.showOnlineHome(null, '与服务器断开，请重新加入。');
    };
    this.net = net;
    return net;
  }

  private rememberName(name: string): void {
    if (name !== this.settings.playerName) {
      this.settings.playerName = name;
      SaveSystem.saveSettings(this.settings);
    }
  }

  private showOnlineHome(joinCode: string | null, error?: string): void {
    this.onlineView = 'home';
    const go = async (fn: (net: NetClient) => void, name: string): Promise<void> => {
      this.rememberName(name);
      const net = this.ensureNet();
      try {
        this.overlay.show(loadingScreen('正在连接服务器…'), true);
        await net.connect();
        fn(net);
      } catch {
        this.showOnlineHome(
          joinCode,
          '连不上联机服务器。请用 npm run serve 启动的地址打开游戏（同一 Wi-Fi 下用电脑的局域网 IP）。',
        );
      }
    };
    this.overlay.show(
      onlineHome(
        this.settings.playerName,
        joinCode,
        {
          create: (name) => void go((net) => net.send({ type: 'create', name, level: 1 }), name),
          join: (name, code) => void go((net) => net.send({ type: 'join', name, code }), name),
          back: () => {
            this.onlineView = 'none';
            history.replaceState(null, '', location.pathname);
            this.showMainMenu();
          },
        },
        error,
      ),
      true,
    );
  }

  private showLobby(): void {
    const net = this.net;
    if (!net?.room) return;
    this.onlineView = 'lobby';
    this.overlay.show(
      lobbyScreen(net.room, net.id, net.inviteLink(net.room.code), LEVELS, {
        start: () => net.send({ type: 'start' }),
        setLevel: (level) => net.send({ type: 'setLevel', level }),
        setColor: (color) => net.send({ type: 'setColor', color }),
        leave: () => {
          net.send({ type: 'leave' });
          net.close();
          this.onlineView = 'none';
          history.replaceState(null, '', location.pathname);
          this.showMainMenu();
        },
      }),
      true,
    );
  }

  private showOnlineResults(): void {
    const online = this.session?.online;
    if (!online) return;
    this.onlineView = 'results';
    this.overlay.show(onlineResults(online.results(), online.allDone, { lobby: () => this.quitToMenu() }), true);
  }

  /** Leave the current race; online players go back to their room. */
  private quitToMenu(): void {
    if (this.session?.online && this.net) {
      if (!this.session.campaign || this.session.campaign.phase !== 'finished') this.net.send({ type: 'backToLobby' });
      this.onlineView = 'lobby';
    }
    this.load({ kind: 'menu' });
  }

  private paintMaterial(): THREE.Material {
    let paint: THREE.Material | null = null;
    this.carRoot.traverse((o) => {
      const m = (o as Partial<THREE.Mesh>).material;
      for (const x of Array.isArray(m) ? m : m ? [m] : []) if (x.name === 'paint') paint = x;
    });
    return paint ?? new THREE.MeshStandardMaterial({ color: 0xf4f4f1 });
  }

  private totalStars(): number {
    return Object.values(this.progress.levels).reduce((s, r) => s + r.stars, 0);
  }

  private showMainMenu(): void {
    this.overlay.show(
      mainMenu(
        {
          campaign: () => this.showLevelSelect('campaign'),
          freeRoam: () => this.showLevelSelect('free'),
          dragRun: () => this.load({ kind: 'drag' }),
          online: () => this.showOnlineHome(null),
          settings: () => this.showSettings(() => this.showMainMenu()),
          fullscreen: document.fullscreenEnabled ? () => void toggleFullscreen() : null,
          hint:
            this.profile.isIOS && !isStandalone()
              ? 'iPhone / iPad：点 Safari 的「分享」→「添加到主屏幕」，从主屏幕打开即可全屏游玩。'
              : null,
        },
        this.totalStars(),
        LEVELS.length * 3,
      ),
      false,
    );
  }

  private showLevelSelect(mode: 'campaign' | 'free'): void {
    const screen = levelSelect(
      LEVELS,
      mode === 'campaign' ? UPCOMING_LEVELS : [],
      this.progress,
      mode,
      (id) => this.load(mode === 'campaign' ? { kind: 'campaign', levelId: id } : { kind: 'free', levelId: id }),
      () => this.showMainMenu(),
    );
    if (mode === 'free') {
      const extra = screen.querySelector('.level-grid');
      if (extra) {
        const b = button('试车场（平地 · 跳台 · 减速带）', () => this.load({ kind: 'free', levelId: null }), 'secondary');
        b.classList.add('level-card');
        extra.appendChild(b);
      }
    }
    this.overlay.show(screen, true);
  }

  private showSettings(back: () => void): void {
    const render = (): void =>
      this.overlay.show(
        settingsScreen(
          this.settings,
          { autoThrottle: this.touchInput.autoThrottle, airAssist: this.car.airAssist },
          {
            change: (next) => {
              this.applySettings(next);
              render();
            },
            calibrateTilt: () => this.tilt.calibrate(),
            resetProgress: () => {
              this.progress = SaveSystem.resetProgress();
              render();
            },
            back,
          },
        ),
        true,
      );
    render();
  }

  private showPause(): void {
    const s = this.session;
    this.overlay.show(
      pauseMenu(
        {
          resume: () => this.setPaused(false),
          restart: () => {
            this.setPaused(false);
            this.restartSession();
          },
          settings: () => this.showSettings(() => this.showPause()),
          quit: () => this.quitToMenu(),
        },
        !!((s?.campaign && !s.online) || s?.drag || (s?.free && s.level)),
      ),
      true,
    );
  }

  private toggleCamera(): void {
    const s = this.session;
    if (!s || s.kind === 'menu' || this.loading || this.userPaused) return;
    this.chase.toggleMode();
    this.hud.setCameraMode(this.chase.mode);
  }

  private setPaused(paused: boolean): void {
    const s = this.session;
    if (!s || s.kind === 'menu' || this.loading) return;
    this.userPaused = paused;
    this.syncPause();
    if (paused) this.showPause();
    else this.overlay.hide();
  }

  private syncPause(): void {
    // Pause freezes your own game, online too (the race clock there keeps to the server, so it's fair).
    this.loop.setPaused(this.userPaused || this.loading || this.hidden || this.portrait);
    this.touchControls.setVisible(!this.userPaused && !this.loading && this.input.activeDevice === 'touch');
  }

  private restartSession(): void {
    const s = this.session;
    this.overlay.hide();
    s?.campaign?.restart();
    s?.drag?.restart();
    if (s?.free && s.level) {
      // Back to the start line with the clock reset.
      this.car.respawn(s.level.spawn, s.level.spawnHeading);
      s.elapsed = 0;
    }
  }

  private onRunFinished(r: RunResult): void {
    const s = this.session;
    const def = s?.level?.def;
    if (!s || !def) return;
    if (s.online) {
      s.online.reportFinish(r.time, r.grades.every((g) => g !== null));
      this.showOnlineResults();
      return;
    }
    const rating = rateRun(def, r);
    const lastId = LEVELS[LEVELS.length - 1]!.id;
    const outcome = recordRun(this.progress, def, r, rating.stars, lastId);
    SaveSystem.saveProgress(this.progress);
    const best = this.progress.levels[String(def.id)]?.bestTime ?? null;
    const next = LEVELS.find((l) => l.id === def.id + 1);
    const canNext = r.passed && next && next.id <= this.progress.unlocked;

    const gradeRows = r.gateNames.map(
      (n, i): [string, string, string] => [n, r.grades[i] ?? '—', `g-${(r.grades[i] ?? 'none').toLowerCase()}`],
    );
    this.overlay.show(
      resultScreen({
        title: r.passed ? '过关！' : '未达成',
        passed: r.passed,
        stars: rating.stars,
        headline: formatTime(r.time),
        subline: `名次 ${r.place}/${r.racers}（需要 ≤ ${r.requiredPlace}）${outcome.newBestTime ? ' · 新纪录！' : ''}`,
        rows: [
          ...gradeRows,
          ['重试次数', String(r.retriesUsed)],
          ['最佳用时', formatTime(best)],
          ...(outcome.unlockedNext && next ? [['已解锁', `第 ${next.id} 关 ${next.name}`] as [string, string]] : []),
        ],
        checks: rating.checks,
        buttons: [
          ...(canNext
            ? [{ label: '下一关', variant: 'primary' as const, onClick: () => this.load({ kind: 'campaign', levelId: next.id }) }]
            : []),
          { label: '重试', variant: canNext ? ('secondary' as const) : ('primary' as const), onClick: () => this.restartSession() },
          { label: '选关', variant: 'ghost', onClick: () => this.load({ kind: 'menu' }) },
        ],
      }),
      true,
    );
  }

  private onDragFinished(time: number): void {
    const prev = this.progress.dragBest;
    const isBest = prev === null || time < prev;
    if (isBest) {
      this.progress.dragBest = time;
      SaveSystem.saveProgress(this.progress);
    }
    this.overlay.show(
      resultScreen({
        title: isBest ? '新纪录！' : '完成',
        passed: true,
        headline: `${time.toFixed(2)} s`,
        subline: '0–60 mph',
        rows: [['最佳', `${(this.progress.dragBest ?? time).toFixed(2)} s`]],
        buttons: [
          { label: '再来一次', variant: 'primary', onClick: () => this.restartSession() },
          { label: '菜单', variant: 'ghost', onClick: () => this.load({ kind: 'menu' }) },
        ],
      }),
      true,
    );
  }

  /** Apply and persist settings from the settings screen / HUD shortcuts. */
  private applySettings(next: Settings): void {
    if (next.controlScheme === 'tilt' && this.settings.controlScheme !== 'tilt') {
      // iOS asks for motion permission; this runs inside the tap that chose "tilt".
      void TiltInput.requestPermission().then((ok) => {
        if (!ok) {
          this.hud.banner('无法使用重力感应', '请在系统设置中允许动作与方向访问', 'bad', 2.5);
          this.applySettings({ ...this.settings, controlScheme: 'stick' });
        } else this.tilt.calibrate();
      });
    }
    Object.assign(this.settings, next);
    SaveSystem.saveSettings(this.settings);
    if (next.autoThrottle !== null) this.touchInput.autoThrottle = next.autoThrottle;
    if (next.airAssist !== null) this.car.airAssist = next.airAssist;
    this.hud.setAutoThrottle(this.touchInput.autoThrottle);
    this.applyControlSettings();
    this.audio.setVolumes(next.sfxVolume, next.musicVolume);
  }

  // ---------------------------------------------------------------------------
  // Loop
  // ---------------------------------------------------------------------------

  private readonly onVisibility = (): void => {
    // Dev: `?nopause` keeps running in a background tab (for automated screenshots).
    if (import.meta.env.DEV && location.search.includes('nopause')) return;
    this.hidden = document.visibilityState === 'hidden';
    this.audio.suspend(this.hidden);
    // Backgrounded: freeze; bring the pause menu up so nobody returns mid-jump.
    if (this.hidden && this.session && this.session.kind !== 'menu' && !this.overlay.visible) this.setPaused(true);
    this.syncPause();
    if (!this.hidden) this.perf.reset();
  };

  /** iPad + keyboard/gamepad hides the on-screen controls; touching brings them back. */
  private applyDevice(device: InputDevice): void {
    this.touchControls.setVisible(device === 'touch' && !this.userPaused);
    this.touchInput.isActiveDevice = device === 'touch';
    this.hud.setDevice(device);
  }

  private controlsLocked(s: Session): boolean {
    return s.kind === 'menu' || (s.campaign?.controlsLocked ?? false) || (s.drag?.controlsLocked ?? false);
  }

  private step(dt: number): void {
    const s = this.session;
    if (!s) return;
    const locked = this.controlsLocked(s);
    s.online?.step();
    this.car.step(dt, locked ? NEUTRAL : this.input.actions);
    this.stepCount++;
    const halfRate = this.tier === 'low';
    for (const o of s.opponents) {
      // Low tier: far opponents compute forces every other step with a doubled dt.
      const far = halfRate && o.car.simPosition.distanceTo(this.car.simPosition) > AI_FAR_DISTANCE;
      if (far && this.stepCount % 2 === 1) continue;
      const odt = far ? dt * 2 : dt;
      if (!locked && s.campaign) o.driver.update(odt, s.campaign.playerDistance, s.campaign.racerViews);
      o.car.step(odt, locked ? NEUTRAL : o.driver.actions);
    }
    this.physics.step(dt);
    this.car.capture();
    for (const o of s.opponents) o.car.capture();

    const landing = this.landing.update(dt, this.car);
    if (landing && s.kind !== 'menu') {
      this.car.addEnergy(STUNT_TUNING.landingRegen[landing.grade]);
      this.hud.showLanding(landing);
      this.audio.landing(landing.grade);
      this.chase.addShake(landing.grade === 'CRASH' ? 1 : landing.grade === 'BAD' ? 0.6 : 0.3 + Math.min(landing.airTime, 3) * 0.08);
      if (landing.grade === 'PERFECT' && this.settings.slowMo && landing.airTime > 1.2) {
        // Slow-motion orbit: 0.3× time for 1.5 s of real time.
        this.slowMoTimer = 1.5;
        this.loop.timeScale = 0.3;
        this.chase.startCinematic(1.5);
      }
    }
    s.campaign?.step(dt, landing);
    s.drag?.step(dt);
    s.free?.step(dt, this.car.forwardSpeed, this.car.airborne);
    if (s.free && s.level) {
      // Free roam still has a finish line: time the run from the start (or the last reset).
      const f = s.level.def.finish;
      const t = s.free.checkFinish(insideBox(this.car.simPosition, f.center, f.halfSize, f.heading), s.elapsed);
      if (t !== null) {
        this.banner('🏁 到达终点', `用时 ${t.toFixed(1)} 秒 · 暂停菜单「重新开始」可再跑一次`, 'good', 3);
        this.audio.landing('PERFECT');
      }
    }
    s.elapsed += dt;
    this.hazards(s, dt);
  }

  /** Falls, deep water (lost) and wading (drag), for the player and the opponents. */
  private hazards(s: Session, dt: number): void {
    const lvl = s.level;
    const p = this.car.simPosition;
    const hz = lvl ? lvl.hazardAt(p) : p.y < -30 ? 'fall' : null;
    if (hz === 'fall' || hz === 'deepWater') {
      const reason = hz === 'fall' ? '坠落！' : '落水！';
      if (s.campaign) s.campaign.carLost(reason);
      else this.car.reset();
    } else if (hz === 'shallowWater' && lvl) {
      this.car.applyWaterDrag(dt, lvl.waterDepthAt(p.x, p.z));
    }
    if (!lvl) return;
    for (const o of s.opponents) {
      const q = o.car.simPosition;
      const h = lvl.hazardAt(q);
      if (h === 'fall' || h === 'deepWater') o.driver.recoverNow();
      else if (h === 'shallowWater') o.car.applyWaterDrag(dt, lvl.waterDepthAt(q.x, q.z));
    }
  }

  private frame(alpha: number, frameDt: number, realDt: number): void {
    const actions = this.input.update();
    if (this.slowMoTimer > 0) {
      this.slowMoTimer -= realDt;
      if (this.slowMoTimer <= 0 || this.userPaused) {
        this.slowMoTimer = 0;
        this.loop.timeScale = 1;
      }
    }
    const s = this.session;
    if (s && s.kind !== 'menu' && !this.loading) {
      if (actions.pausePressed) this.setPaused(!this.userPaused);
      if (!this.userPaused && !this.controlsLocked(s)) {
        if (actions.resetPressed) this.car.reset();
        if (actions.cameraPressed) this.toggleCamera();
      }
    }

    this.car.updateVisual(alpha);
    s?.online?.frame(frameDt, this.renderer.drawingHeight, this.renderer.camera.fov);
    for (const o of s?.opponents ?? []) {
      o.car.updateVisual(alpha);
      o.thrusters?.setViewport(this.renderer.drawingHeight, this.renderer.camera.fov);
      o.thrusters?.update(frameDt, o.car.thrust, o.root, null);
    }

    const cam = this.renderer.camera;
    const p = this.car.renderPosition;
    if (this.debugOrbit) {
      const [yaw, pitch, dist] = this.debugOrbit;
      this.orbit(yaw, pitch, dist);
    } else if (s?.showroom && s.kind === 'menu') {
      // Title screen: the robot stands by the car while the camera slowly circles them.
      s.showroom.update(frameDt, null);
      this.menuAngle += frameDt * 0.12;
      this.orbit(this.menuAngle - 2.3, 0.12, 8);
    } else if (s?.showroom && s.campaign?.phase === 'countdown') {
      // Title screen, or the robot climbing in during the race countdown
      // (a run that restarts from the grid gets back in again).
      if (s.kind === 'campaign' && this.lastPhase !== 'countdown' && s.showroom.seated) s.showroom.boardForCountdown();
      s.showroom.raceClock = s.campaign?.countdownElapsed ?? null;
      s.showroom.update(frameDt, cam);
      this.robotCam = true;
    } else if (s?.kind === 'menu') {
      this.menuAngle += frameDt * 0.12;
      this.orbit(this.menuAngle - 2.3, 0.12, 7.5);
    } else {
      if (this.robotCam) {
        // Cut from the boarding shot to the chase camera at GO.
        this.robotCam = false;
        this.chase.snap();
      }
      s?.showroom?.update(frameDt, null);
      if (this.car.thrust.rear > 0) this.chase.addShake(realDt * 0.6);
      this.chase.update(frameDt, p, this.car.renderQuaternion, this.car.forwardSpeed, this.car.onAdhesive, realDt);
    }
    this.lastPhase = s?.campaign?.phase ?? null;
    // The cabin is hidden only while looking out from the driver's seat.
    const interior = !(this.chase.mode === 'cockpit' && !this.robotCam && s?.kind !== 'menu' && !this.debugOrbit);
    if (interior !== this.interiorShown) {
      this.interiorShown = interior;
      setCarInterior(this.carRoot, interior);
    }
    if (s?.level) {
      s.level.update(frameDt, s.campaign?.elapsed ?? s.elapsed, cam, {
        player: this.car.renderPosition,
        warn: (t, sub) => this.hud.banner(t, sub, 'bad', 1.6),
      });
    }
    else s?.test?.updateSky(cam);

    if (this.thrusters) {
      this.thrusters.setViewport(this.renderer.drawingHeight, cam.fov);
      const boarding = s?.showroom && (s.kind === 'menu' || s.campaign?.phase === 'countdown');
      this.thrusters.update(frameDt, boarding ? s!.showroom!.thrust : this.car.thrust, this.carRoot, this.car.probeGroundY());
    }
    this.touchControls.setAirborne(this.car.airborne);
    this.updateEffects(s, frameDt, realDt);
    this.renderer.followShadow(p);
    this.renderer.render(frameDt);

    this.perf.sample(frameDt);
    this.updateHud(s);
    this.input.endFrame();
  }

  /** Ground spray, skid marks, blur and audio for this frame. */
  private updateEffects(s: Session | null, frameDt: number, realDt: number): void {
    const cam = this.renderer.camera;
    const speed = this.car.forwardSpeed;
    this.carRight.set(1, 0, 0).applyQuaternion(this.car.renderQuaternion);
    const p = this.car.renderPosition;
    const depth = s?.level ? s.level.waterDepthAt(p.x, p.z) : 0;
    this.groundFx.setViewport(this.renderer.drawingHeight, cam.fov);
    this.groundFx.update(frameDt, this.car.wheelStates, speed, p.y < (s?.level?.def.waterLevel ?? -1e9) + 0.6 ? depth : 0, this.carRight);

    // Boost zoom blur, plus a speed blur on the high tier.
    const boostBlur = this.car.thrust.rear > 0 ? 0.9 : 0;
    const speedBlur = this.tier === 'high' ? Math.max(0, (Math.abs(speed) - 45) / 60) : 0;
    this.blur += (Math.max(boostBlur, speedBlur) - this.blur) * (1 - Math.exp(-6 * realDt));
    this.renderer.setBlur(this.blur);

    cam.getWorldDirection(this.camFwd);
    const near: (readonly [number, number, number, number])[] = (s?.opponents ?? [])
      .map((o) => [o.car.renderPosition.x, o.car.renderPosition.y, o.car.renderPosition.z, o.car.forwardSpeed] as const)
      .sort((a, b) => (a[0] - p.x) ** 2 + (a[2] - p.z) ** 2 - ((b[0] - p.x) ** 2 + (b[2] - p.z) ** 2))
      .slice(0, 3);
    const t = this.car.thrust;
    this.audio.update(
      {
        speed: s?.kind === 'menu' ? 0 : speed,
        throttle: s?.kind === 'menu' ? 0 : this.input.actions.throttle,
        boost: t.rear,
        jets: Math.max(t.down, t.left, t.right),
        airborne: this.car.airborne,
      },
      { x: cam.position.x, y: cam.position.y, z: cam.position.z, fx: this.camFwd.x, fy: this.camFwd.y, fz: this.camFwd.z },
      near,
      this.userPaused || this.loading,
    );
  }

  private orbit(yaw: number, pitch: number, dist: number): void {
    const cam = this.renderer.camera;
    const p = this.car.renderPosition;
    cam.up.set(0, 1, 0);
    cam.position.set(
      p.x + Math.sin(yaw) * Math.cos(pitch) * dist,
      p.y + 0.6 + Math.sin(pitch) * dist,
      p.z + Math.cos(yaw) * Math.cos(pitch) * dist,
    );
    cam.lookAt(p.x, p.y + 0.55, p.z);
  }

  private updateHud(s: Session | null): void {
    const hud = this.hud;
    hud.setSpeed(this.car.forwardSpeed, this.settings.units);
    hud.setEnergy(this.car.energy / this.car.energyMax, this.car.thrust.rear > 0 || this.car.thrust.down > 0.5);
    if (!s) return;
    const c = s.campaign;
    if (c) {
      const gate = c.currentGate;
      const wait = s.online && c.phase === 'waiting' ? Math.max(0, Math.ceil(s.online.secondsToGo - 3)) : 0;
      const info =
        s.online && c.phase === 'waiting'
          ? `联机比赛 · ${wait} 秒后发车`
          : gate
            ? `特技：${gate.name} · 需 ≥ ${c.def.requiredLandingGrade} · 重试 ${c.retriesLeft}`
            : '冲向终点！';
      const { place, racers } = c.standing;
      hud.setRace(true, c.time, c.def.timeLimit, c.progress, info, place, racers);
      const others = s.online
        ? [...s.online.remotes.values()].map((r) => r.rig.root.position)
        : s.opponents.map((o) => o.car.renderPosition);
      s.minimap?.draw(this.car.renderPosition, this.car.renderQuaternion, others);
    } else if (s.drag) {
      const best = this.progress.dragBest;
      hud.setRace(true, s.drag.time, 999, Math.min(Math.max(this.car.forwardSpeed, 0) / SIXTY_MPH, 1), `0–60 mph · 最佳 ${best === null ? '—' : best.toFixed(2) + ' s'}`, 1, 1);
    } else if (s.free) {
      const unit = this.settings.units === 'kmh' ? MS_TO_KMH : MS_TO_MPH;
      const label = this.settings.units === 'kmh' ? 'km/h' : 'mph';
      hud.setRace(true, s.elapsed, 999, 0, s.free.info((v) => `${Math.round(v * unit)} ${label}`), 1, 1);
    }
  }

  // ---------------------------------------------------------------------------
  // Quality
  // ---------------------------------------------------------------------------

  private setTier(tier: QualityTier): void {
    this.tier = tier;
    const q = QUALITY[tier];
    this.renderer.applyQuality(q);
    this.loop.setFixedDt(1 / q.physicsHz);
    this.perf.reset();
  }

  /** Auto-downgrade step: lower resolution first, then the tier. */
  private degrade(): boolean {
    const scale = this.renderer.currentRenderScale;
    if (scale > AUTO_DOWNGRADE.firstRenderScale + 1e-3) {
      this.renderer.setRenderScale(AUTO_DOWNGRADE.firstRenderScale);
      return true;
    }
    const lower = lowerTier(this.tier);
    if (lower) {
      this.renderer.setRenderScale(1);
      this.setTier(lower);
      return true;
    }
    if (scale > AUTO_DOWNGRADE.minRenderScale + 1e-3) {
      this.renderer.setRenderScale(Math.max(AUTO_DOWNGRADE.minRenderScale, scale - AUTO_DOWNGRADE.renderScaleStep));
      return true;
    }
    return false;
  }

  private installDebug(): void {
    if (!import.meta.env.DEV) return;
    (window as unknown as { __debug: object }).__debug = {
      orbit: (yaw: number, pitch: number, dist: number) => (this.debugOrbit = [yaw, pitch, dist]),
      chase: () => (this.debugOrbit = null),
      car: () => ({
        pos: this.car.renderPosition.toArray().map((v) => +v.toFixed(2)),
        kmh: Math.round(this.car.forwardSpeed * 3.6),
        grounded: this.car.groundedWheels,
      }),
      teleport: (z: number, x = 0, heading = 0) => {
        // Drop onto whatever is below (roads sit ~0.3 m above the terrain grid).
        const ground = this.session?.level ? this.session.level.heightAt(x, z) + 0.6 : 0;
        this.car.respawn(new THREE.Vector3(x, ground, z), heading);
        this.chase.snap();
      },
      load: (startup: Startup) => this.load(startup),
      scene: this.renderer.scene,
      info: () => ({ ...this.renderer.renderer.info.render, tier: this.tier, geometries: this.renderer.renderer.info.memory.geometries, textures: this.renderer.renderer.info.memory.textures }),
      finish: (place = 1) =>
        this.onRunFinished({
          passed: place <= (this.session?.level?.def.requiredPlace ?? 3),
          place,
          racers: 4,
          requiredPlace: this.session?.level?.def.requiredPlace ?? 3,
          time: 35.4,
          grades: ['PERFECT', 'GOOD'],
          gateNames: ['飞越车队', '倒挂半环'],
          retriesUsed: 0,
          perfects: 1,
        }),
    };
  }
}
