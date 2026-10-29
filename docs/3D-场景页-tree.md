# `/tree/` — 3D 四季场景页说明

一个纯前端（three.js r186 + Astro）的 3D 场景页，用来展示"同一天、不同地点"的风景。
整页只有 `src/pages/tree.astro` 一个文件（模型/贴图在 `public/` 下），没有后端依赖。

## 1. 场景与地区

页面内置 6 个地区，配置集中在 `tree.astro` 的 `REGION_SCENE`：

| id | 地区 | 场景要点 |
| --- | --- | --- |
| `hangzhou` | 杭州 | 湖面 + 湖心亭 + 雷峰塔，山环单侧开口（另一侧留出地平线） |
| `sanya` | 三亚 | 海天相接、无山环，程序化椰林 |
| `shandong` | 山东 | 阔叶林 + 平原缓丘 |
| `lhasa` | 拉萨 | 布达拉宫坐落红山，南坡三段折返白梯 |
| `harbin` | 哈尔滨 | 针叶林 + 雪线 |
| `tromso` | 特罗姆瑟 | 高纬低日照、雪山 |

每个地区可配置：地形高度场、树种与密度、山环方位/开口角度（`openAz/openCore/openEdge`）、
天体升落、雾浓度、季节色板。

## 2. 可切换维度

- **地区**：下拉框 `#in-region`
- **季节**：春/夏/秋/冬，驱动 `foliageMaterial()` / `woodMaterial()` 的贴图调色与叶色
- **天气**：`#weather-pills`，可选实况（Open-Meteo，需要 `connect-src https://api.open-meteo.com`）或 `mock` 预设；
  实况拉取温度、云量、风速、降水，mock 用于离线/测试
- **时段**：太阳高度角决定天光、阴影与天体位置

天气接口的 CSP 白名单在 `public/_headers`，新增外部接口时同步添加，否则线上会被拦截。

## 3. 资源

```
public/models/           # GLB 模型（树、亭、塔、宫殿、山体等）
public/textures/
  ├── grass/             # 草叶贴图
  ├── ground/            # 地表贴图
  ├── palm/  pine/  willow/   # 树种树皮/叶贴图
```

模型加载统一走 `ensureModel()`：`loadGLB` → `attachSpeciesTextures` → clone → bbox 归一化
（`MODEL_SRC[k].height/spread`、`trunkFoot`）→ `rebuildTree()` 按材质名分类
（`/leaves|leaf|twigs?/i` 视为叶片）→ 季节调色 → `addTreeWind()` 挂风摆。

## 4. 程序化建模（不依赖 GLB）

有些近景元素用 GLB 反而假，改为代码生成：

- **椰树 `buildPalmTree()`**
  - 树干：30 环 × 14 段，半径带根部膨大；贴图为程序化叶痕环（`palmBarkTexture()`）
  - 叶冠：22 片羽叶 × 每米叶轴 15 对小叶（按叶长换算对数，保证长短叶密度一致），
    两列小叶沿叶轴上翻成 V 形叶槽；小叶末端自坠
  - 冠基：叶鞘 + 青椰果簇
  - 枯叶：3 片近垂直下垂的老叶，复用 `makeFrond()`，独立材质 `palm_dead`（不参与季节调色）
  - 侧视图/顶视图都不再是"弯纸片"
- **布达拉宫红山**
  - `cragify()`：逐顶点三段渐变（山脚草灌绿 → 山腰碎石褐 → 崖顶裸岩），
    外扩碎石裙让山体以缓坡接入草甸
  - 台地：`PROF` 分段线性剖面 + smoothstep，z≈33~39 之间形成近垂直崖壁
  - 登山梯道：`surfaceZ()` 反查坡面位置，三段折返的白梯贴着崖面横切上升，
    梯身 + 外侧矮护墙刷白，用无光照材质避免被绿色地面反光染成橄榄色

## 5. 渲染要点

- **山环单侧开口**：`injectSnowGold()` 注入 `uOpenDir / uOpenCos / uCityMask`，
  按方位角把山脊压平，实现"一侧环山、另一侧开阔"（杭州原有效果不变）
- **天体**：太阳为硬边圆盘；月亮位置与相位由本地低精度历表计算（不依赖网络），
  天气只影响云量与可见度
- **性能**：叶片/山体均按地区合并几何；远距离元素不做逐帧更新

## 6. 本地开发

```bash
npm run build                # 产出 dist/
npx astro preview --port 4334  # 预览构建产物（改了代码必须重新 build 再重启，否则拿到旧 chunk）
```

调试截图脚本可放在 `/tmp`（Playwright），按地区切 `#in-region` 后截图，检查控制台 `errors`。

## 7. 已知待办

- 布达拉宫整体布局：宫体相对山体偏小，缺少照片中层层跌落的白色台基，
  梯道目前只到台地口，尚未接到白色宫墙。需要重做台基（带竖向盲窗与腰线）并与宫体比例一起调整。
- 椰树枯叶数量与朝向可再随机化，进一步弱化"人工整齐"感。
