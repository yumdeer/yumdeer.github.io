"""Shared procedural-mesh helpers for the /tree asset builders.

Loaded by the asset scripts (pavilion.py, pagoda.py) with
``exec(open(os.path.join(ASSET_DIR, "bg_common.py")).read())`` so they share one
implementation of the roof/tile/tube primitives.

Everything is plain bpy + mathutils: no add-ons, no external files.
"""

import math
import os

import bpy
from mathutils import Vector

TAU = math.tau


# ───────────────────────────── scene / objects ─────────────────────────────


def clear_scene():
    for ob in list(bpy.data.objects):
        bpy.data.objects.remove(ob, do_unlink=True)
    for block in (bpy.data.meshes, bpy.data.materials, bpy.data.curves):
        for item in list(block):
            if item.users == 0:
                block.remove(item)


def material(name, rgb, roughness=0.8, metallic=0.0):
    existing = bpy.data.materials.get(name)
    if existing:
        return existing
    mat = bpy.data.materials.new(name)
    mat.use_nodes = True
    bsdf = mat.node_tree.nodes["Principled BSDF"]
    bsdf.inputs["Base Color"].default_value = (*rgb, 1.0)
    bsdf.inputs["Roughness"].default_value = roughness
    bsdf.inputs["Metallic"].default_value = metallic
    mat.diffuse_color = (*rgb, 1.0)
    return mat


def mesh_object(name, verts, faces, mat, smooth=False):
    me = bpy.data.meshes.new(name)
    me.from_pydata([tuple(v) for v in verts], [], faces)
    me.validate(clean_customdata=False)
    if smooth:
        me.polygons.foreach_set("use_smooth", [True] * len(me.polygons))
    me.materials.append(mat)
    me.update()
    ob = bpy.data.objects.new(name, me)
    bpy.context.collection.objects.link(ob)
    return ob


def box(name, size, center, mat, rot_z=0.0):
    hx, hy, hz = (s * 0.5 for s in size)
    local = [
        (-hx, -hy, -hz), (hx, -hy, -hz), (hx, hy, -hz), (-hx, hy, -hz),
        (-hx, -hy, hz), (hx, -hy, hz), (hx, hy, hz), (-hx, hy, hz),
    ]
    faces = [(3, 2, 1, 0), (4, 5, 6, 7), (0, 1, 5, 4), (1, 2, 6, 5), (2, 3, 7, 6), (3, 0, 4, 7)]
    ca, sa = math.cos(rot_z), math.sin(rot_z)
    verts = [(x * ca - y * sa + center[0], x * sa + y * ca + center[1], z + center[2])
             for x, y, z in local]
    return mesh_object(name, verts, faces, mat)


def prism(name, radius, z0, z1, mat, segments=6, phase=0.0, radius_top=None,
          center=(0.0, 0.0), smooth=False, caps=True):
    rt = radius if radius_top is None else radius_top
    verts, faces = [], []
    for r, z in ((radius, z0), (rt, z1)):
        for i in range(segments):
            a = phase + TAU * i / segments
            verts.append((center[0] + r * math.cos(a), center[1] + r * math.sin(a), z))
    for i in range(segments):
        j = (i + 1) % segments
        faces.append((i, j, segments + j, segments + i))
    if caps:
        faces.append(tuple(range(segments - 1, -1, -1)))
        faces.append(tuple(range(segments, segments * 2)))
    return mesh_object(name, verts, faces, mat, smooth=smooth)


def disc(name, center, radius, mat, seg=10, ring_skew=0.0):
    """Flat disc facing radially outward (barrel-tile end caps)."""
    d = Vector((math.cos(ring_skew), math.sin(ring_skew), 0.0)).normalized()
    t = Vector((0.0, 0.0, 1.0)).cross(d).normalized()
    u = Vector((0.0, 0.0, 1.0))
    verts = [center]
    for i in range(seg):
        a = TAU * i / seg
        verts.append(center + t * (math.cos(a) * radius) + u * (math.sin(a) * radius))
    faces = [(0, 1 + i, 1 + (i + 1) % seg) for i in range(seg)]
    return mesh_object(name, verts, faces, mat, smooth=True)


def sphere(name, center, radius, mat, rings=8, seg=12, squash=(1.0, 1.0, 1.0)):
    """UV sphere with per-axis scaling (finial beads, 覆钵, 宝珠)."""
    cx, cy, cz = center
    sx, sy, sz = squash
    verts = [(cx, cy, cz + radius * sz)]
    for k in range(1, rings):
        a = math.pi * k / rings
        r = radius * math.sin(a)
        z = cz + radius * math.cos(a) * sz
        for c in range(seg):
            t = TAU * c / seg
            verts.append((cx + r * math.cos(t) * sx, cy + r * math.sin(t) * sy, z))
    verts.append((cx, cy, cz - radius * sz))
    faces = [(0, 1 + c, 1 + (c + 1) % seg) for c in range(seg)]
    for k in range(rings - 2):
        base = 1 + k * seg
        for c in range(seg):
            a = base + c
            b = base + (c + 1) % seg
            faces.append((a, b, b + seg, a + seg))
    base = 1 + (rings - 2) * seg
    last = len(verts) - 1
    for c in range(seg):
        faces.append((base + (c + 1) % seg, base + c, last))
    return mesh_object(name, verts, faces, mat, smooth=True)


# ─────────────────────────────── roof maths ───────────────────────────────


def polygon_radius(theta, corner_radius, seg=6):
    """Distance to a regular polygon outline; returns (radius, delta to vertex)."""
    apothem = corner_radius * math.cos(math.pi / seg)
    period = 360.0 / seg
    delta = math.degrees(theta) % period
    if delta > period * 0.5:
        delta -= period
    return apothem / math.cos(math.radians(delta)), delta


def corner_weight(delta, seg=6):
    """1 at a roof corner, 0 at an edge midpoint."""
    k = 180.0 / (360.0 / seg)
    return max(0.0, math.cos(math.radians(delta) * k)) ** 2


def roof_sampler(r_in, z_in, r_out, z_out, curve, lift, linear=0.45, seg=6):
    """Concave umbrella surface, s = 0 at the eave and 1 at the inner ring.

    A pure ``s ** curve`` profile has zero slope at the eave, which reads as a
    flat hat brim. Blending in a linear term keeps the eave at a believable
    slope (~17°) while the apex stays steep, which is the classic 举折 shape.
    """

    def sample(theta, s):
        r_eave, delta = polygon_radius(theta, r_out, seg)
        r = r_eave + (r_in - r_eave) * s
        rise = linear * s + (1.0 - linear) * (s ** curve)
        z = z_out + (z_in - z_out) * rise
        z += lift * corner_weight(delta, seg) * (1.0 - s) ** 3.0
        return Vector((r * math.cos(theta), r * math.sin(theta), z))

    return sample


def build_roof(name, sample, mat, thickness=0.11, nt=180, nr=24):
    verts = []
    for i in range(nt):
        th = TAU * i / nt
        for j in range(nr + 1):
            verts.append(sample(th, j / nr))
    faces = []
    for i in range(nt):
        i2 = (i + 1) % nt
        for j in range(nr):
            a = i * (nr + 1) + j
            b = i2 * (nr + 1) + j
            faces.append((a, b, b + 1, a + 1))
    ob = mesh_object(name, verts, faces, mat, smooth=True)
    solid = ob.modifiers.new("thickness", "SOLIDIFY")
    solid.thickness = thickness
    solid.offset = -1.0
    return ob


def build_tiles(name, sample, mat, cap_mat=None, count=84, s_from=0.0, s_to=0.86,
                n_s=9, radius=0.085, squash=0.72):
    """Rows of half-round barrel tiles running from the inner ring to the eave."""
    verts, faces = [], []
    cross = 4
    cap_centers = []
    for k in range(count):
        th = TAU * k / count
        tx, ty = -math.sin(th), math.cos(th)
        base = len(verts)
        for j in range(n_s + 1):
            s = s_from + (s_to - s_from) * j / n_s
            p = sample(th, s)
            for c in range(cross + 1):
                phi = math.pi * c / cross
                verts.append((p.x + tx * radius * math.cos(phi),
                              p.y + ty * radius * math.cos(phi),
                              p.z + radius * math.sin(phi) * squash))
        row = cross + 1
        for j in range(n_s):
            for c in range(cross):
                a = base + j * row + c
                b = base + (j + 1) * row + c
                faces.append((a, b, b + 1, a + 1))
        if cap_mat is not None:
            cap_centers.append((sample(th, s_from), th))
    out = [mesh_object(name, verts, faces, mat, smooth=True)]
    for i, (p, th) in enumerate(cap_centers):
        out.append(disc(f"{name}_wadang_{i}", Vector((p.x, p.y, p.z + radius * 0.30)),
                        radius * 1.02, cap_mat, seg=10, ring_skew=th))
    return out


def eave_band(name, sample, mat, depth=0.16, inset=0.02, nt=180):
    """Fascia board hugging the roof edge, following the upturned corners."""
    verts = []
    for i in range(nt):
        p = sample(TAU * i / nt, 0.0)
        r = math.hypot(p.x, p.y) or 1.0
        k = (r + inset) / r
        verts.append(Vector((p.x * k, p.y * k, p.z)))
        verts.append(Vector((p.x * k, p.y * k, p.z - depth)))
    faces = []
    for i in range(nt):
        a, b = i * 2, ((i + 1) % nt) * 2
        faces.append((a, a + 1, b + 1, b))
    return mesh_object(name, verts, faces, mat, smooth=True)


def tube(name, points, mat, radius, ring=8, closed_ends=False):
    verts, faces = [], []
    up = Vector((0.0, 0.0, 1.0))
    for i, p in enumerate(points):
        if i == 0:
            d = points[1] - p
        elif i == len(points) - 1:
            d = p - points[-2]
        else:
            d = points[i + 1] - points[i - 1]
        d.normalize()
        side = d.cross(up)
        if side.length < 1e-6:
            side = Vector((1.0, 0.0, 0.0))
        side.normalize()
        nrm = side.cross(d).normalized()
        for c in range(ring):
            a = TAU * c / ring
            verts.append(p + side * (math.cos(a) * radius) + nrm * (math.sin(a) * radius))
    for i in range(len(points) - 1):
        for c in range(ring):
            a = i * ring + c
            b = i * ring + (c + 1) % ring
            faces.append((a, b, b + ring, a + ring))
    if closed_ends:
        faces.append(tuple(range(ring - 1, -1, -1)))
        last = (len(points) - 1) * ring
        faces.append(tuple(range(last, last + ring)))
    return mesh_object(name, verts, faces, mat, smooth=True)


# ─────────────────────────── export / preview ───────────────────────────


def merge_by_material(parts):
    """Apply modifiers and join into one mesh per material.

    Every part starts as its own object, which would be hundreds of draw calls
    in three.js. glTF primitives are already split per material, so merging
    first costs nothing visually.
    """
    for ob in parts:
        if ob.modifiers:
            bpy.ops.object.select_all(action="DESELECT")
            bpy.context.view_layer.objects.active = ob
            ob.select_set(True)
            for mod in list(ob.modifiers):
                bpy.ops.object.modifier_apply(modifier=mod.name)

    groups = {}
    for ob in parts:
        groups.setdefault(ob.data.materials[0].name, []).append(ob)

    merged = []
    for obs in groups.values():
        bpy.ops.object.select_all(action="DESELECT")
        for ob in obs:
            ob.select_set(True)
        bpy.context.view_layer.objects.active = obs[0]
        if len(obs) > 1:
            bpy.ops.object.join()
        merged.append(obs[0])
    return merged


def export_glb(path, parts):
    total_v = sum(len(ob.data.vertices) for ob in parts)
    total_f = sum(len(ob.data.polygons) for ob in parts)
    os.makedirs(os.path.dirname(path), exist_ok=True)
    bpy.ops.export_scene.gltf(
        filepath=path,
        export_format="GLB",
        export_apply=True,
        export_yup=True,
        export_cameras=False,
        export_lights=False,
        use_selection=False,
    )
    print(f"[glb] objects={len(parts)} verts={total_v} faces={total_f} "
          f"size={os.path.getsize(path) / 1024.0:.1f}KB -> {path}")


def render_preview(path, cam_pos, target, res=640, samples=40, lens=50.0,
                   world=(0.70, 0.76, 0.82), sun_deg=(50, 0, 40), sun_energy=3.4):
    scene = bpy.context.scene
    scene.render.engine = "CYCLES"
    scene.cycles.device = "CPU"
    scene.cycles.samples = samples
    scene.cycles.use_denoising = True
    scene.render.resolution_x = res
    scene.render.resolution_y = res
    scene.render.resolution_percentage = 100
    scene.render.filepath = path
    scene.render.image_settings.file_format = "PNG"

    if scene.world is None:
        scene.world = bpy.data.worlds.new("World")
    scene.world.use_nodes = True
    bg = scene.world.node_tree.nodes["Background"]
    bg.inputs[0].default_value = (*world, 1.0)
    bg.inputs[1].default_value = 1.0

    cam_data = bpy.data.cameras.get("PreviewCam") or bpy.data.cameras.new("PreviewCam")
    cam_data.lens = lens
    cam = bpy.data.objects.get("PreviewCamObj")
    if cam is None:
        cam = bpy.data.objects.new("PreviewCamObj", cam_data)
        bpy.context.collection.objects.link(cam)
    cam.location = cam_pos
    direction = (Vector(target) - Vector(cam_pos)).normalized()
    cam.rotation_euler = direction.to_track_quat("-Z", "Y").to_euler()
    scene.camera = cam

    sun_data = bpy.data.lights.get("Sun") or bpy.data.lights.new("Sun", type="SUN")
    sun = bpy.data.objects.get("SunObj")
    if sun is None:
        sun = bpy.data.objects.new("SunObj", sun_data)
        bpy.context.collection.objects.link(sun)
    sun.data.energy = sun_energy
    sun.data.angle = math.radians(5.0)
    sun.rotation_euler = tuple(math.radians(a) for a in sun_deg)

    bpy.ops.render.render(write_still=True)
    return path
