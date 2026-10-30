"""Build the Potala Palace (布达拉宫) for the /tree Lhasa scene.

The massing follows the *south elevation in the reference photo* instead of an
extruded symmetric plan:

  · 台基: one tall battered white wall (no terraces, no windows) standing on a
    wide "雪城" terrace that carries the street shops;
  · 白宫: the south face is a row of *butted* blocks at different heights — low
    west shoulder, rising centre, long low east wing — so the skyline steps
    up and down like the real building.  It is deliberately NOT a set of
    concentric shrinking tiers (that reads as a ziggurat);
  · 红宫: offset left of centre, with five gilded roofs of different heights;
  · 边玛墙: every wall top carries a dark-oxblood band with the thin white
    stripe underneath that the real building always shows;
  · the only "staircase" on the great white wall is the stepped diagonal ledge
    on the east end; the mirrored zig-zag flights do not exist on the south
    face and were removed.

Colours are matched to the photo (linear space): white ≈ #F0EDE4, red ≈ #A02F26,
band ≈ #5C221C, gold ≈ #D7A93F.

Origin is the centre of the palace base, so the model sits on y = 0 in three.js
(the scene hill swallows the lower few metres, which is how the real palace is
built into the red hill). Blender +Z is up; the glTF exporter converts to Y-up.

Geometry helpers live in bg_common.py, shared with pavilion.py / pagoda.py.
"""

import math
import os

import bpy
from mathutils import Matrix, Vector

try:
    HERE = os.path.dirname(os.path.abspath(__file__))
except NameError:  # Blender always sets __file__ for --python scripts
    # --exec 模式下没有 __file__，回退到仓库内的脚本目录（脚本唯一真源）
    HERE = os.path.expanduser("~/yumdeer.github.io/tools/blender")

exec(open(os.path.join(HERE, "bg_common.py")).read())

OUT_GLB = os.path.expanduser("~/yumdeer.github.io/public/models/potala_palace.glb")
PREVIEW_DIR = "/tmp"

TAU = math.tau
# ── 横向展开系数 ──────────────────────────────────────────────────────────
# 实景正面宽:高 ≈ 3.6:1（照片实测 950px : 260px），而模型只按立面高度建模时
# 只有 1.3:1。台基是"削山砌的"，墙顶必须接 PLAT_Y、墙脚必须接山脚，高度动不了，
# 只能把宽度拉出去。做法是在导出前统一把 x 坐标乘 XS（位置和尺寸一起），
# 只有窗/窗套这类 `panel()` 出来的小面板只移位不拉伸——0.6 宽的窄竖窗被拉宽
# 2.75 倍就变成一条横杠了。窗排的窗数按同一倍数加密（`win_row(dens=XS)`），
# 展开后窗间距才和原来一致。
# 所有体块共用同一个系数：红宫如果用另一个系数，它和白宫接缝处会裂开一道缝。
XS = 2.75
PANEL_OBJS = []    # 由 panel() 产生的小面板，横向展开时只移位不拉伸
BOX_FACES = [(3, 2, 1, 0), (4, 5, 6, 7), (0, 1, 5, 4), (1, 2, 6, 5), (2, 3, 7, 6), (3, 0, 4, 7)]


def lerp(a, b, t):
    return a + (b - a) * t


def clamp01(t):
    return 0.0 if t < 0.0 else 1.0 if t > 1.0 else t


def panel(name, size, center, mat, rot=None):
    """Box built around ``center`` with an optional local rotation (window on a
    battered wall, whose face is tilted)."""
    hx, hy, hz = (s * 0.5 for s in size)
    local = [
        (-hx, -hy, -hz), (hx, -hy, -hz), (hx, hy, -hz), (-hx, hy, -hz),
        (-hx, -hy, hz), (hx, -hy, hz), (hx, hy, hz), (-hx, hy, hz),
    ]
    if rot is not None:
        local = [rot @ Vector(v) for v in local]
    verts = [(v.x + center[0], v.y + center[1], v.z + center[2]) for v in local]
    ob = mesh_object(name, verts, BOX_FACES, mat)
    PANEL_OBJS.append(ob)
    return ob


def build_potala():
    # ── 材质：按参考照片取色（linear）──────────────────────────────────────
    # 场景里还有约三成雾（往 #88aacc 拉）、ACES 压饱和、天光偏蓝，
    # 但**先把模型自身的反照率做对**，再靠实测截图微调——不能靠"预先提亮"去
    # 硬顶，提亮到 >1 会被 ACES 压成死白，这正是之前白墙发灰发蓝的原因。
    # 目标 sRGB 值（照片实测）：
    #   白墙亮面 #EDEAE2、白墙暗面 #D2D0C8
    #   红宫 #A32A22（高光 #B8372A，阴影 #8C1F18）
    #   边玛墙 #5E2F26  金顶 #D9A63C  窗洞 #3A211B
    # 之前白墙给到 1.0/0.95/0.78 是过曝的（乘以光照后 >1，被 ACES 压成一片
    # 死白再被雾染蓝），所以现在按"线性反照率 ≈ 目标亮度"取值，不再靠提亮。
    white = material("pot_white", (0.975, 0.930, 0.750), 0.85)   # 暖白（#EDEAE2）
    # 第二档白：实景白墙不是一块整板，各段因年代/朝向不同有明显色差。
    # 所有块体都用同一档白时，正视图是一整片纯色，再多的几何错落也被"平"掉。
    white2 = material("pot_white_b", (0.900, 0.862, 0.695), 0.86)
    sill = material("pot_sill", (1.000, 0.975, 0.905), 0.88)
    red = material("pot_red", (0.360, 0.018, 0.010), 0.88)       # 硃红 #A32A22
    # 边玛墙：深赭红（实景 #5E2F26）。不能压太黑，否则远看是一条纯黑带
    band = material("pot_band", (0.095, 0.030, 0.017), 0.90)
    # 窗洞是深赭褐的阴影，不是纯黑——纯黑远看是"打印出来的方点"
    dark = material("pot_window", (0.030, 0.012, 0.010), 0.80)
    # 金顶：实景 #D9A63C。three.js 里换成 Lambert，金属度无效，颜色即最终色。
    gold = material("pot_gold", (0.980, 0.420, 0.010), 0.55)
    # 远景下"金顶=一坨金点"的根因是**没有明暗分层**：整套屋顶同色、同受光，
    # 远处只剩一个金色色块。所以拆成三档金：坡面用主金、脊线/宝顶用高光金、
    # 檐下压一条暗线，靠"亮线 + 暗线"把体量读出来。
    gold_hi = material("pot_gold_hi", (1.000, 0.680, 0.130), 0.35)
    gold_dk = material("pot_gold_dk", (0.560, 0.200, 0.006), 0.72)
    # 店铺灯箱/球灯用暗一档的金色，否则山脚一条亮黄灯带抢戏
    amber = material("pot_amber", (0.450, 0.200, 0.020), 0.85)
    bush = material("pot_bush", (0.100, 0.160, 0.075), 0.95)

    parts = []

    # ── helpers ───────────────────────────────────────────────────────────
    def slab(name, x0, x1, yf, yb, z0, z1, mat, bx=0.5, by=0.5):
        """Rectangular frustum with independent batter in x and y.

        Returns the block dict used by ``face()`` so windows/bands can be put
        exactly on the (tilted) wall plane.
        """
        verts = [
            (x0, yf, z0), (x1, yf, z0), (x1, yb, z0), (x0, yb, z0),
            (x0 + bx, yf + by, z1), (x1 - bx, yf + by, z1),
            (x1 - bx, yb - by, z1), (x0 + bx, yb - by, z1),
        ]
        parts.append(mesh_object(name, verts, BOX_FACES, mat))
        return dict(x0=x0, x1=x1, yf=yf, yb=yb, z0=z0, z1=z1, bx=bx, by=by)

    def face(blk, z):
        """Wall plane of a block at height z: (x0, x1, yf, yb)."""
        t = clamp01((z - blk["z0"]) / (blk["z1"] - blk["z0"]))
        return (blk["x0"] + blk["bx"] * t, blk["x1"] - blk["bx"] * t,
                blk["yf"] + blk["by"] * t, blk["yb"] - blk["by"] * t)

    def ring(name, blk, z0, z1, mat, grow, dz=0.0):
        """A band wrapping a block between z0 and z1, offset ``grow`` outwards."""
        ax0, ax1, ayf, ayb = face(blk, z0)
        bx0, bx1, byf, byb = face(blk, z1)
        verts = [
            (ax0 - grow, ayf - grow, z0), (ax1 + grow, ayf - grow, z0),
            (ax1 + grow, ayb + grow, z0), (ax0 - grow, ayb + grow, z0),
            (bx0 - grow, byf - grow, z1 + dz), (bx1 + grow, byf - grow, z1 + dz),
            (bx1 + grow, byb + grow, z1 + dz), (bx0 - grow, byb + grow, z1 + dz),
        ]
        parts.append(mesh_object(name, verts, BOX_FACES, mat))

    def manika(name, blk, grow=0.10, h=1.05, t=0.62):
        """边玛墙: a dark-oxblood **parapet ring** plus the white stripe under it.

        Must be four thin walls, not one solid slab: a slab's top face shows as
        a big brown roof from above, which is the single most "wrong" thing at
        this distance — the real band is only a thin dark line on the wall top,
        the roof behind it stays white.  ``t`` therefore has to stay well under
        the block width, otherwise the four top faces add back up into a roof.
        """
        bz = blk["z1"] - h
        zm = bz + h * 0.5
        x0, x1, yf, yb = face(blk, zm)
        mid_x = (x0 + x1) * 0.5
        mid_y = (yf + yb) * 0.5
        # 白玛草白线：整圈一道薄白台，压在深红带下面
        parts.append(box(f"{name}_stripe", (x1 - x0 + 2 * (grow + 0.08), yb - yf + 2 * (grow + 0.08), 0.26),
                         (mid_x, mid_y, bz - 0.13), sill))
        # 四道深红墙带（顶面不封，避免整片棕色）
        hh = h + 0.03
        zc = bz + hh * 0.5
        parts.append(box(f"{name}_front", (x1 - x0 + 2 * grow, t, hh),
                         (mid_x, yf - grow + t * 0.5, zc), band))
        parts.append(box(f"{name}_back", (x1 - x0 + 2 * grow, t, hh),
                         (mid_x, yb + grow - t * 0.5, zc), band))
        parts.append(box(f"{name}_left", (t, yb - yf, hh),
                         (x0 - grow + t * 0.5, mid_y, zc), band))
        parts.append(box(f"{name}_right", (t, yb - yf, hh),
                         (x1 + grow - t * 0.5, mid_y, zc), band))

    def win(blk, side, u, zc, w, h, name, sur=0.40):
        """One window: white plaster surround + black frame (sill is drawn as a
        continuous strip by ``win_row`` — that is what the photo shows)."""
        x0, x1, yf, yb = face(blk, zc)
        tilt = math.atan2(blk["by"], blk["z1"] - blk["z0"])
        if side == "front":
            rot = Matrix.Rotation(tilt, 3, "X")
            c = (u, yf, zc)
        elif side == "back":
            rot = Matrix.Rotation(math.pi - tilt, 3, "X")
            c = (u, yb, zc)
        elif side == "right":
            t2 = math.atan2(blk["bx"], blk["z1"] - blk["z0"])
            rot = Matrix.Rotation(-t2, 3, "Y") @ Matrix.Rotation(-math.pi / 2, 3, "Z")
            c = (x1, u, zc)
        else:
            t2 = math.atan2(blk["bx"], blk["z1"] - blk["z0"])
            rot = Matrix.Rotation(t2, 3, "Y") @ Matrix.Rotation(math.pi / 2, 3, "Z")
            c = (x0, u, zc)
        parts.append(panel(f"{name}_wrap", (w + sur, 0.22, h + sur * 0.65), c, sill, rot))
        parts.append(panel(f"{name}_frame", (w, 0.30, h), c, dark, rot))

    def win_row(blk, side, zc, u_from, u_to, step, w, h, tag, sur=0.40, sill_h=0.22,
                dens=None):
        """A dense row of windows plus the continuous white sill line.

        ``dens`` 是导出前横向展开的倍数：窗数必须按同一倍数加密，
        展开后窗间距才和原来一致，否则整排窗户会被摊稀。
        """
        d = XS if dens is None else dens
        n = max(1, int(round((u_to - u_from) / step * d)) + 1)
        step_eff = (u_to - u_from) / (n - 1) if n > 1 else step
        zs = zc - h * 0.5 - 0.20
        x0, x1, yf, yb = face(blk, zs)
        tilt = math.atan2(blk["by"], blk["z1"] - blk["z0"])
        if side == "front":
            rot = Matrix.Rotation(tilt, 3, "X")
            sc = ((u_from + u_to) * 0.5, yf, zs)
        elif side == "back":
            rot = Matrix.Rotation(math.pi - tilt, 3, "X")
            sc = ((u_from + u_to) * 0.5, yb, zs)
        else:
            t2 = math.atan2(blk["bx"], blk["z1"] - blk["z0"])
            rot = (Matrix.Rotation(-t2, 3, "Y") @ Matrix.Rotation(-math.pi / 2, 3, "Z")
                   if side == "right" else
                   Matrix.Rotation(t2, 3, "Y") @ Matrix.Rotation(math.pi / 2, 3, "Z"))
            sc = ((x1 if side == "right" else x0), (u_from + u_to) * 0.5, zs)
        parts.append(panel(f"{tag}_{round(zc, 2)}_sill", (u_to - u_from + 0.9, 0.30, sill_h),
                           sc, sill, rot))
        for i in range(n):
            u = u_from + i * step_eff
            if u > u_to + 1e-6:
                break
            win(blk, side, u, zc, w, h, f"{tag}_{round(zc, 2)}_{i}", sur=sur)

    def gold_roof(name, cx, cy, w, d, z_eave, z_apex, body=None):
        # 实景金顶是四坡的"歇山"矮顶：坡度平缓、四角只微微起翘。
        # 之前 lift=0.36 + curve=2.3 把四个角拉成了"犄角"，远看像一顶小帐篷帽。
        # 实景金顶不是尖锥，是"平顶歇山"：顶上有一条短正脊，四坡缓，四角微微起翘。
        # r_in 给到 1.45 才有那条**看得见的平脊**（顶面宽度约占屋顶宽 2/5）：
        # 给 1.15 时顶面只有 1/3 宽，远景里金顶就缩成一个金色三角。
        base = roof_sampler(1.45, z_apex, 3.394, z_eave,
                            curve=1.60, lift=0.16, linear=0.50, seg=4)
        sx, sy = (w * 0.5) / 3.394, (d * 0.5) / 3.394

        def sample(theta, s):
            p = base(theta + math.pi / 4, s)
            return Vector((p.x * sx + cx, p.y * sy + cy, p.z))

        parts.append(build_roof(name, sample, body or gold, thickness=0.12, nt=64, nr=10))
        # 四条戗脊 + 顶上的正脊：远景里金顶的"棱"全靠这几条亮线读出来，
        # 全用同一档金色时它们会被坡面吞掉，必须用高光金。
        for k in range(4):
            th = math.pi / 4 + k * math.pi / 2
            parts.append(tube(f"{name}_hip_{k}",
                              [sample(th, 0.02 + 0.94 * j / 12) for j in range(13)],
                              gold_hi, 0.15, ring=6, closed_ends=True))
        rx = 1.45 * sx
        parts.append(tube(f"{name}_ridge", [
            Vector((cx - rx * 0.98, cy, z_apex + 0.01)),
            Vector((cx, cy, z_apex + 0.08)),
            Vector((cx + rx * 0.98, cy, z_apex + 0.01)),
        ], gold_hi, 0.15, ring=6, closed_ends=True))
        parts.append(eave_band(f"{name}_fascia", sample, gold, depth=0.13, inset=0.03, nt=84))
        # 檐下暗线：金顶与下方白/红墙之间那条阴影。缺了它，远景就只剩一坨金色靠
        # 轮廓发亮，有了它才有"檐口压在墙上"的层次。
        parts.append(eave_band(f"{name}_shadow",
                               lambda t, s: sample(t, s) - Vector((0.0, 0.0, 0.15)),
                               band, depth=0.22, inset=-0.01, nt=84))
        parts.append(sphere(f"{name}_bead", (cx, cy, z_apex + 0.22), 0.15, gold_hi,
                            rings=8, seg=12))

    def ledge(name, x0, x1, ztop, protrude=0.55, thick=0.46, cap_ext=0.0, lip=band):
        """大白墙上那道斜梯的一级踏步。

        必须"贴"在墙面上：之前 protrude=1.3 / thick=2.1 做出来是一串悬空的
        棕色方块，远景看就是几块飘着的碎块。现在只向外探 0.55，踏步本身用
        白色，只有外沿一道细深色收边，一级级连起来才是实景那条连续斜线。

        西端那道水平台沿在照片里只是一条**白色**浅台（靠自身阴影分界），
        用深色收边会在大白墙上横出一道刺眼的黑杠，所以 ``lip`` 可覆盖。
        """
        _, _, yf, _ = face(wall, ztop)
        parts.append(box(f"{name}_tread", (x1 - x0 + 2 * cap_ext, protrude + 1.00, thick),
                         ((x0 + x1) * 0.5, yf - protrude * 0.5 + 0.50, ztop - thick * 0.5), white))
        parts.append(box(f"{name}_lip", (x1 - x0 + 2 * cap_ext, 0.32, 0.46),
                         ((x0 + x1) * 0.5, yf - protrude - 0.02, ztop - 0.23), lip))

    # ── 台基：雪城宽台 + 一整面收分白墙（尺寸与 tree.astro 的 apron 对齐）──
    # bx 只是左右收分：保持小值，侧立面才不会像个金字塔。
    # by 是前后收分，和 apron() 那条斜线严格绑定，不能动。
    terra = slab("pot_terrace", -37.5, 37.5, -21.5, 21.5, -32.0, -25.6, white,
                 bx=1.4, by=0.9)
    wall = slab("pot_wall", -34.2, 34.2, -16.0, 16.0, -25.6, 0.0, white,
                bx=2.2, by=3.1)
    # 主墙埋进山体的裙墙：墙脚不能露出悬空的底边
    slab("pot_skirt", -37.9, 37.9, -21.9, 21.9, -40.0, -32.0, white, bx=0.4, by=0.4)
    # 雪城台沿压顶
    ring("pot_terrace_cap", terra, -25.95, -25.6, sill, 0.55, dz=0.02)
    # 大白墙顶**不是**一条贯穿全宽的深色横线：实景那里是一排高低、进深、檐口
    # 都不一致的小白房子（僧舍/办事房），贴着白宫脚下站成一排；每栋自带一道
    # 窄边玛檐，所以那条深色线是**一段段错开的短线**。
    # 之前用 5 段 ring_seg 拼"分段边玛带"，段顶只差两三厘米，远景仍然连成一条
    # 尺子画的线——用户明确纠正过："这一个棕色线对齐的不对，实际场景就是小房子
    # 不是对齐的"。所以这里不是把带子分段，而是直接换成房子。
    hx = -31.6
    i = 0
    while hx < 31.6:
        hw = 2.05 + (0.00, 0.52, -0.18, 0.34, -0.30, 0.14)[i % 6]
        # 高差要够大（2.85~4.9）才看得出"小房子"，只差一两档时远景仍是一条带
        hh = 2.85 + (0.00, 1.35, 0.55, 2.05, 0.22, 0.95, 1.65, 0.72)[i % 8]
        hd = 2.55 + (0.00, 0.34, 0.62, 0.18)[i % 4]
        hyf = -13.10 + (0.00, 0.22, -0.16, 0.30, -0.24)[i % 5]
        blk = slab(f"pot_wh_{i}", hx, hx + hw, hyf, hyf + hd, 0.0, hh,
                   white if i % 3 else white2, bx=0.05, by=0.05)
        manika(f"pot_wh_{i}_manika", blk, grow=0.05 + 0.012 * (i % 3),
               h=0.42 + 0.05 * (i % 3), t=0.30)
        # 有一部分房不开窗（仓库/封闭僧舍）：一排等距等大的窗比空着还假
        if i % 4 != 2:
            win_row(blk, "front", hh - 1.02 - 0.07 * (i % 3),
                    hx + 0.42, hx + hw - 0.42, 0.92 + 0.05 * (i % 3),
                    0.34, 0.48, f"pot_wh_{i}", sur=0.13, sill_h=0.13)
        hx += hw + 0.16 + 0.14 * ((i * 3) % 3)
        i += 1

    # ── 东端连续斜降的挡墙（实景白墙最醒目的一条斜线）────────────────────
    # 之前做成 9 级独立踏步，每级宽 2.6、间距 2.35：竖向间距远大于踏步厚度，
    # 远看是一串**悬空的深色短横线**，既不像楼梯也不像挡墙，是截图里最假的一处。
    # 夜场照片显示它是**一整条连续斜降的白挡墙，顶上一条深色压边**，
    # 所以改成沿墙面斜线扫出来的一整条带子，只有顶部有一道细深色沿。
    def diag_band(name, x0, x1, z0, z1, h, out, thick, mat):
        """在大白墙的前立面上，沿一条斜线扫出的连续挡墙。

        墙面是收分的（yf 随 z 变化），所以两端的 y 必须各自按 ``wall`` 的
        收分求，不能用同一个 y——否则一端会陷进墙里、另一端悬空。
        """
        def wyf(z):
            return wall["yf"] + wall["by"] * (z - wall["z0"]) / (wall["z1"] - wall["z0"])
        ya, yb = wyf(z0) - out, wyf(z1) - out
        parts.append(mesh_object(name, [
            (x0, ya, z0), (x1, yb, z1), (x1, yb + thick, z1), (x0, ya + thick, z0),
            (x0, ya, z0 + h), (x1, yb, z1 + h), (x1, yb + thick, z1 + h), (x0, ya + thick, z0 + h),
        ], BOX_FACES, mat))

    # 两条斜梯都是**往两边升**（中央最低、外侧最高），合起来是个"V"，中间留出租界：
    # 实景里正中间是两段斜梯的最低点，那里并排着一簇房子（黄顶），梯子从房子两侧
    # 往东西两端爬上去。做成"Λ"（往中间升）方向就是反的。
    # 两条斜挡墙**东西并不对称**：实景里西段更短更陡、东段更长更缓，最低点也不在正中。
    # 之前把两侧做成严格镜像（x ±12..±30.4、z 完全相同），正视图左右完全对称，
    # 是"太整齐"观感的一大来源。
    diag_band("pot_diag_ramp", 11.8, 30.0, -19.90, -6.20, 2.45, 0.86, 1.65, white2)
    diag_band("pot_diag_ramp_lip", 11.8, 30.0, -17.60, -3.90, 1.00, 1.00, 0.90, band)
    diag_band("pot_diag_ramp_w", -29.0, -12.4, -9.40, -21.30, 2.30, 0.82, 1.55, white)
    diag_band("pot_diag_ramp_w_lip", -29.0, -12.4, -7.24, -19.14, 0.95, 0.96, 0.86, band)
    # 大白墙上的小盲窗阵列：整面台基如果一点窗洞都没有，远看就是一张白纸，
    # 梯子和房子再多也压不住那片空白。实景台基中段确实有一片片通风/盲窗。
    # 横向展开后墙宽变成 2.75 倍，盲窗必须铺满到 ±33（展开后 ≈ ±90），
    # 步长也要先除以 XS，否则展开后是一片稀稀拉拉的方点。
    for zi, zc in enumerate((-9.6, -6.2)):
        u = -33.0
        while u <= 33.0:
            win(wall, "front", u, zc, 0.52, 0.72,
                f"pot_wall_blind_{zi}_{round(u, 1)}", sur=0.12)
            u += 2.75 / XS
    # 西端只有一道水平矮台沿，和东侧的斜梯刻意不对称。
    # 收边用白色：照片里这条台沿靠自身阴影分界，没有深色描边。
    ledge("pot_west_ledge", -31.0, -13.5, -7.8, protrude=0.55, thick=0.50, lip=sill)

    # ── 雪城（大白墙脚下那一整排低矮白房）───────────────────────────────
    # 实景里大白墙前面不是光板，而是一整条有窗、有屋顶的低白房，把整面白墙的
    # 下段挡住，高度也错落。没有它，台基就是一块巨大的白板，比例显得又高又空。
    # 前排 y=-20.3 是临街店铺，雪城的白房必须缩到 y=-18.3 之后，
    # 否则两者会互相穿插（店铺背板在 -18.7）。
    shol = [
        ("pot_sh_l0", -36.0, -31.0, -18.4, -12.0, -16.6),
        ("pot_sh_l1", -31.2, -26.0, -18.2, -12.0, -18.4),
        ("pot_sh_l2", -26.2, -21.0, -18.5, -12.0, -19.8),
        ("pot_sh_m0", -21.2, -15.6, -18.3, -12.0, -18.9),
        ("pot_sh_m1", -15.8, -10.4, -18.5, -12.0, -20.2),
        ("pot_sh_m2", -10.6,  -5.0, -18.2, -12.0, -19.4),
        ("pot_sh_m3",  -5.2,   0.8, -18.5, -12.0, -20.6),
        ("pot_sh_m4",   0.6,   6.2, -18.3, -12.0, -19.0),
        ("pot_sh_m5",   6.0,  11.4, -18.5, -12.0, -20.3),
        ("pot_sh_m6",  11.2,  17.0, -18.2, -12.0, -19.2),
        ("pot_sh_m7",  16.8,  22.4, -18.5, -12.0, -20.0),
        ("pot_sh_r0",  22.6,  27.6, -18.3, -12.0, -19.6),
        ("pot_sh_r1",  27.8,  31.6, -18.2, -12.0, -21.4),
        ("pot_sh_r2",  31.8,  35.4, -18.5, -12.0, -22.6),
    ]
    for i, (nm, x0, x1, yf, yb, ztop) in enumerate(shol):
        blk = slab(nm, x0, x1, yf, yb, -25.6, ztop, white if i % 3 else white2,
                   bx=0.34, by=0.30)
        # 檐口高度、外挑、窗排高度、窗距都逐栋微抖动：14 栋房如果带子一样高、
        # 窗一样密，远看就是一条机器压出来的白色长条。
        manika(f"{nm}_manika", blk, grow=0.07 + 0.01 * (i % 2), h=0.56 + 0.04 * (i % 3), t=0.45)
        win_row(blk, "front", ztop - 1.72 - 0.13 * (i % 4),
                x0 + 0.85, x1 - 0.85, 1.22 + 0.09 * (i % 3), 0.52, 0.66, nm)

    # ── 大白墙中央那一簇房子（黄顶）：两条斜梯的最低点之间 ────────────────
    # 实景正面：两段斜梯在正中汇到最低，汇合处并排立着几栋带黄琉璃檐的矮楼，
    # 梯子从它们两侧往东西爬上去。缺了这簇房子，中间就只剩两条光秃秃的斜线。
    for i, (nm, x0, x1, yf, ztop) in enumerate((
            ("pot_mid_a", -10.6, -4.4, -18.75, -17.20),
            ("pot_mid_b", -3.9, 2.20, -18.45, -14.60),
            ("pot_mid_c", 3.10, 8.60, -18.85, -16.10))):
        # 三栋的宽度、间距、墙顶标高、前脸位置全不一样，屋顶一档黄一档暗金：
        # 排成等高等距的一列时，中央那一簇看起来像新建的售楼处。
        blk = slab(nm, x0, x1, yf, -13.2, -25.6, ztop,
                   white2 if i == 1 else white, bx=0.28, by=0.26)
        manika(f"{nm}_manika", blk, grow=0.06 + 0.01 * (i % 2),
               h=0.52 + 0.05 * (i % 2), t=0.42)
        parts.append(box(f"{nm}_roof", (x1 - x0 - 0.4 - 0.15 * (i % 2), 4.4, 0.32),
                         ((x0 + x1) * 0.5, yf + 2.55, ztop + 0.28),
                         amber if i % 2 == 0 else gold_dk))
        win_row(blk, "front", ztop - 1.62 - 0.10 * (i % 2), x0 + 0.7, x1 - 0.7,
                1.10 + 0.07 * (i % 3), 0.48, 0.62, nm)

    # ── 白宫主体：左右完全不同的跌落 ─────────────────────────────────────
    # 按参考照片量：红宫偏左，「紧邻红宫的那两块白墙」都接近红宫肩部（约 88%），
    # 西侧三级快速跌落、很快就收住；东翼则是一条**墙顶随山势一路斜降的长墙**
    # （照片里那条连续的斜檐口），所以天空线是「西陡东长」，绝不是镜像对称。
    #        name        x0      x1     yf      yb    ztop  退台级数
    # 前脸刻意**前后错开**：只有 ztop 错落、前脸共面时，正视图就是一整张白纸片
    # （所有面法向相同、受光相同，只剩轮廓差异）。
    # 而且每块**本身是逐级退台的**（越往上越窄越浅）：实景白宫是层层收进去砌的，
    # 一层的收进量在正视图上就是一道横向阴影带。做成一根直上直下的方柱时，
    # 四块并排就是四个白盒子，再多窗也压不住那股积木感。
    facade = [
        # 西端：两级退台，最西端只有红宫肩部的六成
        ("pot_w_a", -34.4, -26.6, -12.20, 11.30, 15.4, 2),
        ("pot_w_b", -26.8, -19.4, -11.35, 11.45, 19.8, 3),
        ("pot_w_c", -19.6,  -8.0, -12.45, 11.55, 23.4, 3),
        # x -8..8 是红宫的槽位：红宫自己从白墙顶一路砌到 26.0
        ("pot_w_e",   8.0, 12.6, -12.55, 11.65, 22.9, 3),
    ]
    # 每级的层高占比：越往上越矮，正视图上才是"底下两层厚重、顶上收分"
    TIER_SHARE = {2: (0.56, 0.44), 3: (0.40, 0.34, 0.26)}
    blocks = {}          # 每块的最顶层（窗、屋顶小体块都挂在这一层）
    tier_blocks = {}     # 每块的全部层级
    for i, (nm, x0, x1, yf, yb, zt, nt) in enumerate(facade):
        # 每块的收进量各不相同，退台才不会是"同一级台阶复制四遍"；
        # 同时按块宽/进深设上限，窄块（贴红宫两侧只有 5~7 宽）收两次就收没了
        iw, idp = x1 - x0, yb - yf
        ix = min(0.95 + 0.22 * (i % 2), iw * 0.14)
        iy = min(1.05 + 0.24 * ((i + 1) % 2), idp * 0.05)
        shares = TIER_SHARE[nt]
        cx0, cx1, cyf, cyb, z0 = x0, x1, yf, yb, 0.0
        for k, sh in enumerate(shares):
            z1 = zt if k == len(shares) - 1 else z0 + zt * sh
            # 相邻级交替两档白、边玛带高度也差几厘米：实景各层白墙是历年分别
            # 重刷的，色差和檐口高差都很明显，统一成一个色号就"平"了。
            blk = slab(f"{nm}_t{k}", cx0, cx1, cyf, cyb, z0, z1,
                       white if (i + k) % 2 == 0 else white2, bx=0.42, by=0.34)
            manika(f"{nm}_t{k}_manika", blk, grow=0.09 + 0.015 * ((i + k) % 3),
                   h=0.94 + 0.06 * ((i + k) % 3), t=0.60)
            tier_blocks.setdefault(nm, []).append(blk)
            blocks[nm] = blk
            if k < len(shares) - 1:
                # 收缩到上一级台面以内：正好压在台沿上时两面近乎相切，远处会闪
                sx = ix * (1.0 + 0.18 * k)
                sy = iy * (1.0 + 0.18 * k)
                # 紧贴红宫槽位的那条边不能收，收进去会插进红宫体块（穿模）
                if i != 3:      # pot_w_e 的左边（x0）贴着红宫
                    cx0 += sx
                if i != 2:      # pot_w_c 的右边（x1）贴着红宫
                    cx1 -= sx
                cyf += sy
                cyb -= sy
            z0 = z1

    # ── 白宫屋顶上的小体块（凸窗/小经堂）──────────────────────────────────
    # 实景宫顶边缘从来不是一条光滑直边，而是一簇高低、深浅都不一样的盒子；
    # 缺了它们，天空线就只是一排平顶方块，是"太平整"最直接的一处。
    for i, item in enumerate(facade):
        nm = item[0]
        blk = blocks[nm]          # 最顶层：小体块压在收分后的屋顶上
        zt = blk["z1"]
        x0f, x1f, yff, _ = face(blk, zt)
        span_x = x1f - x0f
        for j in range(3):
            cw = 1.85 + 0.45 * ((i + 2 * j) % 3)
            ch = 0.72 + 0.45 * ((i + j) % 3)
            cd = 2.10 + 0.45 * (j % 2)
            ccx = x0f + span_x * (0.17 + 0.29 * j) + 0.22 * ((i + j) % 3 - 1)
            parts.append(box(f"pot_w_{i}_cap_{j}", (cw, cd, ch),
                             (ccx, yff + cd * 0.5 + 0.35, zt + ch * 0.5),
                             white2 if (i + j) % 2 else white))

    # ── 东翼：一条"坡顶"长墙 ──────────────────────────────────────────────
    # 实景东翼不是几块平顶盒子，而是墙顶**随山势连续斜降**：檐口是一条长斜线，
    # 窗户跟着斜线一开间一扇排下去。之前做成三块平顶，远看是三级台阶，
    # 没有照片里那股"一路滑下去"的动势，也是"镜像/积木感"的主要来源之一。
    ew_x0, ew_x1 = 12.4, 35.0
    # 落差按照片：西端只比红宫略低，一路滑到东端只剩约 45% 高度。
    # 之前 17.55→13.85（只降 3.7）在正立面上几乎是一条平线，整段东翼又变回
    # 一整块大白板；实景那条斜檐口要陡得多，降 6 米才看得出"一路滑下去"。
    ew_zt0, ew_zt1 = 17.80, 11.80           # 墙顶在东西两端的标高
    ew_yf0, ew_yf1 = -12.35, -12.00
    ew_yb0, ew_yb1 = 11.55, 11.20
    ew_bx, ew_by = 0.55, 0.42

    def ew_top(x):
        return lerp(ew_zt0, ew_zt1, (x - ew_x0) / (ew_x1 - ew_x0))

    parts.append(mesh_object("pot_w_east", [
        (ew_x0, ew_yf0, 0.0), (ew_x1, ew_yf1, 0.0),
        (ew_x1, ew_yb1, 0.0), (ew_x0, ew_yb0, 0.0),
        (ew_x0 + ew_bx, ew_yf0 + ew_by, ew_zt0),
        (ew_x1 - ew_bx, ew_yf1 + ew_by, ew_zt1),
        (ew_x1 - ew_bx, ew_yb1 - ew_by, ew_zt1),
        (ew_x0 + ew_bx, ew_yb0 - ew_by, ew_zt0),
    ], BOX_FACES, white))

    # 斜边玛带 + 白玛草白线：跟着坡度一起斜下去，这才是实景那条连续斜线。
    # 直接用"沿坡向量 + 坡面法向"显式算 8 个角点，不依赖旋转矩阵的符号约定
    # （之前用 Matrix.Rotation(…, 'Y') 两次都把带子转成向上翘，肉眼可见地飞离墙顶）。
    ew_ang = math.atan2(ew_zt1 - ew_zt0, ew_x1 - ew_x0)
    ew_len = math.hypot(ew_x1 - ew_x0, ew_zt1 - ew_zt0)
    ew_cz = (ew_zt0 + ew_zt1) * 0.5
    ew_cx = (ew_x0 + ew_x1) * 0.5
    ew_yf = (ew_yf0 + ew_yf1) * 0.5 + ew_by
    ew_yb = (ew_yb0 + ew_yb1) * 0.5 - ew_by
    ew_u = Vector((math.cos(ew_ang), 0.0, math.sin(ew_ang)))      # 沿墙顶线，东端更低
    ew_n = Vector((-math.sin(ew_ang), 0.0, math.cos(ew_ang)))     # 垂直于斜线、朝上

    def ew_band(name, mat, height, thick, cy, cz, grow=0.10):
        hl = ew_len * 0.5 + grow
        c = Vector((ew_cx, cy, cz))
        vs = []
        for sn in (-1, 1):
            for sy in (-1, 1):
                for su in (-1, 1):
                    p = (c + ew_u * (hl * su)
                         + Vector((0.0, thick * 0.5 * sy, 0.0))
                         + ew_n * (height * 0.5 * sn))
                    vs.append((p.x, p.y, p.z))
        parts.append(mesh_object(name, vs, BOX_FACES, mat))

    ew_band("pot_w_east_stripe", sill, 0.26, 0.86, ew_yf - 0.20, ew_cz - 0.16, grow=0.12)
    ew_band("pot_w_east_band", band, 1.05, 0.62, ew_yf - 0.10 + 0.31, ew_cz + 0.50)
    ew_band("pot_w_east_band_b", band, 1.05, 0.62, ew_yb + 0.10 - 0.31, ew_cz + 0.50)

    # 东翼窗阵：一开间一扇，跟着斜檐口一起往下排（照片里就是这样一路排下去）
    # 横向展开后东翼长了 2.75 倍，开间数必须同比增加，否则一串稀疏的大方窗
    ew_cols = int(round(12 * XS))
    for i in range(ew_cols + 1):
        u = ew_x0 + 1.1 + i * (ew_x1 - ew_x0 - 2.2) / ew_cols
        zt = ew_top(u)
        t = (u - ew_x0) / (ew_x1 - ew_x0)
        tilt = math.atan2(ew_by, zt)
        rot = Matrix.Rotation(tilt, 3, "X")
        for k in range(2):
            zc = zt - 2.10 - k * 2.15
            if zc < 1.8:
                continue
            yf = lerp(ew_yf0, ew_yf1, t) + ew_by * (zc / zt)
            parts.append(panel(f"pot_we_w{i}_{k}", (0.92, 0.22, 1.00), (u, yf, zc), sill, rot))
            parts.append(panel(f"pot_we_f{i}_{k}", (0.52, 0.30, 0.74), (u, yf, zc), dark, rot))

    # ── 西端角楼：照片最西端是一座圆角收分角楼，不是方盒子 ──────────────────
    # 必须探出白宫西/南两个面才看得见：放在块体内部会被整块白墙吞掉。
    parts.append(prism("pot_bastion_w", 3.70, 0.0, 16.6, white,
                       segments=28, center=(-33.2, -10.6), radius_top=3.00))
    parts.append(prism("pot_bastion_w_stripe", 3.50, 15.30, 15.58, sill,
                       segments=28, center=(-33.2, -10.6), radius_top=3.44))
    parts.append(prism("pot_bastion_w_band", 3.46, 15.58, 16.66, band,
                       segments=28, center=(-33.2, -10.6), radius_top=3.30))
    # 东端同样是一座圆角角楼（夜场照片最右侧那个圆弧转角），高度跟着东翼坡度收住，
    # 否则东翼在 x=35 处是一刀切平的直角，正面看像被裁掉一块。
    parts.append(prism("pot_bastion_e", 3.35, 0.0, 11.95, white,
                       segments=24, center=(34.2, -10.7), radius_top=2.70))
    parts.append(prism("pot_bastion_e_stripe", 3.14, 10.67, 10.93, sill,
                       segments=24, center=(34.2, -10.7), radius_top=3.08))
    parts.append(prism("pot_bastion_e_band", 3.10, 10.93, 11.99, band,
                       segments=24, center=(34.2, -10.7), radius_top=2.96))

    # 窗阵：实景的窗只集中在**每级墙顶那一带**，墙面下半截是大片空白。
    # 之前从墙脚一路铺到墙顶，远看就是公寓楼的网格——这是最"假"的一处。
    # 退台之后每级都要有自己的窗排（否则收进的那几层是光板，退台反而显得生硬）。
    facade_wins = {
        "pot_w_a": 1.25,
        "pot_w_b": 1.25,
        "pot_w_c": 1.25,
        "pot_w_e": 1.25,
    }
    for i, (nm, step) in enumerate(facade_wins.items()):
        for k, blk in enumerate(tier_blocks[nm]):
            zt = blk["z1"]
            # 每级第一排窗的起始高度、排距都错开：各块各层用同一组标高时，
            # 窗排会在交界处连成一条贯穿全宽的水平线，白宫又变回一张网格纸。
            z0f = zt - 2.15 - (0.0, 0.38, 0.16, 0.50)[(i + k) % 4]
            for r in range(2):
                zc = z0f - r * (2.05 + 0.10 * ((i + k) % 3))
                if zc < blk["z0"] + 1.6:
                    break
                fx0, fx1, _, _ = face(blk, zc)
                win_row(blk, "front", zc, fx0 + 0.75, fx1 - 0.75, step,
                        0.60, 0.80, f"{nm}_t{k}_{round(zc, 1)}")

    # ── 红宫：正中一座**又高又窄**的红色主体 ──────────────────────────────
    # 横向展开 2.75 倍后，如果红宫跟主体一起被拉宽，它就变成长宽比 4:1 的红扁条，
    # 而实景红宫是 220:145 ≈ 1.5:1 的**竖块**。所以在建模坐标里先把它的宽度
    # 收窄到 16（展开后 44 ≈ 全宽 195 的 23%，和实景一致），高度给足 0..26，
    # 让它是整组建筑最高的那一段——白宫东西两翼都比它矮，才有实景那个
    # "中间一座红的立着、两侧白的层层跌下去"的天际线。
    # 前脸要**退到白墙墙顶立面之后**（y=-12.0 对白墙顶 y=-12.9）：实景红宫是
    # 坐在白墙后面那道台上的，不是压在白墙外皮上；底边埋到 -0.5 是为了避开
    # 与白墙顶面共面（共面会在远处闪）。
    # 左右各多出 0.4 插进白宫体块：接缝处共面会在远处闪，宁可让它互相插一点
    red_pal = slab("pot_red_pal", -8.4, 8.4, -12.00, 10.8, -0.5, 26.0, red, 0.90, 0.45)
    manika("pot_red_manika", red_pal, grow=0.18, h=1.10, t=0.58)
    # 红宫窗阵：实景是一整片**密网格**（十几排 × 二十几列小白窗）铺满立面，
    # 只有最底下一窄条留白。窗框**必须收窄**：白窗套用 0.40 时连成一片白网格，
    # 红墙整个被吃掉，远看是"白底红边"的方格楼。
    for zc in (24.2, 22.2, 20.2, 18.2, 16.2, 14.2, 12.2, 10.2, 8.2):
        win_row(red_pal, "front", zc, -7.2, 7.2, 1.10, 0.46, 0.68,
                f"rp{round(zc, 1)}", sur=0.10, sill_h=0.08)
    # 东侧立面同样只保留顶部两排
    for zc in (23.6, 21.4):
        for i, u in enumerate((-11.4, -8.8, -6.2, -3.6, -1.0, 1.6, 4.2, 6.8)):
            win(red_pal, "right", u, zc, 0.46, 0.70, f"rpr{round(zc, 1)}_{i}")

    # ── 竖向金色窗带：红宫正面最抓眼的一条暖色竖带 ──────────────────────
    # 照片里中右侧有一列金色窗从墙顶垂到约三分之一高；之前做成三片悬空的
    # 黄布，远看像贴了三条黄胶带。改成贴在墙面上、逐层收分的一列金色窗洞。
    zz = 4.4
    while zz < 24.4:
        _, _, gyf, _ = face(red_pal, zz)
        tilt = math.atan2(red_pal["by"], red_pal["z1"] - red_pal["z0"])
        rot = Matrix.Rotation(tilt, 3, "X")
        parts.append(panel(f"pot_gbay_{round(zz, 1)}", (1.55, 0.24, 1.30),
                           (2.6, gyf, zz), gold, rot))
        zz += 1.45

    # ── 金顶：红宫顶一排三个 + 两侧白宫肩部各一个 + 东翼端头一个（高低不一）──
    # 实景金顶是宽而矮的平顶歇山，宽度接近一个开间（≈6m），高度约红宫的 1/8。
    # 之前 w=4 左右、apex 又高，远看是几个米粒大的小尖帽。
    # 关键：金顶必须**压在红宫前檐口**上（照片里它就是探出南墙的），
    # cy 给到 -1.2 是推到宫殿纵深中部，从低机位看整排金顶都被红墙挡住，
    # 只剩顶上一丝金线——这是之前"看不到金顶"的真正原因。
    # 数量按照片：红宫顶上一排 4 座高低不一的金顶（原来 3 座挤成一条金带）。
    # 高度也必须压下来：实景金顶是"矮而宽"的平顶歇山，屋脊只比檐口高 1/3 个开间；
    # 之前 apex 给到 29.5（比檐口高 3.5m）做出来是四顶尖帐篷帽。
    # 檐口必须**高过边玛墙顶**（红宫 26.0 + 边玛 1.05）：原来 eave 正好给 26.0，
    # 整个檐口埋在深色墙带里，远景只剩一个金色三角尖，看不出"金顶是压在屋顶上的"。
    # 数量按照片：实景红宫顶上是**一排 7 座**、高度几乎一致的金顶，横向连成一条
    # 金色屋檐线（之前 4 座、高低差 0.45，远看是几个互不相连的金点）。
    # 红宫顶这一排的金顶宽度也要按"没被拉宽"的绝对尺寸给：展开 2.75 倍后
    # 3.55 宽会变成 9.8 宽，7 座之间中心距只有 6，整排会互相插成一坨金块。
    # 给 2.2（展开后 6.05）刚好让 7 座首尾相接，连成实景那条金色屋檐线。
    for i, (cx, cy, gw, apx) in enumerate((
            (-6.60, -10.10, 2.18, 28.30),
            (-4.40, -9.90, 2.26, 28.52),
            (-2.20, -10.15, 2.12, 28.28),
            (0.00, -9.85, 2.24, 28.46),
            (2.20, -10.10, 2.15, 28.26),
            (4.40, -9.90, 2.28, 28.55),
            (6.60, -10.15, 2.10, 28.32))):
        gold_roof(f"pot_gold_c{i}", cx, cy, gw, 7.2, 26.45, apx,
                  body=gold if i % 2 == 0 else gold_dk)
    gold_roof("pot_gold_wc", -15.5, -9.9, 1.95, 6.8, 23.85, 25.90)
    gold_roof("pot_gold_we", 9.3, -9.9, 1.90, 6.6, 23.35, 25.40, body=gold_dk)
    gold_roof("pot_gold_er", 32.6, -9.7, 1.60, 5.4, 12.25, 13.55)

    # ── 台脚植被：白墙根部、雪城墙头外沿的灌木 ──────────────────────────
    span = 70.0
    n = 13
    for k in range(n):
        if (k * 5 + 3) % 4 == 0:
            continue
        bx = -span * 0.5 + (k + 0.5) * span / n + 0.7 * ((k % 3) - 1)
        r = 0.46 + 0.20 * ((k * 3) % 3)
        parts.append(sphere(f"pot_bush_foot_{k}", (bx, -21.4, -25.6 + r * 0.55),
                            r, bush, rings=5, seg=7))

    # ── 最底层临街店铺：雪城沿街的一排门脸（暖色灯箱招牌）────────────────
    shop_hy, shop_z = 20.4, -25.6
    # 横向展开 2.75 倍后，12 间会被拉成 12 间超宽门脸；间数同比增加才是老街
    n_shop, span, d = int(round(12 * XS)), 56.0, 1.6
    for i in range(n_shop):
        # 面宽/高度/进深位置都错开一点，否则一排一模一样，远看像一条白条子
        h = 3.55 + (0.0, 0.45, 0.20, 0.62)[i % 4]
        cx = -span / 2 + (i + 0.5) * span / n_shop + (0.0, 0.24, -0.18, 0.11)[i % 4]
        w = span / n_shop - 0.55 + (0.0, -0.22, 0.16, -0.10)[i % 4]
        cy = -(shop_hy - d * 0.5 - 0.1) + (0.0, -0.13, 0.09, -0.06)[i % 4]
        fy = cy - d * 0.5                       # 门脸外皮
        parts.append(box(f"pot_shop_{i}", (w, d, h), (cx, cy, shop_z + h * 0.5), white))
        # 两扇深色橱窗，中间一根白色窗棂
        gw = (w - 1.45) * 0.5
        for gi, gx in enumerate((-0.5, 0.5)):
            parts.append(box(f"pot_shop_glass_{i}_{gi}", (gw, 0.14, h * 0.38),
                             (cx + gx * (gw + 0.22), fy - 0.04, shop_z + h * 0.23), dark))
        parts.append(box(f"pot_shop_mullion_{i}", (0.15, 0.18, h * 0.40),
                         (cx, fy - 0.05, shop_z + h * 0.23), sill))
        # 深红遮阳檐，压住橱窗上沿
        parts.append(box(f"pot_shop_awning_{i}", (w - 0.45, 0.55, 0.22),
                         (cx, fy - 0.16, shop_z + h * 0.50), band))
        # 暖黄灯箱 + 一圈白边，是照片里最亮的一条横向灯带
        parts.append(box(f"pot_shop_signrim_{i}", (w - 0.48, 0.16, 0.98),
                         (cx, fy - 0.06, shop_z + h * 0.75), sill))
        parts.append(box(f"pot_shop_sign_{i}", (w - 0.62, 0.18, 0.84),
                         (cx, fy - 0.13, shop_z + h * 0.75), amber))
        # 门口一盏暖黄球灯：照片里沿街是一条断续的橙色光点
        parts.append(sphere(f"pot_shop_lamp_{i}", (cx, fy - 0.42, shop_z + h * 0.62),
                            0.24, amber, rings=6, seg=8))
        # 平屋顶压边
        parts.append(box(f"pot_shop_cap_{i}", (w + 0.35, d + 0.35, 0.30),
                         (cx, cy, shop_z + h + 0.15), sill))

    return parts


def spread(parts):
    """把整套体块沿 x 拉宽 XS 倍（实景约 3.6:1，模型只有 1.3:1）。

    必须以 x=0 为轴：如果每个体块各按自身包围盒中心缩放，相邻块会互相插进去
    （白宫四块并排，各自变宽 2.75 倍就叠成一坨了）。以 0 为轴时所有体块的
    位置和宽度同比放大，接缝位置完全不变，红宫和它两侧的白墙也不会裂开。

    窗/窗套这类由 ``panel()`` 生成的小面板只移位不拉伸：0.6 宽的窄竖窗被
    拉宽 2.75 倍就是一条横杠。窗排的窗数由 ``win_row(dens=XS)`` 同比加密。
    """
    for ob in parts:
        me = ob.data
        if not me.vertices:
            continue
        nm = ob.name
        if nm.endswith("_sill"):
            # 窗台那条连续白条是"整条"，要跟着整排一起变长
            for v in me.vertices:
                v.co.x *= XS
            continue
        if ob in PANEL_OBJS:
            xs = [v.co.x for v in me.vertices]
            wc = (min(xs) + max(xs)) * 0.5      # 面板自己的中心
            for v in me.vertices:
                v.co.x = wc * XS + (v.co.x - wc)
            continue
        for v in me.vertices:
            v.co.x *= XS


def main():
    clear_scene()
    parts = build_potala()
    spread(parts)
    # 高宽比已经直接写进上面那张 facade 表（左高右低、最高处 27.6），
    # 不再做整体压扁——压扁会把台基也一起压歪，破坏和 apron 的标高对齐。
    parts = merge_by_material(parts)
    export_glb(OUT_GLB, parts)

    # 横向展开后正脸宽 ≈ 195，机位必须同比后退，否则预览只剩画面中间一段墙
    render_preview(os.path.join(PREVIEW_DIR, "potala_front.png"),
                   cam_pos=(0.0, -285.0, 68.0), target=(0.0, 0.0, 4.0), lens=45.0)
    render_preview(os.path.join(PREVIEW_DIR, "potala_3q.png"),
                   cam_pos=(198.0, -225.0, 84.0), target=(0.0, 0.0, 8.0), lens=50.0)
    render_preview(os.path.join(PREVIEW_DIR, "potala_low.png"),
                   cam_pos=(94.0, -242.0, 4.0), target=(0.0, 0.0, 2.0), lens=40.0)
    print("[potala] previews -> /tmp/potala_front.png /tmp/potala_3q.png")


main()
