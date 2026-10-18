# 特斯拉 Roadster 3D 赛车闯关 (TESLA ROADSTER · 3D Stunt Racing Challenge)

3D 特技赛车闯关游戏 —— Three.js + TypeScript + Vite + Rapier 物理。
同一套代码在电脑浏览器、手机（iOS Safari / Android Chrome）和 iPad 上运行，可"添加到主屏幕"作为全屏 PWA 离线游玩。
所有模型、地形、音效、音乐、图标都由代码程序化生成，没有外部资源文件。

- 玩家车 **VOLT-R**：原创棱角楔形电动超跑（无品牌 Logo / 文字），隐藏式推进器：后喷 Boost、底喷跳跃 / 悬停飞行、侧喷空中横滚。
- 6 个关卡 / 6 种场景：沙漠发布会场、海边公路、山地盘山路、雪山、红岩峡谷、霓虹夜城高架。
- AI 对手 6 款原创车型（Fulmine V12、Kaiser GT-S、Raijin RX、Bolt Hammer、Aurora E、Dune Rex）。
- 模式：闯关（星级、解锁、存档）、自由驾驶、直线加速 0–60 mph。

## 运行

需要 Node.js 18+（开发时使用 Node 24）。

```bash
npm install
```

```bash
npm run dev
```

打开终端里显示的 `Local` 地址（默认 http://localhost:5173）。

### 手机 / iPad 局域网测试

`npm run dev` 已带 `--host`，终端会同时打印 `Network: http://192.168.x.x:5173/`。
手机和电脑连同一个 Wi-Fi，在手机浏览器打开这个地址即可。

- 打不开：macOS「系统设置 → 网络 → 防火墙」允许 node 接受传入连接；Windows 防火墙同理。
- 端口被占用时 Vite 会自动换到 5174、5175…，以终端显示为准。
- 横屏游玩；竖屏会显示"请旋转设备"并暂停。
- iOS 的声音需要先点一下屏幕才会开始（浏览器限制）。

### 构建与本地预览

```bash
npm run build
```

```bash
npm run preview
```

`npm run build` 会先做 TypeScript 严格类型检查（`tsc --noEmit`），再输出到 `dist/`（含 Service Worker 和 manifest）。

## 部署

`dist/` 是纯静态文件，`vite.config.ts` 里 `base: './'`，可以部署在任意路径下：

- **Vercel**：导入仓库，Framework 选 Vite，Build Command `npm run build`，Output `dist`。
- **Netlify**：Build command `npm run build`，Publish directory `dist`。
- **GitHub Pages**：`npm run build` 后把 `dist/` 推到 `gh-pages` 分支（或用 Pages 的 Actions 部署 `dist`）。

PWA 需要 HTTPS（以上三者默认都是）。

### 安装到主屏幕

- **iPhone / iPad**：Safari → 分享 → 添加到主屏幕。从主屏幕打开即为全屏横屏，且可离线游玩。
- **Android**：Chrome 菜单 → 安装应用 / 添加到主屏幕。主菜单里的「全屏」按钮也会尝试锁定横屏。

## 多人联机

主菜单「多人联机」→ 输入昵称 →「创建房间」，把房间里的**邀请链接**发给同学；对方打开链接点「加入房间」即可进入同一个房间（最多 8 人）。房主选赛道、点「开始比赛」，所有人在同一场景、同一时刻发车，能看到彼此的车（各自颜色 + 名字），实时名次和终点成绩互相同步。

联机需要自带的 Node 服务器（静态文件 + WebSocket `/ws`），纯静态托管（Vercel / Netlify / Pages / claude.ai 链接）只能单人玩：

```bash
npm run start
```

（= `npm run build` + `npm run serve`，默认端口 4173，可用 `PORT=8080 npm run serve` 修改。）终端会打印 `http://192.168.x.x:4173/`，**同一个 Wi-Fi** 下的电脑、手机、iPad 都能打开；即使你自己用 localhost 打开，邀请链接也会自动换成局域网地址。

- 不在同一个网络（比如同学在家）：把整个项目部署到能跑 Node 的云主机（Render、Railway、Fly.io、自己的 VPS 等），启动命令 `npm run start`，用它给的 HTTPS 地址打开游戏，邀请链接就能在互联网上用。
- 开发时：一个终端 `npm run dev:server`（端口 8787），另一个终端 `npm run dev`，Vite 会把 `/ws` 代理过去。
- 设计：每个人的车在自己设备上模拟（手感不受网速影响），每秒 20 次把位置发给服务器转发；别人的车做 120 ms 插值，对你来说是可以碰撞的实体。发车时间以服务器时钟为准；比赛中打开暂停菜单不会冻结比赛。房主掉线时房主自动转给下一个人；比赛中途加入的人在房间等下一场。

## 操作

| 操作 | 键盘 | 手柄 | 触屏 |
|---|---|---|---|
| 油门 / 刹车倒车 | W / S | RT / LT | 右下「油门」/「刹车」（可开自动油门） |
| 转向 | A / D | 左摇杆 | 左侧浮动摇杆，或重力感应 |
| Boost | Shift | A | BOOST |
| 跳跃（长按悬停 = 飞行） | Space | B | JUMP |
| 空中横滚 左 / 右 | Q / E | LB / RB | 离地时出现的 ⟲ / ⟳ |
| 空中俯仰 | W / S（离地时） | 左摇杆上下 | 摇杆上下 |
| 空中偏航 | A / D（离地时） | 左摇杆左右 | 摇杆左右 |
| 手刹漂移 | Ctrl | X | — |
| 切换视角 | C | Y | — |
| 回到安全位置 | R | Back | — |
| 暂停 | Esc | Start | 右上 ⏸ |

- 设置里可切换触屏方案：**虚拟摇杆**（默认）或 **重力感应**（iOS 会请求动作权限；带校准、灵敏度、死区）。
- iPad 接上键盘或手柄会自动隐藏触屏按钮，碰一下屏幕又会出现。
- 「空中自动扶正」在触屏上默认开启；Boost 能量在地面缓慢回充，落地评级越好回充越多。

### 落地评级

| 评级 | 条件 |
|---|---|
| PERFECT | 四轮 0.15 s 内着地、车身与地面夹角 < 10°、速度保留 ≥ 85% |
| GOOD | 夹角 < 25°、车身未擦地、速度保留 ≥ 60% |
| BAD | 夹角 < 40° 或轻微擦底 |
| CRASH | 车顶 / 侧面着地，或撞上被飞越的车 |

PERFECT 会触发 0.3× 慢动作环绕镜头（设置里可关）。

## 画质与性能

启动时 `DeviceProfile` 根据触屏、屏幕、像素比、GPU（`WEBGL_debug_renderer_info`）、内存自动选择档位：

| 档位 | 像素比上限 | 阴影 | 后处理 | 粒子 | 视距 | 物理 |
|---|---|---|---|---|---|---|
| 低 | 1.0 | 关 | 仅 ACES 色调映射 | 200 | 400 m | 60 Hz |
| 中 | 1.5 | 1024 | Bloom + Boost 径向模糊 | 600 | 800 m | 120 Hz |
| 高 | 2.0 | 2048 | Bloom + 色差 + 径向 / 速度模糊 | 1500 | 1500 m | 120 Hz |

- 连续 3 秒低于 45 fps 会先降渲染分辨率、再降一档；设置里或左上角画质标签可手动锁定。
- 道具和车队用 InstancedMesh；车身细节按材质合并；对手车远处切换为简化模型（LOD）；低档位远处 AI 半频更新物理；粒子对象池；切换关卡释放几何体、纹理和物理碰撞体。
- 物理 WASM 单独成 chunk，在启动画面期间并行加载。

开发用 URL 参数：`?quality=low|medium|high`、`?level=3`（直接进第 3 关）、`?test`（试车场）、`?drag`（直线加速）。

## 无界面测试（Node）

```bash
npm run sim
```

真实物理下测 0–100、极速、刹车距离、过弯、跳跃高度、悬停飞行、空中 360°。

```bash
npm run sim:level -- 4 7 ai
```

参数：关卡号、随机种子、`ai`（让满技能 AI 代驾玩家），会输出每个特技门的判定、名次和用时。

## 如何添加新关卡

只改数据：在 `src/config/levels.ts` 的 `LEVELS` 末尾加一项，不需要改代码。

```ts
{
  id: 7,
  name: '新关卡',
  subtitle: '一句话介绍',
  biome: 'desert',               // desert | coast | mountain | snow | canyon | nightCity
  timeOfDay: 'noon',
  weather: 'clear',
  aiCount: 5, aiSkill: 0.7, aiRubberBand: 0.4,
  requiredPlace: 2,
  requiredLandingGrade: 'GOOD',
  requiredPerfects: 0,           // 可选
  retriesAllowed: 3, retryPenalty: 5,
  timeLimit: 160, parTime: 45,   // parTime 决定第 3 颗星
  killY: -40,                    // 可选：掉落判定
  waterLevel: 0,                 // 可选：海面（深水 = 落水）
  carves: [],                    // 可选：地形挖坑（缺口跳跃下的深谷）
  start: { position: [0, 0, 500], heading: 0 },   // heading 0 = 朝 -Z
  finish: { center: [0, 2, -400], halfSize: [12, 6, 2], heading: 0 },
  roads: [{ points: [[0, 0, 520], [0, 0, -420]], width: 16, style: 'asphalt', barriers: true }],
  stunts: [
    { type: 'kicker', position: [0, 0, 200], heading: 0, params: { width: 12, length: 14, angleDeg: 15 } },
    { type: 'carRow', position: [0, 0, 165], heading: 0, params: { vehicles: ['sedan', 'suv', 'pickup'], gap: 0.8 } },
  ],
  gates: [
    { name: '飞越车队', center: [0, 10, 120], halfSize: [14, 40, 100], heading: 0,
      checkpoint: [0, 0, 320], checkpointHeading: 0 },
  ],
  trackSpline: [[0, 0, 500], [0, 0, 200], [0, 3.6, 187], [0, 0, 100], [0, 0, -400]],
}
```

- **道路** `roads`：Catmull-Rom 中心线；`style` = asphalt / wet / dirt / snow / ice / wood / sand（决定抓地）；`elevated` 高架带桥墩；`barriers` 护栏；`terrainFlat/terrainBlend` 控制地形贴合路面的范围。
- **特技件** `stunts`：`kicker`（跳台，可设 `approachSpeed` / `clearDistance` 给 AI 规划速度）、`carRow`（停放车队，撞上 = CRASH）、`invertedHalfLoop`（倒挂半环）、`fullLoop`（垂直回环）、`wallRide`（竖直岩壁吸附）、`hump`（下坡起伏）、`tunnel`、`building`（楼顶可驾驶）、`rockfall`（落石事件）。
- **特技门** `gates`：进入盒子即开始判定，下一次落地必须达到等级；可加 `minGrade`、`requires`（`inverted` / `roll360` / `wall`）、`pass: 'ride'`（回环 / 岩壁不需要落地）、`landingZone`（必须落在对岸）。失败从 `checkpoint` 重试并扣时。
- **赛车线** `trackSpline`：起点到终点的理想线，用于进度、名次和 AI。
- 新增后用 `npm run sim:level -- 7 1 ai` 跑一遍，确认可以通关。

## 如何添加新车型

在 `src/config/cars.ts` 的 `CARS` 里加一项：

- `shape`：车长 / 宽 / 高、车头 / 车尾高度、座舱起止、圆润度、轮径、轴距、离地间隙、进气口、尾翼（none / lip / duck / big）、灯型（slim / round / bar）、开放式防滚架。`OpponentModel.ts` 会据此程序化建模（含轮拱切割、远处 LOD）。
- `perf`：极速（m/s）、动力、抓地、重量、转向倍率、Boost 容量、是否越野。
- `ai`：攻击性、Boost 偏好、漂移倾向、落地稳定性。
- `palette`：可选车身颜色，每关随机抽取。

## 目录结构

```
src/
  main.ts                启动：设备检测、物理 WASM、Game
  config/                tuning.ts 手感 · levels.ts 关卡 · cars.ts 车型 · quality.ts 画质
  core/                  Game（会话 / 菜单流程）· Renderer · Physics · Audio · GameLoop · SaveSystem · DeviceProfile · ChaseCamera
  input/                 InputManager + Keyboard / Gamepad / Touch / Tilt
  vehicle/               CarModelFactory（VOLT-R）· OpponentModel · CarController（射线悬挂）· Thrusters · LandingJudge
  ai/                    RacingLine · AIDriver · AIStuntPlanner
  world/                 Level · TrackBuilder · StuntPieces · Terrain · Ocean · Sky · biomes/*
  modes/                 Campaign · FreeRoam · DragRun · OnlineRace · Scoring
  net/                   NetClient（WebSocket + 时钟同步）· RemoteCar（插值）· protocol
  ui/                    Lobby（联机大厅）· HUD · Menu · LevelSelect · ResultScreen · Settings · TouchControls · Minimap · RotateHint
  fx/                    ParticleSystem · GroundFX（扬沙 / 水花 / 雪雾 / 轮胎痕）· Weather · RadialBlurEffect
server/                  index.mjs：静态文件 + 联机房间服务器
scripts/                 sim.ts · sim-level.ts · make-icons.mjs
```

## 已知限制

- 车模和场景是程序化的近似风格化造型，不是照片级还原。
- 难度（AI 速度、橡皮筋、跳台角度）已用无界面模拟校准，但仍需要真人在手机上试玩微调，参数都在 `levels.ts` 和 `tuning.ts`。
- 物理引擎用 `rapier3d-compat`（WASM 内联在 JS 里，约 1.7 MB gzip），首次加载较慢；之后由 Service Worker 缓存。
