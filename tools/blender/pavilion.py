"""Build a detailed hexagonal Chinese pavilion (重檐六角亭) for the /tree scene.

Procedural: hexagonal stone platform with steps, column bases, six columns,
architraves, bracket sets (斗拱), railings, a double-eave concave roof with
hexagonal outlines, upturned corners, individual barrel tiles (筒瓦) with end
caps (瓦当), hip ridges (垂脊), and a gold finial (宝顶).

Origin is the centre of the platform base, so the model sits on y = 0 in three.js.
Blender +Z is up; the glTF exporter converts to Y-up.

Geometry helpers live in bg_common.py so this and pagoda.py share one
implementation of the roof/tile/tube primitives.
"""

import math
import os

import bpy
from mathutils import Vector

try:
    HERE = os.path.dirname(os.path.abspath(__file__))
except NameError:  # Blender always sets __file__ for --python scripts
    # --exec 模式下没有 __file__，回退到仓库内的脚本目录（脚本唯一真源）
    HERE = os.path.expanduser("~/yumdeer.github.io/tools/blender")

exec(open(os.path.join(HERE, "bg_common.py")).read())

OUT_GLB = os.path.expanduser("~/yumdeer.github.io/public/models/hex_pavilion.glb")
PREVIEW_DIR = "/tmp"

TAU = math.tau
SEG = 6
CORNER = [TAU * i / SEG for i in range(SEG)]

# Vertical layout (metres). Column 4.7 m, eaves overhang ~1.45 m, total ~11.3 m so
# the model drops onto the same footprint and height as the old placeholder.
P_TOP = 0.45
COL_R = 3.30
COL_TOP = 4.60
EAVE_LO_Z, EAVE_LO_R = 5.20, 4.80
DRUM_R = 1.70
DRUM_Z0, DRUM_Z1 = 7.40, 7.85
EAVE_HI_Z, EAVE_HI_R = 7.85, 2.65
APEX_Z = 9.80


# ─────────────────────────────── pavilion ───────────────────────────────


def build_pavilion():
    stone = material("pav_stone", (0.58, 0.57, 0.54), 0.88)
    stone_dark = material("pav_stone_dark", (0.45, 0.44, 0.42), 0.90)
    wood = material("pav_wood", (0.45, 0.21, 0.15), 0.62)
    wood_dark = material("pav_wood_dark", (0.29, 0.16, 0.12), 0.65)
    tile = material("pav_tile", (0.26, 0.28, 0.27), 0.72)
    tile_lip = material("pav_tile_lip", (0.34, 0.36, 0.35), 0.68)
    ridge = material("pav_ridge", (0.21, 0.23, 0.22), 0.70)
    bracket = material("pav_bracket", (0.19, 0.30, 0.26), 0.70)
    gold = material("pav_gold", (0.80, 0.62, 0.26), 0.32, metallic=1.0)

    parts = []

    # stone platform (须弥座): three stacked hex prisms
    parts.append(prism("pav_platform_lo", 4.36, 0.0, 0.16, stone_dark, phase=math.radians(30)))
    parts.append(prism("pav_platform_mid", 4.20, 0.16, 0.32, stone, phase=math.radians(30)))
    parts.append(prism("pav_platform_top", 4.42, 0.32, P_TOP, stone, phase=math.radians(30)))

    # steps on the 30° face, the side the boardwalk arrives from
    step_dir = math.radians(30)
    sx, sy = math.cos(step_dir), math.sin(step_dir)
    for i in range(3):
        h = P_TOP * (3 - i) / 3.0
        reach = 4.30 + i * 0.32
        parts.append(box(f"pav_step_{i}", (2.30 - i * 0.14, 0.34, h),
                         (sx * reach, sy * reach, h * 0.5), stone_dark,
                         rot_z=step_dir + math.pi / 2))

    # column bases and columns
    for i, th in enumerate(CORNER):
        cx, cy = COL_R * math.cos(th), COL_R * math.sin(th)
        parts.append(prism(f"pav_colbase_{i}", 0.235, P_TOP, P_TOP + 0.13, stone_dark,
                           segments=12, center=(cx, cy), smooth=True))
        parts.append(prism(f"pav_column_{i}", 0.145, P_TOP + 0.13, COL_TOP, wood,
                           segments=14, radius_top=0.125, center=(cx, cy), smooth=True))

    # architraves (额枋): one bay per hexagon edge, plus a lower lintel
    for i in range(SEG):
        a = Vector((COL_R * math.cos(CORNER[i]), COL_R * math.sin(CORNER[i]), 0))
        b = Vector((COL_R * math.cos(CORNER[(i + 1) % SEG]),
                    COL_R * math.sin(CORNER[(i + 1) % SEG]), 0))
        span = (b - a).length
        mid = (a + b) * 0.5
        ang = math.atan2(b.y - a.y, b.x - a.x)
        for z, thick, height in ((COL_TOP - 0.34, 0.20, 0.26), (COL_TOP - 0.06, 0.22, 0.20)):
            parts.append(box(f"pav_fang_{i}_{z:.2f}", (span - 0.10, thick, height),
                             (mid.x, mid.y, z), wood, rot_z=ang))

    # bracket sets (斗拱) over every column and at every bay centre
    def bracket_set(name, th, z0):
        px, py = COL_R * math.cos(th), COL_R * math.sin(th)
        parts.append(box(f"{name}_dou", (0.34, 0.34, 0.16), (px, py, z0 + 0.08), bracket))
        tang = th + math.pi / 2
        for k, (length, dz, w) in enumerate(((0.80, 0.26, 0.14), (0.60, 0.40, 0.12))):
            parts.append(box(f"{name}_gong{k}", (length, w, 0.11), (px, py, z0 + dz),
                             bracket, rot_z=tang))
            parts.append(box(f"{name}_ang{k}", (length * 0.85, w, 0.11),
                             (px + math.cos(th) * 0.14, py + math.sin(th) * 0.14, z0 + dz + 0.07),
                             bracket, rot_z=th))
        for dx in (0.0, 0.24, -0.24):
            parts.append(box(f"{name}_sheng_{dx:+.2f}", (0.12, 0.12, 0.11),
                             (px + dx, py, z0 + 0.50), bracket))

    for i, th in enumerate(CORNER):
        bracket_set(f"pav_dg_col_{i}", th, COL_TOP)
    for i in range(SEG):
        bracket_set(f"pav_dg_bay_{i}", CORNER[i] + math.radians(30), COL_TOP)

    # eave purlin ring, hides the bracket tops under the roof
    parts.append(prism("pav_purlin", 3.72, COL_TOP + 0.50, COL_TOP + 0.64, wood_dark,
                       segments=SEG, phase=math.radians(30)))

    # railings on five bays, the 30° bay stays open as the entrance
    rail_z0, rail_z1 = P_TOP, P_TOP + 0.90
    for i in range(SEG):
        mid_th = CORNER[i] + math.radians(30)
        if abs((math.degrees(mid_th) % 360) - 30.0) < 1e-6:
            continue
        a = Vector((COL_R * math.cos(CORNER[i]), COL_R * math.sin(CORNER[i]), 0))
        b = Vector((COL_R * math.cos(CORNER[(i + 1) % SEG]),
                    COL_R * math.sin(CORNER[(i + 1) % SEG]), 0))
        span = (b - a).length
        mid = (a + b) * 0.5
        ang = math.atan2(b.y - a.y, b.x - a.x)
        parts.append(box(f"pav_rail_top_{i}", (span - 0.26, 0.10, 0.09),
                         (mid.x, mid.y, rail_z1 - 0.05), wood, rot_z=ang))
        parts.append(box(f"pav_rail_bot_{i}", (span - 0.26, 0.09, 0.08),
                         (mid.x, mid.y, rail_z0 + 0.16), wood, rot_z=ang))
        parts.append(box(f"pav_rail_panel_{i}", (span - 0.30, 0.045, 0.42),
                         (mid.x, mid.y, rail_z0 + 0.47), wood_dark, rot_z=ang))
        for k in range(1, 4):
            p = a.lerp(b, k / 4.0)
            parts.append(box(f"pav_rail_post_{i}_{k}", (0.075, 0.075, rail_z1 - rail_z0),
                             (p.x, p.y, rail_z0 + (rail_z1 - rail_z0) * 0.5), wood))

    # lower eave
    lo = roof_sampler(DRUM_R, DRUM_Z0, EAVE_LO_R, EAVE_LO_Z, curve=2.60, lift=0.22, linear=0.46)
    parts.append(build_roof("pav_roof_lower", lo, tile))
    parts.extend(build_tiles("pav_tiles_lower", lo, tile, tile_lip,
                             count=84, s_from=0.0, s_to=0.86, n_s=10, radius=0.085))
    for i, th in enumerate(CORNER):
        parts.append(tube(f"pav_hip_lower_{i}",
                          [lo(th, 0.005 + 0.94 * k / 16) for k in range(17)],
                          ridge, 0.085, ring=8, closed_ends=True))
    parts.append(eave_band("pav_fascia_lo", lo, wood_dark, depth=0.17))

    # drum between the two roofs
    parts.append(prism("pav_drum", DRUM_R - 0.02, DRUM_Z0 - 0.12, DRUM_Z1, wood_dark,
                       segments=SEG, phase=0.0, caps=False))

    # upper eave converging to the apex
    hi = roof_sampler(0.06, APEX_Z, EAVE_HI_R, EAVE_HI_Z, curve=2.55, lift=0.17, linear=0.42)
    parts.append(build_roof("pav_roof_upper", hi, tile, nt=144, nr=20))
    parts.extend(build_tiles("pav_tiles_upper", hi, tile, tile_lip,
                             count=60, s_from=0.02, s_to=0.86, n_s=9, radius=0.072))
    for i, th in enumerate(CORNER):
        parts.append(tube(f"pav_hip_upper_{i}",
                          [hi(th, 0.02 + 0.93 * k / 16) for k in range(17)],
                          ridge, 0.072, ring=8, closed_ends=True))
    parts.append(eave_band("pav_fascia_hi", hi, wood_dark, depth=0.14))

    # gold finial (宝顶): lotus base, bead, spike
    parts.append(prism("pav_finial_base", 0.28, APEX_Z - 0.10, APEX_Z + 0.10, gold,
                       segments=12, radius_top=0.20, smooth=True))
    parts.append(prism("pav_finial_neck", 0.13, APEX_Z + 0.10, APEX_Z + 0.22, gold,
                       segments=10, smooth=True))
    parts.append(sphere("pav_finial_bead", (0.0, 0.0, APEX_Z + 0.46), 0.20, gold,
                        rings=8, seg=12))
    parts.append(prism("pav_finial_spike", 0.05, APEX_Z + 0.40, APEX_Z + 1.05, gold,
                       segments=8, radius_top=0.012, smooth=True))

    return parts


def main():
    clear_scene()
    parts = merge_by_material(build_pavilion())
    export_glb(OUT_GLB, parts)

    render_preview(os.path.join(PREVIEW_DIR, "pavilion_3q.png"),
                   cam_pos=(14.5, -14.5, 10.0), target=(0.0, 0.0, 5.2), lens=45.0)
    render_preview(os.path.join(PREVIEW_DIR, "pavilion_front.png"),
                   cam_pos=(0.0, -23.0, 6.4), target=(0.0, 0.0, 5.2), lens=52.0)
    print("[pavilion] previews -> /tmp/pavilion_3q.png /tmp/pavilion_front.png")


main()
