"""Build an octagonal five-storey pagoda (雷峰塔) for the /tree scene.

Procedural: 须弥座 terrace with stairs and a stone balustrade, five octagonal
storeys that batter inwards, corner columns, door leafs on all eight faces,
architrave bands, bracket sets (斗拱), balconies (平座) with railings between the
storeys, concave eaves with upturned corners, barrel tiles (筒瓦) with end caps,
hip ridges (垂脊), and a gilded steeple (覆钵 + 相轮 + 宝珠) on the top roof.

Origin is the centre of the terrace base, so the model sits on y = 0 in three.js.
Blender +Z is up; the glTF exporter converts to Y-up.
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

OUT_GLB = os.path.expanduser("~/yumdeer.github.io/public/models/leifeng_pagoda.glb")
PREVIEW_DIR = "/tmp"

TAU = math.tau
SEG = 8

# Vertical layout (metres). Total ~37 m, matching the blocky placeholder it
# replaces (six stacked cylinders + cone, ~39 m before scene scaling).
TERRACE_R = 7.00
TERRACE_H = 1.30

BODY_R = [4.90, 4.55, 4.20, 3.85, 3.50]
BODY_H = [4.80, 4.40, 4.00, 3.60, 3.20]
ROOF_RISE = [1.55, 1.45, 1.35, 1.25]  # storey top -> next storey base
EAVE_OFF = 0.34                       # eave sits this far above the storey top
OVERHANG = 1.52                       # eave radius / body radius
TOP_APEX_Z = 31.60                    # apex of the top roof, where the steeple starts


def build_pagoda():
    stone = material("pag_stone", (0.68, 0.65, 0.56), 0.86)
    stone_dark = material("pag_stone_dark", (0.49, 0.47, 0.42), 0.88)
    wall = material("pag_wall", (0.74, 0.70, 0.61), 0.84)
    wood = material("pag_wood", (0.42, 0.20, 0.14), 0.62)
    wood_dark = material("pag_wood_dark", (0.27, 0.13, 0.10), 0.66)
    door = material("pag_door", (0.11, 0.055, 0.045), 0.62)
    bracket = material("pag_bracket", (0.35, 0.18, 0.13), 0.66)
    tile = material("pag_tile", (0.23, 0.24, 0.23), 0.72)
    tile_lip = material("pag_tile_lip", (0.31, 0.32, 0.31), 0.68)
    ridge = material("pag_ridge", (0.17, 0.18, 0.17), 0.70)
    gold = material("pag_gold", (0.82, 0.63, 0.24), 0.28, metallic=1.0)

    parts = []

    # ── 须弥座 terrace ────────────────────────────────────────────────────
    parts.append(prism("pag_terrace_lo", TERRACE_R, 0.0, 0.22, stone_dark, segments=SEG))
    parts.append(prism("pag_terrace_mid", TERRACE_R - 0.34, 0.22, 0.44, stone, segments=SEG))
    parts.append(prism("pag_terrace_top", TERRACE_R - 0.06, 0.44, TERRACE_H, stone, segments=SEG))

    # stairs on the 22.5° face
    stair_ang = math.pi / SEG
    sa_c, sa_s = math.cos(stair_ang), math.sin(stair_ang)
    apothem_t = (TERRACE_R - 0.06) * math.cos(math.pi / SEG)
    for i in range(4):
        h = TERRACE_H * (4 - i) / 4.0
        reach = apothem_t + 0.10 + i * 0.42
        parts.append(box(f"pag_step_{i}", (3.30 - i * 0.12, 0.44, h),
                         (sa_c * reach, sa_s * reach, h * 0.5), stone_dark,
                         rot_z=stair_ang + math.pi / 2))

    # stone balustrade, the stair bay stays open
    bal_r = TERRACE_R - 0.45
    for i in range(SEG):
        th0 = TAU * i / SEG
        th1 = TAU * (i + 1) / SEG
        if abs((th0 + th1) * 0.5 - stair_ang) < 1e-6:
            continue
        a = Vector((bal_r * math.cos(th0), bal_r * math.sin(th0), 0.0))
        b = Vector((bal_r * math.cos(th1), bal_r * math.sin(th1), 0.0))
        span = (b - a).length
        mid = (a + b) * 0.5
        ang = math.atan2(b.y - a.y, b.x - a.x)
        parts.append(box(f"pag_bal_rail_{i}", (span - 0.20, 0.13, 0.13),
                         (mid.x, mid.y, TERRACE_H + 0.72), stone_dark, rot_z=ang))
        parts.append(box(f"pag_bal_skirt_{i}", (span - 0.20, 0.10, 0.10),
                         (mid.x, mid.y, TERRACE_H + 0.26), stone_dark, rot_z=ang))
        for k in range(1, 3):
            p = a.lerp(b, k / 3.0)
            parts.append(box(f"pag_bal_post_{i}_{k}", (0.16, 0.16, 0.86),
                             (p.x, p.y, TERRACE_H + 0.43), stone))

    # ── storeys ───────────────────────────────────────────────────────────
    z = TERRACE_H
    for i in range(5):
        r = BODY_R[i]
        h = BODY_H[i]
        z_top = z + h
        apothem = r * math.cos(math.pi / SEG)
        face_len = 2.0 * r * math.sin(math.pi / SEG)

        # walls batter inwards (收分) like a real 楼阁式塔
        parts.append(prism(f"pag_body_{i}", r, z, z_top, wall,
                           segments=SEG, radius_top=r * 0.965))

        # corner columns
        for k in range(SEG):
            th = TAU * k / SEG
            cx, cy = r * 0.995 * math.cos(th), r * 0.995 * math.sin(th)
            parts.append(prism(f"pag_col_{i}_{k}", 0.17, z, z_top, wood,
                               segments=10, radius_top=0.155,
                               center=(cx, cy), smooth=True))

        # door leaf in a stone frame on every face. The frame has to stand well
        # proud of the wall: for a polygon the wall recedes from the apothem
        # towards the corners, so anything flush at the face centre gets
        # swallowed by the wall over most of the doorway width.
        for k in range(SEG):
            th = TAU * (k + 0.5) / SEG
            dx, dy = math.cos(th), math.sin(th)
            door_w = face_len * 0.40
            door_h = h * 0.60
            # The frame is a solid slab too, so the leaf has to sit *in front*
            # of it, otherwise the frame simply hides the doorway.
            parts.append(box(f"pag_doorframe_{i}_{k}", (door_w + 0.40, 0.22, door_h + 0.34),
                             (dx * (apothem - 0.01), dy * (apothem - 0.01),
                              z + (door_h + 0.34) * 0.5),
                             stone_dark, rot_z=th + math.pi / 2))
            parts.append(box(f"pag_doorleaf_{i}_{k}", (door_w, 0.22, door_h),
                             (dx * (apothem + 0.05), dy * (apothem + 0.05), z + door_h * 0.5),
                             door, rot_z=th + math.pi / 2))

        # architrave band under the eave (额枋)
        parts.append(prism(f"pag_fang_{i}", r * 1.012, z_top - 0.36, z_top - 0.12, wood_dark,
                           segments=SEG))

        # bracket sets (斗拱) on the eight corners and eight face centres
        for k in range(SEG * 2):
            th = TAU * k / (SEG * 2)
            px, py = r * math.cos(th), r * math.sin(th)
            parts.append(box(f"pag_dg_{i}_{k}_a", (0.46, 0.30, 0.16),
                             (px, py, z_top - 0.02), bracket, rot_z=th + math.pi / 2))
            parts.append(box(f"pag_dg_{i}_{k}_b", (0.66, 0.24, 0.13),
                             (px + math.cos(th) * 0.10, py + math.sin(th) * 0.10, z_top + 0.14),
                             bracket, rot_z=th + math.pi / 2))
            parts.append(box(f"pag_dg_{i}_{k}_c", (0.32, 0.32, 0.12),
                             (px, py, z_top + 0.26), bracket))

        # eave roof
        eave_z = z_top + EAVE_OFF
        r_out = r * OVERHANG
        if i < 4:
            z_next = z_top + ROOF_RISE[i]
            sample = roof_sampler(r * 0.92, z_next - 0.06, r_out, eave_z,
                                  curve=2.45, lift=0.46, linear=0.45, seg=SEG)
            nt, nr = 96, 10
        else:
            sample = roof_sampler(0.42, TOP_APEX_Z, r_out, eave_z,
                                  curve=2.30, lift=0.42, linear=0.34, seg=SEG)
            nt, nr = 112, 16

        parts.append(build_roof(f"pag_roof_{i}", sample, tile, thickness=0.20, nt=nt, nr=nr))
        parts.extend(build_tiles(f"pag_tiles_{i}", sample, tile, tile_lip,
                                 count=36, s_from=0.02, s_to=0.90, n_s=6, radius=0.12))
        for k in range(SEG):
            th = TAU * k / SEG
            parts.append(tube(f"pag_hip_{i}_{k}",
                              [sample(th, 0.02 + 0.90 * j / 12) for j in range(13)],
                              ridge, 0.10, ring=8, closed_ends=True))
        parts.append(eave_band(f"pag_fascia_{i}", sample, wood_dark, depth=0.20, nt=128))

        # balcony (平座) carrying the next storey, cantilevered over this eave
        if i < 4:
            rn = BODY_R[i + 1]
            parts.append(prism(f"pag_balcony_{i}", rn * 1.30, z_next - 0.22, z_next, stone,
                               segments=SEG))
            parts.append(prism(f"pag_bal_skirt_{i}", rn * 1.28, z_next - 0.22, z_next - 0.09,
                               wood_dark, segments=SEG, caps=False))
            parts.append(prism(f"pag_bal_rail_{i}", rn * 1.26, z_next + 0.46, z_next + 0.54,
                               wood, segments=SEG, caps=False))
            for k in range(SEG * 2):
                th = TAU * k / (SEG * 2)
                px, py = rn * 1.26 * math.cos(th), rn * 1.26 * math.sin(th)
                parts.append(prism(f"pag_bal_post_{i}_{k}", 0.075, z_next, z_next + 0.46,
                                   wood, segments=6, center=(px, py)))
            z = z_next

    # ── steeple (塔刹) ────────────────────────────────────────────────────
    s0 = TOP_APEX_Z - 1.30
    parts.append(prism("pag_spire_base", 0.98, s0, s0 + 0.38, stone,
                       segments=SEG, radius_top=0.72))
    parts.append(prism("pag_spire_neck", 0.60, s0 + 0.38, s0 + 0.60, stone_dark,
                       segments=12, smooth=True))
    parts.append(sphere("pag_spire_bowl", (0.0, 0.0, s0 + 0.92), 0.80, gold,
                        rings=9, seg=16, squash=(1.0, 1.0, 0.62)))

    mast_z = s0 + 0.95
    for k in range(7):
        zz = mast_z + 0.62 + k * 0.30
        rr = 0.66 - k * 0.042
        parts.append(prism(f"pag_spire_ring_{k}", rr, zz, zz + 0.11, gold,
                           segments=16, smooth=True, radius_top=rr * 0.90))
    parts.append(prism("pag_spire_canopy", 0.58, mast_z + 2.85, mast_z + 2.99, gold,
                       segments=16, smooth=True, radius_top=0.30))
    parts.append(sphere("pag_spire_pearl", (0.0, 0.0, mast_z + 3.32), 0.30, gold,
                        rings=8, seg=14))
    parts.append(tube("pag_spire_mast",
                      [Vector((0.0, 0.0, s0 + 0.60)), Vector((0.0, 0.0, mast_z + 3.62))],
                      gold, 0.055, ring=8, closed_ends=True))

    return parts


def main():
    clear_scene()
    parts = merge_by_material(build_pagoda())
    export_glb(OUT_GLB, parts)

    render_preview(os.path.join(PREVIEW_DIR, "pagoda_3q.png"),
                   cam_pos=(34.0, -38.0, 19.0), target=(0.0, 0.0, 15.5), lens=50.0)
    render_preview(os.path.join(PREVIEW_DIR, "pagoda_side.png"),
                   cam_pos=(-44.0, -30.0, 12.0), target=(0.0, 0.0, 15.5), lens=55.0)
    render_preview(os.path.join(PREVIEW_DIR, "pagoda_close.png"),
                   cam_pos=(13.0, -15.0, 7.0), target=(0.0, 0.0, 6.0), lens=55.0)
    print("[pagoda] previews -> /tmp/pagoda_3q.png /tmp/pagoda_side.png /tmp/pagoda_close.png")


main()
