"""Blender-built mountain assets for the /tree scene.

Replaces two pieces of hand-rolled three.js geometry:

  mountain_range.glb  三层环绕山脊带（近 / 中 / 远），实地形而不是正弦"帘子"
  lake_hill.glb       杭州西湖对岸小山（原先是压扁的低模球）
  red_hill.glb        拉萨红山 —— 布达拉宫脚下的山脊（原先是压扁的低模球）

Silhouettes come from periodic ridged noise (peaks and saddles), slopes from a
concave height profile, and the surface is carved with radial gullies plus
outward buttresses so the ring reads as terrain instead of a curtain.

All colour work (season palette, snow line, atmospheric haze, golden-hour tint)
stays in the runtime, so these meshes are pure geometry. Blender +Z is up; the
glTF exporter converts to Y-up.
"""

import math
import os

import bpy

try:
    HERE = os.path.dirname(os.path.abspath(__file__))
except NameError:  # Blender always sets __file__ for --python scripts
    # --exec 模式下没有 __file__，回退到仓库内的脚本目录（脚本唯一真源）
    HERE = os.path.expanduser("~/yumdeer.github.io/tools/blender")

exec(open(os.path.join(HERE, "bg_common.py")).read())

OUT_DIR = os.path.expanduser("~/yumdeer.github.io/public/models")
PREVIEW_DIR = "/tmp"

TAU = math.tau
GROUND_Z = -22.0  # 山脚埋进地下的高度，和旧程序化山环一致


# ──────────────────────────────── noise ────────────────────────────────


def _hash(ix, iy, seed):
    n = (ix * 374761393 + iy * 668265263 + int(seed * 1013) * 1442695041) & 0xFFFFFFFF
    n = ((n ^ (n >> 13)) * 1274126177) & 0xFFFFFFFF
    return ((n ^ (n >> 16)) & 0xFFFFFFFF) / 4294967295.0


def vnoise(x, y, seed):
    ix, iy = math.floor(x), math.floor(y)
    fx, fy = x - ix, y - iy
    ux = fx * fx * (3.0 - 2.0 * fx)
    uy = fy * fy * (3.0 - 2.0 * fy)
    a = _hash(ix, iy, seed)
    b = _hash(ix + 1, iy, seed)
    c = _hash(ix, iy + 1, seed)
    d = _hash(ix + 1, iy + 1, seed)
    return (a + (b - a) * ux) * (1.0 - uy) + (c + (d - c) * ux) * uy


def fbm(x, y, seed, octaves=4, gain=0.5, lac=2.03):
    total = amp = norm = 0.0
    norm = 0.0
    amp = 0.5
    f = 1.0
    for k in range(octaves):
        total += vnoise(x * f, y * f, seed + 101 * k) * amp
        norm += amp
        amp *= gain
        f *= lac
    return total / norm


def ridged(x, y, seed, octaves=4):
    """1 - |2n-1|: crests with saddles, kept soft (no squaring) so the
    silhouette gets broad shoulders instead of a row of needles."""
    total = amp = norm = 0.0
    norm = 0.0
    amp = 0.5
    f = 1.0
    for k in range(octaves):
        v = 1.0 - abs(2.0 * vnoise(x * f, y * f, seed + 137 * k) - 1.0)
        total += (v ** 1.35) * amp
        norm += amp
        amp *= 0.46
        f *= 2.03
    return total / norm


def ang_noise(th, freq, seed, octaves=3, mode="fbm"):
    """Noise sampled around a circle, so it is exactly periodic in theta."""
    cx, cy = math.cos(th) * freq + seed, math.sin(th) * freq - seed
    if mode == "ridged":
        return ridged(cx, cy, seed, octaves)
    return fbm(cx, cy, seed, octaves)


# ───────────────────────────── ridge ring ─────────────────────────────

# 近 / 中 / 远三层：高度、进深、段数都和旧程序化版本同一个构图，
# 只是山脊从"一圈正弦"换成真正的地形带。
LAYERS = [
    dict(name="mtn_far", dist=574.0, h=112.0, depth=104.0, seed=1.9, seg=760, rows=15,
         rib=4.6, cut=0.15),
    dict(name="mtn_mid", dist=398.0, h=76.0, depth=82.0, seed=6.7, seg=620, rows=14,
         rib=6.5, cut=0.19),
    dict(name="mtn_near", dist=262.0, h=42.0, depth=64.0, seed=3.1, seg=480, rows=12,
         rib=9.0, cut=0.24),
]


def ridge_band(L, mat):
    seg = L["seg"]
    rows = L["rows"]
    h = L["h"]
    seed = L["seed"]
    step = TAU / seg

    # 先预采样每列的脊高。权重压在低频上：山体先是几座宽肩的大山，
    # 高频只负责峰顶的碎裂；旧版高频权重过大，剪影变成一排等高的针。
    raw = []
    for i in range(seg):
        th = i * step
        massif = ang_noise(th, 1.05, seed + 2.0, 3)
        crest = ang_noise(th, 4.4, seed + 4.0, 3, "ridged")
        spikes = ang_noise(th, 10.5, seed + 6.0, 2, "ridged")
        fine = ang_noise(th, 24.0, seed + 9.0, 2, "ridged")
        raw.append(0.60 * massif + 0.30 * crest + 0.08 * spikes + 0.02 * fine)
    srt = sorted(raw)
    lo = srt[int(0.03 * (seg - 1))]
    hi = srt[int(0.97 * (seg - 1))]
    span = max(hi - lo, 1e-4)

    verts, faces = [], []
    for i in range(seg):
        th = i * step
        massif = ang_noise(th, 1.05, seed + 2.0, 3)
        norm = min(1.0, max(0.0, (raw[i] - lo) / span))
        H = h * (0.14 + 0.96 * norm ** 1.45)
        # 进深跟着山体质量走：主峰后面拖得远，垭口薄 —— 侧看才有前后层次
        dep = L["depth"] * (0.60 + 0.62 * massif)
        r0 = L["dist"] * (1.0 + 0.05 * math.sin(th * 3.2 + seed)
                          + 0.022 * math.sin(th * 7.3 - seed * 1.7))
        # 两道不同频率的棱线叠出"脊 / 沟"：ribs 越小越靠沟底。
        # 沟谷同时向下切、向里收，形成从山脊泻下来的 V 形冲沟，
        # 而不是旧版那种一圈竖直的布料褶皱。频率按层递减：远山只留大山脊
        rib_f = L["rib"]
        ribs = (ang_noise(th, rib_f, seed + 11.0, 2, "ridged")
                + ang_noise(th, rib_f * 2.4, seed + 21.0, 2, "ridged") * 0.55)
        gully = (1.0 - min(1.0, ribs / 1.55)) ** 1.7
        micro = vnoise(math.cos(th) * 60.0 + seed, math.sin(th) * 60.0 - seed, int(seed * 97))
        for j in range(rows + 1):
            s = j / rows
            # 凹形坡面：山脚缓、近脊陡，是远山真实的重心分布
            e = s ** 1.7
            r = r0 + dep * s - h * 0.13 * gully * e
            z = GROUND_Z + (H - GROUND_Z) * e
            z -= h * L["cut"] * gully * s ** 1.5
            z += h * 0.04 * (micro - 0.5) * math.sin(math.pi * s) * 2.0
            verts.append((math.cos(th) * r, math.sin(th) * r, z))
    row = rows + 1
    for i in range(seg):
        i2 = (i + 1) % seg
        for j in range(rows):
            a = i * row + j
            b = i2 * row + j
            # 逆时针（俯视）：内圈 i → 外圈 i → 外圈 i2 → 内圈 i2，
            # 法线朝上朝外。反着写会让整个山脊的法线朝下，单面材质只剩背面
            faces.append((a, a + 1, b + 1, b))
    return mesh_object(L["name"], verts, faces, mat, smooth=True)


def profile_stats(L):
    """Debug: print the ridge-height profile so tuning is not blind."""
    seg = L["seg"]
    step = TAU / seg
    raw = []
    for i in range(seg):
        th = i * step
        massif = ang_noise(th, 1.05, L["seed"] + 2.0, 3)
        crest = ang_noise(th, 4.4, L["seed"] + 4.0, 3, "ridged")
        spikes = ang_noise(th, 10.5, L["seed"] + 6.0, 2, "ridged")
        fine = ang_noise(th, 24.0, L["seed"] + 9.0, 2, "ridged")
        raw.append(0.60 * massif + 0.30 * crest + 0.08 * spikes + 0.02 * fine)
    srt = sorted(raw)
    lo = srt[int(0.03 * (seg - 1))]
    hi = srt[int(0.97 * (seg - 1))]
    span = max(hi - lo, 1e-4)
    hs = [(0.14 + 0.96 * min(1.0, max(0.0, (v - lo) / span)) ** 1.45) for v in raw]
    buckets = 48
    row = []
    for b in range(buckets):
        chunk = hs[b * seg // buckets:(b + 1) * seg // buckets]
        row.append(sum(chunk) / len(chunk))
    print("[profile]", L["name"], "min=%.2f max=%.2f" % (min(hs), max(hs)))
    print("  " + " ".join("%.2f" % v for v in row))


def build_range():
    clear_scene()
    rock = material("mtn_geo", (0.36, 0.40, 0.34), 0.95)
    parts = [ridge_band(L, rock) for L in LAYERS]
    for L in LAYERS:
        profile_stats(L)
    export_glb(os.path.join(OUT_DIR, "mountain_range.glb"), parts)
    render_preview(os.path.join(PREVIEW_DIR, "mtn_range.png"),
                   cam_pos=(0.0, -18.0, 34.0), target=(0.0, 300.0, 74.0), lens=42.0)
    # 诊断用：从外侧俯瞰整圈，检查地形拓扑（浏览器里看不到这个角度）
    render_preview(os.path.join(PREVIEW_DIR, "mtn_ring_oblique.png"),
                   cam_pos=(0.0, -980.0, 330.0), target=(0.0, 0.0, 30.0), lens=32.0)


# ──────────────────────────── landmark hills ────────────────────────────


def smoothstep(a, b, x):
    t = min(1.0, max(0.0, (x - a) / (b - a)))
    return t * t * (3.0 - 2.0 * t)


def smin(a, b, k):
    """Polynomial smooth minimum: a flat summit instead of a needle."""
    hh = max(k - abs(a - b), 0.0) / k
    return min(a, b) - hh * hh * k * 0.25


def hill(name, rx, ry, bumps, plateau, mat, seg=180, rings=34, seed=5.0,
         rough=2.6, rough_scale=0.022, base_z=-16.0,
         flank=(0.42, 0.90), groove_f=9.0, dip=7.5):
    def h_at(x, y):
        z = 0.0
        for bx, by, amp, sx, sy in bumps:
            z += amp * math.exp(-(((x - bx) ** 2) / (2.0 * sx * sx)
                                 + ((y - by) ** 2) / (2.0 * sy * sy)))
        # 噪声只在山体已经抬起来的地方生效，山脚要干净地沉进地面
        gate = min(1.0, max(0.0, z) / 8.0)
        n1 = vnoise(x * rough_scale, y * rough_scale, int(seed * 811)) - 0.5
        n2 = vnoise(x * rough_scale * 3.3, y * rough_scale * 3.3, int(seed * 811) + 29) - 0.5
        z += (n1 * 2.0 + n2 * 0.8) * rough * gate
        return smin(z, plateau, 7.0)

    verts = [(0.0, 0.0, h_at(0.0, 0.0))]
    for j in range(1, rings + 1):
        u = j / rings
        # 收边：从 flank[0] 起把高度往地下带，flank[1] 处归零。
        # 起收点收窄一点，坡脚才有"实体山"的坡度，而不是一摊摊开的饼
        taper = 1.0 - smoothstep(flank[0], flank[1], u)
        for i in range(seg):
            th = TAU * i / seg
            x = math.cos(th) * rx * u
            y = math.sin(th) * ry * u
            z = h_at(x, y) * taper + base_z * (1.0 - taper)
            # 冲沟 / 山嘴：低频决定哪条坡面被切开，高频把沟底再压细。
            # 只在坡面上生效，平顶（宫殿/塔落脚处）最后一段才淡出，否则坡面
            # 上半段全是光滑的"馒头皮"，近看没有体积
            top_gate = 1.0 - smoothstep(0.74 * plateau, 0.98 * plateau, z)
            groove = (1.0 - ang_noise(th, groove_f, seed + 4.0, 2, "ridged")) ** 2
            ribs = ang_noise(th, groove_f * 2.6, seed + 23.0, 2, "ridged")
            dip_amt = (groove + 0.45 * max(0.0, 0.62 - ribs)) * smoothstep(0.03, 0.45, u)
            z -= dip * dip_amt * taper * top_gate
            # 山嘴：沟与沟之间凸出来的窄脊，让坡面有明暗节奏
            z += (ribs - 0.55) * 0.22 * plateau * taper * top_gate
            verts.append((x, y, z))
    faces = [(0, 1 + i, 1 + (i + 1) % seg) for i in range(seg)]
    for j in range(1, rings):
        a0 = 1 + (j - 1) * seg
        b0 = 1 + j * seg
        for i in range(seg):
            i2 = (i + 1) % seg
            # 和中心扇面同一个绕序（逆时针俯视），法线朝上
            faces.append((a0 + i, b0 + i, b0 + i2, a0 + i2))
    return mesh_object(name, verts, faces, mat, smooth=True)


def build_hills():
    clear_scene()
    # 杭州：主峰 + 两个次峰，塔就立在主峰的平顶上
    green = material("hill_green", (0.30, 0.40, 0.28), 0.95)
    lake = hill(
        "lake_hill", 86.0, 78.0,
        [(0.0, 0.0, 36.0, 42.0, 36.0),
         (-56.0, 26.0, 16.0, 30.0, 24.0),
         (48.0, -18.0, 13.0, 26.0, 22.0),
         (-10.0, -40.0, 10.0, 28.0, 20.0)],
        33.0, green, seed=3.7, rings=46, rough=4.6, rough_scale=0.030,
        flank=(0.40, 0.88), groove_f=7.5, dip=6.5,
    )
    export_glb(os.path.join(OUT_DIR, "lake_hill.glb"), [lake])
    render_preview(os.path.join(PREVIEW_DIR, "lake_hill.png"),
                   cam_pos=(150.0, -190.0, 96.0), target=(0.0, 0.0, 16.0), lens=50.0)

    # 拉萨：沿 x 拉长的山脊，平顶正好托住布达拉宫（54m 宽）
    clear_scene()
    red = material("hill_red", (0.36, 0.22, 0.15), 0.96)
    marpo = hill(
        "red_hill", 132.0, 94.0,
        [(0.0, 0.0, 38.0, 58.0, 42.0),
         (-48.0, 4.0, 24.0, 40.0, 34.0),
         (52.0, -2.0, 25.0, 42.0, 34.0),
         (0.0, -22.0, 24.0, 50.0, 30.0)],
        30.0, red, seed=8.2, rings=50, rough=5.8, rough_scale=0.032,
        flank=(0.38, 0.86), groove_f=10.0, dip=8.5,
    )
    export_glb(os.path.join(OUT_DIR, "red_hill.glb"), [marpo])
    render_preview(os.path.join(PREVIEW_DIR, "red_hill.png"),
                   cam_pos=(200.0, -230.0, 110.0), target=(0.0, 0.0, 18.0), lens=50.0)


def main():
    build_range()
    build_hills()
    print("[mountains] previews -> /tmp/mtn_range.png /tmp/lake_hill.png /tmp/red_hill.png")


main()
