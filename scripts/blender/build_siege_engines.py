"""Siege engines (brief §6.2, J4): a roofed ram and a torsion catapult built from beams, planks,
wheels and ropes, painted in vertex colours from the castle's timber palette (no texture: the
PaintedMaterial reads COLOR_0, like the castle kit). One GLB per engine; the moving parts are
bones whose head is their pivot, animated procedurally at runtime:

  ram.glb       bones Body, Log (thrust along its axis), WheelFL/FR/BL/BR (axle along x)
  catapult.glb  bones Frame, Arm (pivot on the axle, cocked towards the back; fires about x),
                WheelFL/FR/BL/BR
  siegeTower.glb bones Body, Gangway (hinged at the top platform, modelled lowered), WheelFL/FR/BL/BR

Each engine is one skinned mesh (one draw call) whose parts are rigidly weighted to their bone.

Blender axes: x across, -y forward (exported as glTF +z, the units' facing), z up. Sizes in
metres. Deterministic (fixed seed), headless:

  blender -b --factory-startup --python scripts/blender/build_siege_engines.py -- <out dir>
"""
import math
import os
import random
import sys

import bmesh
import bpy
from mathutils import Matrix, Vector

SEED = 1187
# Castle palette (src/render/materials/palette.ts), sRGB.
WOOD_WARM = ('#7a5234', '#4e3322')
WOOD_LIGHT = ('#a67b4f', '#6e5034')
IRON = '#3e3f44'
HIDE = ('#a08868', '#7a6650')
ROPE = '#b49a6a'
STONE = '#8f8577'
TONE_JITTER = 0.09
BEVEL_M = 0.025
# The siege tower's fighting platform, level with a 10 m curtain's wall-walk.
TOWER_PLATFORM_M = 10.4

rng = random.Random(SEED)


def log(*args):
    print('[engines]', *args, flush=True)


def srgb_to_linear(c):
    return c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4


def rgb(hex_color):
    h = hex_color.lstrip('#')
    return tuple(int(h[i:i + 2], 16) / 255 for i in (0, 2, 4))


def mix(a, b, t):
    return tuple(x + (y - x) * t for x, y in zip(a, b))


def paint(obj, base_rgb, jitter=TONE_JITTER, under=0.62):
    """Per-face tone variation and darker undersides, written as a linear FLOAT_COLOR attribute."""
    mesh = obj.data
    attr = mesh.color_attributes.new(name='Col', type='FLOAT_COLOR', domain='CORNER')
    for poly in mesh.polygons:
        k = 1 + (rng.random() * 2 - 1) * jitter
        if poly.normal.z < -0.5:
            k *= under
        c = tuple(srgb_to_linear(min(1.0, v * k)) for v in base_rgb)
        for li in poly.loop_indices:
            attr.data[li].color = (*c, 1.0)
    mesh.color_attributes.active_color = attr


def finish(obj, color, bevel=BEVEL_M, jitter=TONE_JITTER):
    if bevel > 0:
        mod = obj.modifiers.new('bevel', 'BEVEL')
        mod.width = bevel
        mod.segments = 1
        mod.limit_method = 'ANGLE'
        bpy.context.view_layer.objects.active = obj
        bpy.ops.object.modifier_apply(modifier=mod.name)
    paint(obj, color, jitter)
    return obj


def box(name, size, location, rotation=(0, 0, 0), color=None, bevel=BEVEL_M):
    bpy.ops.mesh.primitive_cube_add(size=1, location=location, rotation=rotation)
    obj = bpy.context.active_object
    obj.name = name
    obj.scale = size
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    return finish(obj, color or tone(WOOD_WARM), bevel)


def cylinder(name, radius, depth, location, rotation=(0, 0, 0), color=None, sides=10, bevel=0.0):
    bpy.ops.mesh.primitive_cylinder_add(vertices=sides, radius=radius, depth=depth, location=location, rotation=rotation)
    obj = bpy.context.active_object
    obj.name = name
    return finish(obj, color or tone(WOOD_WARM), bevel)


def beam_between(name, a, b, width, color=None):
    """A square beam from point a to point b."""
    a, b = Vector(a), Vector(b)
    d = b - a
    length = d.length
    obj = box(name, (width, width, length), (a + b) / 2, color=color, bevel=0.0)
    obj.rotation_mode = 'QUATERNION'
    obj.rotation_quaternion = Vector((0, 0, 1)).rotation_difference(d.normalized())
    bpy.ops.object.select_all(action='DESELECT')
    obj.select_set(True)
    bpy.context.view_layer.objects.active = obj
    bpy.ops.object.transform_apply(location=False, rotation=True, scale=False)
    return obj


def rope_between(name, a, b):
    a, b = Vector(a), Vector(b)
    d = b - a
    bpy.ops.mesh.primitive_cylinder_add(vertices=6, radius=0.035, depth=d.length, location=(a + b) / 2)
    obj = bpy.context.active_object
    obj.name = name
    obj.rotation_mode = 'QUATERNION'
    obj.rotation_quaternion = Vector((0, 0, 1)).rotation_difference(d.normalized())
    bpy.ops.object.transform_apply(location=False, rotation=True, scale=False)
    return finish(obj, rgb(ROPE), 0.0, 0.05)


def tone(pair, t=None):
    lit, base = rgb(pair[0]), rgb(pair[1])
    return mix(base, lit, rng.uniform(0.25, 0.75) if t is None else t)


def wheel(name, radius, width, location, spokes=8):
    """Rim of segments, iron hub and spokes (open: the spokes show), axle along x; origin at the wheel centre."""
    parts = []
    x, y, z = location
    rim_sides = 14
    for k in range(rim_sides):
        a0 = 2 * math.pi * k / rim_sides
        a1 = 2 * math.pi * (k + 1) / rim_sides
        p0 = (x, y + math.cos(a0) * radius * 0.9, z + math.sin(a0) * radius * 0.9)
        p1 = (x, y + math.cos(a1) * radius * 0.9, z + math.sin(a1) * radius * 0.9)
        parts.append(beam_between(f'{name}.rim{k}', p0, p1, radius * 0.22, tone(WOOD_LIGHT, 0.3)))
    for k in range(spokes):
        a = 2 * math.pi * k / spokes
        parts.append(beam_between(f'{name}.spoke{k}', (x, y, z), (x, y + math.cos(a) * radius * 0.85, z + math.sin(a) * radius * 0.85), radius * 0.09, tone(WOOD_LIGHT, 0.4)))
    parts.append(cylinder(f'{name}.hub', radius * 0.2, width, (x, y, z), rotation=(0, math.pi / 2, 0), color=rgb(IRON), sides=8))
    obj = join(name, parts)
    set_origin(obj, location)
    return obj


def join(name, objs):
    bpy.ops.object.select_all(action='DESELECT')
    for o in objs:
        o.select_set(True)
    bpy.context.view_layer.objects.active = objs[0]
    bpy.ops.object.join()
    obj = bpy.context.active_object
    obj.name = name
    obj.data.name = name
    return obj


def set_origin(obj, point):
    """Moves the object's origin to `point` (world), keeping the geometry in place."""
    p = Vector(point)
    obj.data.transform(Matrix.Translation(-p + obj.location))
    obj.location = p


def build_ram():
    parts = []
    L, W = 6.0, 2.1
    side_x = W / 2
    # Chassis: side beams, cross beams, axle beams.
    for sx in (-1, 1):
        parts.append(box('ch.side', (0.3, L, 0.3), (sx * side_x, 0, 0.78)))
    for y in (-2.7, -1.0, 1.0, 2.7):
        parts.append(box('ch.cross', (W + 0.3, 0.26, 0.26), (0, y, 0.82)))
    # Posts and top rails of the shed.
    for sx in (-1, 1):
        for y in (-2.85, -0.95, 0.95, 2.85):
            parts.append(box('post', (0.24, 0.24, 1.55), (sx * side_x, y, 1.65), color=tone(WOOD_LIGHT, 0.35)))
        parts.append(box('rail', (0.26, L + 0.2, 0.26), (sx * side_x, 0, 2.45)))
    parts.append(box('ridge', (0.28, L + 0.5, 0.28), (0, 0, 3.25)))
    for y in (-2.85, 0, 2.85):
        for sx in (-1, 1):
            parts.append(beam_between('rafter', (sx * (side_x + 0.35), y, 2.42), (0, y, 3.25), 0.2, tone(WOOD_WARM, 0.3)))
    # Roof planks on both slopes, then hides over them (the roof against arrows).
    planks = 7
    for sx in (-1, 1):
        for k in range(planks):
            t0 = k / planks
            t1 = (k + 1) / planks
            a = Vector((sx * (side_x + 0.45), 0, 2.38)).lerp(Vector((0, 0, 3.32)), t0)
            b = Vector((sx * (side_x + 0.45), 0, 2.38)).lerp(Vector((0, 0, 3.32)), t1)
            mid = (a + b) / 2
            slope = math.atan2(b.z - a.z, abs(b.x - a.x))
            parts.append(box('plank', ((b - a).length * 0.96, L + 0.6, 0.07), (mid.x, 0, mid.z + 0.05), rotation=(0, sx * slope, 0), color=tone(WOOD_LIGHT)))
        for k, y in enumerate((-2.2, -0.75, 0.7, 2.15)):
            c = Vector((sx * (side_x * 0.55 + 0.1), y + rng.uniform(-0.15, 0.15), 2.93 + rng.uniform(-0.02, 0.04)))
            slope = math.atan2(3.32 - 2.38, side_x + 0.45)
            parts.append(box('hide', (1.55 + rng.uniform(-0.1, 0.1), 1.35 + rng.uniform(-0.1, 0.15), 0.05), (c.x, c.y, c.z + 0.08), rotation=(0, sx * slope, rng.uniform(-0.06, 0.06)), color=tone(HIDE), bevel=0.04))
    # End boards (the back closed, the front open for the log).
    parts.append(box('backboard', (W, 0.08, 0.9), (0, 3.0, 2.0), color=tone(WOOD_LIGHT)))
    body = join('Body', parts)

    # The log, hung from the ridge, iron-headed; thrust along -y (forward).
    log_parts = [cylinder('log', 0.26, 6.6, (0, -0.4, 1.6), rotation=(math.pi / 2, 0, 0), color=tone(WOOD_LIGHT, 0.6), sides=12)]
    log_parts.append(cylinder('head', 0.33, 0.7, (0, -3.95, 1.6), rotation=(math.pi / 2, 0, 0), color=rgb(IRON), sides=12))
    bpy.ops.mesh.primitive_cone_add(vertices=12, radius1=0.33, radius2=0.12, depth=0.45, location=(0, -4.5, 1.6), rotation=(math.pi / 2, 0, 0))
    cone = bpy.context.active_object
    log_parts.append(finish(cone, rgb(IRON), 0.0))
    for y in (-2.6, -1.0, 0.8, 2.4):
        log_parts.append(cylinder('band', 0.28, 0.12, (0, y, 1.6), rotation=(math.pi / 2, 0, 0), color=rgb(IRON), sides=12))
    for y in (-1.8, 1.4):
        log_parts.append(rope_between('rope', (0, y, 1.85), (0, y + 0.1, 3.12)))
    log_obj = join('Log', log_parts)
    set_origin(log_obj, (0, -0.4, 1.6))

    wheels = [wheel(f'Wheel{n}', 0.55, 0.26, (sx * (side_x + 0.28), y, 0.55)) for n, sx, y in (('FL', -1, -1.9), ('FR', 1, -1.9), ('BL', -1, 1.9), ('BR', 1, 1.9))]
    return [body, log_obj, *wheels]


def build_catapult():
    parts = []
    L, W = 4.4, 1.9
    side_x = W / 2
    for sx in (-1, 1):
        parts.append(box('side', (0.32, L, 0.32), (sx * side_x, 0, 0.72)))
    for y in (-2.0, -0.2, 0.9, 2.0):
        parts.append(box('cross', (W + 0.32, 0.28, 0.28), (0, y, 0.76)))
    # Uprights carrying the stop bar, braced back to the frame.
    for sx in (-1, 1):
        parts.append(beam_between('upright', (sx * side_x, -0.25, 0.85), (sx * side_x, -0.55, 2.55), 0.26))
        parts.append(beam_between('brace', (sx * side_x, 0.85, 0.85), (sx * side_x, -0.45, 2.2), 0.2, tone(WOOD_WARM, 0.3)))
        parts.append(beam_between('brace', (sx * side_x, -1.9, 0.85), (sx * side_x, -0.5, 2.3), 0.18, tone(WOOD_WARM, 0.3)))
    parts.append(box('stop', (W + 0.5, 0.34, 0.34), (0, -0.58, 2.55), color=tone(WOOD_WARM, 0.45)))
    parts.append(box('pad', (0.6, 0.2, 0.36), (0, -0.4, 2.55), color=tone(HIDE)))
    # Torsion skeins on the axle, and the windlass at the back.
    for sx in (-1, 1):
        parts.append(cylinder('skein', 0.24, 0.42, (sx * 0.52, 0.9, 0.95), rotation=(0, math.pi / 2, 0), color=rgb(ROPE), sides=10))
    parts.append(cylinder('axle', 0.11, W + 0.3, (0, 0.9, 0.95), rotation=(0, math.pi / 2, 0), color=rgb(IRON), sides=8))
    parts.append(cylinder('windlass', 0.15, W, (0, 1.95, 1.05), rotation=(0, math.pi / 2, 0), color=tone(WOOD_LIGHT), sides=8))
    for sx in (-1, 1):
        for a in (0, math.pi / 2):
            c = Vector((sx * (side_x + 0.16), 1.95, 1.05))
            parts.append(beam_between('handle', c + Vector((0, math.cos(a) * 0.45, math.sin(a) * 0.45)), c - Vector((0, math.cos(a) * 0.45, math.sin(a) * 0.45)), 0.07, tone(WOOD_LIGHT, 0.5)))
    frame = join('Frame', parts)

    # The arm, cocked: from the axle back and slightly up to the cup, which holds a stone.
    pivot = Vector((0, 0.9, 0.95))
    tip = Vector((0, 4.2, 1.45))
    arm_parts = [beam_between('arm', pivot - (tip - pivot).normalized() * 0.25, tip, 0.24, tone(WOOD_WARM, 0.6))]
    cup = tip + Vector((0, 0.1, 0.1))
    arm_parts.append(box('cup', (0.62, 0.62, 0.16), cup, color=tone(WOOD_LIGHT, 0.3), bevel=0.04))
    for sx in (-1, 1):
        arm_parts.append(box('cupwall', (0.08, 0.62, 0.22), cup + Vector((sx * 0.29, 0, 0.12)), color=tone(WOOD_LIGHT, 0.3), bevel=0.0))
    for sy in (-1, 1):
        arm_parts.append(box('cupwall', (0.62, 0.08, 0.22), cup + Vector((0, sy * 0.29, 0.12)), color=tone(WOOD_LIGHT, 0.3), bevel=0.0))
    bpy.ops.mesh.primitive_ico_sphere_add(subdivisions=1, radius=0.24, location=cup + Vector((0, 0, 0.26)))
    stone = bpy.context.active_object
    arm_parts.append(finish(stone, rgb(STONE), 0.0, 0.12))
    for t in (0.3, 0.55):
        arm_parts.append(cylinder('band', 0.16, 0.1, pivot.lerp(tip, t), rotation=((tip - pivot).angle(Vector((0, 0, 1))) - math.pi / 2 + math.pi / 2, 0, 0), color=rgb(IRON), sides=8))
    arm = join('Arm', arm_parts)
    set_origin(arm, pivot)

    wheels = [wheel(f'Wheel{n}', 0.5, 0.24, (sx * (side_x + 0.28), y, 0.5)) for n, sx, y in (('FL', -1, -1.55), ('FR', 1, -1.55), ('BL', -1, 1.55), ('BR', 1, 1.55))]
    return [frame, arm, *wheels]


def build_siege_tower():
    """A three-storey tower on four wheels, planked and hide-covered in front and on the sides,
    open at the back on its ladders; the gangway (its own bone, hinged at the top platform's
    front edge) is modelled lowered, pointing forward."""
    parts = []
    half = 1.75
    top = TOWER_PLATFORM_M
    for sx in (-1, 1):
        for sy in (-1, 1):
            parts.append(box('post', (0.32, 0.32, top + 1.1), (sx * half, sy * half, 0.9 + (top + 1.1) / 2 - 0.9), color=tone(WOOD_WARM, 0.45)))
    for sx in (-1, 1):
        parts.append(box('chassis', (0.34, half * 2 + 0.6, 0.34), (sx * half, 0, 0.9)))
    for sy in (-1, 1):
        parts.append(box('chassis', (half * 2 + 0.3, 0.34, 0.34), (0, sy * half, 0.9)))
    # Floors (the top one is the fighting platform), with a hatch left open for the ladder.
    for z in (1.1, 4.7, 8.1, top):
        for k in range(6):
            y = -half + (k + 0.5) * (half * 2 / 6)
            if z != top and k == 5:
                continue
            parts.append(box('floor', (half * 2, half * 2 / 6 * 0.94, 0.1), (0, y, z), color=tone(WOOD_LIGHT), bevel=0.0))
    # Cladding: vertical boards on the front and the sides, hides over the front.
    boards = 7
    for k in range(boards):
        u = -half + (k + 0.5) * (half * 2 / boards)
        parts.append(box('board', (half * 2 / boards * 0.95, 0.08, top - 1.0), (u, -half - 0.12, 1.0 + (top - 1.0) / 2), color=tone(WOOD_LIGHT), bevel=0.0))
        for sx in (-1, 1):
            parts.append(box('board', (0.08, half * 2 / boards * 0.95, top - 1.0), (sx * (half + 0.12), u, 1.0 + (top - 1.0) / 2), color=tone(WOOD_LIGHT), bevel=0.0))
    for z in (3.0, 6.4):
        parts.append(box('hide', (half * 2 + 0.2, 0.06, 2.9), (0, -half - 0.2, z), color=tone(HIDE), bevel=0.03))
        for sx in (-1, 1):
            parts.append(box('hide', (0.06, half * 2 + 0.2, 2.9), (sx * (half + 0.2), 0, z), color=tone(HIDE), bevel=0.03))
    # Parapet round the top platform, open in front for the gangway.
    for sx in (-1, 1):
        parts.append(box('parapet', (0.1, half * 2, 1.0), (sx * half, 0, top + 0.5), color=tone(WOOD_LIGHT, 0.4), bevel=0.0))
    parts.append(box('parapet', (half * 2, 0.1, 1.0), (0, half, top + 0.5), color=tone(WOOD_LIGHT, 0.4), bevel=0.0))
    for sx in (-1, 1):
        parts.append(box('parapet', (0.6, 0.1, 1.0), (sx * (half - 0.3), -half, top + 0.5), color=tone(WOOD_LIGHT, 0.4), bevel=0.0))
    # Ladder up the open back.
    for sx in (-0.35, 0.35):
        parts.append(box('rail', (0.1, 0.1, top - 1.0), (sx, half - 0.25, 1.0 + (top - 1.0) / 2), color=tone(WOOD_WARM, 0.5), bevel=0.0))
    for k in range(int((top - 1.2) / 0.45)):
        parts.append(box('rung', (0.8, 0.07, 0.07), (0, half - 0.25, 1.4 + k * 0.45), color=tone(WOOD_WARM, 0.6), bevel=0.0))
    body = join('Body', parts)

    # The gangway, lowered: from the platform's front edge, forward (-y), level with the platform.
    hinge = Vector((0, -half - 0.1, top))
    gang = []
    length = 3.0
    for k in range(8):
        y = hinge.y - (k + 0.5) * (length / 8)
        gang.append(box('gangplank', (1.8, length / 8 * 0.92, 0.09), (0, y, top + 0.05), color=tone(WOOD_LIGHT), bevel=0.0))
    for sx in (-1, 1):
        gang.append(box('gangrail', (0.12, length, 0.16), (sx * 0.86, hinge.y - length / 2, top - 0.06), color=tone(WOOD_WARM, 0.5), bevel=0.0))
    gang.append(box('gangedge', (1.85, 0.12, 0.12), (0, hinge.y - length + 0.06, top - 0.02), color=rgb(IRON), bevel=0.0))
    gangway = join('Gangway', gang)
    set_origin(gangway, hinge)

    wheels = [wheel(f'Wheel{n}', 0.62, 0.3, (sx * (half + 0.3), y, 0.62)) for n, sx, y in (('FL', -1, -1.25), ('FR', 1, -1.25), ('BL', -1, 1.25), ('BR', 1, 1.25))]
    return [body, gangway, *wheels]


def export(name, objs, out_dir):
    """One skinned mesh per engine (one draw call): every part is weighted to its own bone, with
    its head on the part's pivot; the frame to the Body bone. Bones are siblings under the
    armature, so their parent space is the model space."""
    material = bpy.data.materials.get('Engine') or bpy.data.materials.new('Engine')
    arm_data = bpy.data.armatures.new(f'{name}-rig')
    rig = bpy.data.objects.new(name, arm_data)
    bpy.context.scene.collection.objects.link(rig)
    bpy.ops.object.select_all(action='DESELECT')
    bpy.context.view_layer.objects.active = rig
    rig.select_set(True)
    bpy.ops.object.mode_set(mode='EDIT')
    for o in objs:
        bone = arm_data.edit_bones.new(o.name)
        bone.head = o.location
        bone.tail = o.location + Vector((0, 0, 0.4))
    bpy.ops.object.mode_set(mode='OBJECT')
    tris = 0
    for o in objs:
        o.data.materials.clear()
        o.data.materials.append(material)
        group = o.vertex_groups.new(name=o.name)
        group.add(list(range(len(o.data.vertices))), 1.0, 'REPLACE')
        tris += sum(len(p.vertices) - 2 for p in o.data.polygons)
    mesh = join(f'{name}-mesh', objs)
    bpy.ops.object.select_all(action='DESELECT')
    mesh.select_set(True)
    bpy.context.view_layer.objects.active = mesh
    bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
    mod = mesh.modifiers.new('rig', 'ARMATURE')
    mod.object = rig
    mesh.parent = rig
    bpy.ops.object.select_all(action='DESELECT')
    rig.select_set(True)
    mesh.select_set(True)
    path = os.path.join(out_dir, f'{name}.glb')
    kwargs = dict(filepath=path, export_format='GLB', use_selection=True, export_yup=True, export_apply=True, export_normals=True, export_texcoords=False, export_materials='EXPORT', export_skins=True, export_animations=False)
    try:
        bpy.ops.export_scene.gltf(**kwargs, export_vertex_color='ACTIVE')
    except TypeError:
        bpy.ops.export_scene.gltf(**kwargs, export_colors=True)
    log(f'{name}: {len(arm_data.bones)} bones, {tris} triangles → {path}')
    bpy.data.objects.remove(mesh, do_unlink=True)
    bpy.data.objects.remove(rig, do_unlink=True)


def main():
    argv = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
    out_dir = argv[0] if argv else 'assets-src/work/engines'
    os.makedirs(out_dir, exist_ok=True)
    bpy.ops.wm.read_factory_settings(use_empty=True)
    export('ram', build_ram(), out_dir)
    export('catapult', build_catapult(), out_dir)
    export('siegeTower', build_siege_tower(), out_dir)


main()
