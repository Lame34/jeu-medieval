"""Quaternius « RPG Characters » (CC0, FBX) → GLB for the asset pipeline (ADR-014).

Per character: import the FBX, relink the painted textures, turn bone-parented props (face,
pauldrons, weapon…) into rigid skinned parts, retune the proportions (smaller head, longer
legs: ~2.8 → ~3.6 heads, brief §5.1 « légèrement héroïques ») by editing the rest pose, pack
body and weapon textures into one atlas (one material, one draw call per unit) and export one
GLB per body (mesh + skeleton, no clips). Every body shares one 44-bone rig: the clips of all
of them are merged into one animation library (rpg-animations.glb, short names).

Usage: blender -b --factory-startup --python scripts/blender/convert_rpg_characters.py -- \
         <pack dir> <out dir> [Name ...]
"""
import os
import re
import sys

import bmesh
import bpy
import numpy as np
from mathutils import Vector

HEAD_SCALE = 0.8
LEG_SCALE = 1.12
ACTION_PREFIX = 'CharacterArmature|CharacterArmature|'
DEFAULT_NAMES = ['Warrior', 'Ranger', 'Rogue']
# Atlas: body texture on the left (1024²), weapon texture top-right (512²).
BODY_PX = 1024
WEAPON_PX = 512
ATLAS_W = BODY_PX + WEAPON_PX
ATLAS_H = BODY_PX
UV_TOLERANCE = 1e-3
# Tabard (brief §6.5: allegiance on tabards): painted in the free bottom-right quarter of the
# atlas in a key colour no source texture uses (magenta, hue 0.83), recoloured per faction at
# runtime like the cloth; the gold border and chevron follow the gold rule (iron for defenders).
TABARD_KEY = (0.46, 0.12, 0.40)
TABARD_GOLD = (0.78, 0.60, 0.22)
TABARD_COLUMNS = 4
TABARD_ROWS = 8
EYE_COLOR = (0.17, 0.12, 0.08)
TRUNK_BONES = ('Body', 'Hips', 'Abdomen', 'Torso', 'Neck', 'Shoulder.L', 'Shoulder.R', 'UpperLeg.L', 'UpperLeg.R')


def log(*args):
    print('[rpg]', *args, flush=True)


def armature_object():
    arms = [o for o in bpy.data.objects if o.type == 'ARMATURE']
    if len(arms) != 1:
        raise RuntimeError(f'expected one armature, found {len(arms)}')
    return arms[0]


def relink_textures(tex_dir, name):
    for mat in bpy.data.materials:
        if not mat.use_nodes:
            continue
        candidates = [f'{mat.name}.png', f'{name}_{mat.name}.png']
        path = next((os.path.join(tex_dir, c) for c in candidates if os.path.exists(os.path.join(tex_dir, c))), None)
        if path is None:
            raise RuntimeError(f'no texture for material {mat.name}')
        nodes = mat.node_tree.nodes
        bsdf = next(n for n in nodes if n.type == 'BSDF_PRINCIPLED')
        tex = nodes.new('ShaderNodeTexImage')
        tex.image = bpy.data.images.load(os.path.abspath(path))
        mat.node_tree.links.new(tex.outputs['Color'], bsdf.inputs['Base Color'])
        # Painted pipeline keeps albedo only: flat, rough, non-metallic.
        bsdf.inputs['Metallic'].default_value = 0.0
        bsdf.inputs['Roughness'].default_value = 1.0
        log('texture', mat.name, '->', os.path.basename(path))


def rigidify_bone_children(arm):
    """Bone-parented meshes become skinned parts weighted 100 % to their bone."""
    for obj in [o for o in bpy.data.objects if o.type == 'MESH' and o.parent == arm]:
        has_mod = any(m.type == 'ARMATURE' for m in obj.modifiers)
        if obj.parent_type == 'BONE':
            bone = obj.parent_bone
            world = obj.matrix_world.copy()
            obj.parent_type = 'OBJECT'
            obj.parent_bone = ''
            obj.matrix_world = world
            group = obj.vertex_groups.new(name=bone)
            group.add(list(range(len(obj.data.vertices))), 1.0, 'REPLACE')
            log('rigid part', obj.name, '->', bone)
        elif not has_mod and len(obj.vertex_groups) == 0:
            raise RuntimeError(f'{obj.name}: parented to the armature without skin or bone')
        if not any(m.type == 'ARMATURE' for m in obj.modifiers):
            mod = obj.modifiers.new('Armature', 'ARMATURE')
            mod.object = arm


def select_only(obj):
    if bpy.context.object and bpy.context.object.mode != 'OBJECT':
        bpy.ops.object.mode_set(mode='OBJECT')
    for o in bpy.data.objects:
        o.select_set(False)
    obj.select_set(True)
    bpy.context.view_layer.objects.active = obj


def retune_proportions(arm):
    """Edits the rest pose: bake the posed mesh, then apply the pose as the new rest pose."""
    if arm.animation_data:
        arm.animation_data.action = None
    bones = arm.pose.bones
    for pb in bones:
        pb.location = (0, 0, 0)
        pb.rotation_quaternion = (1, 0, 0, 0)
        pb.rotation_euler = (0, 0, 0)
        pb.scale = (1, 1, 1)
    bones['Head'].scale = (HEAD_SCALE,) * 3
    # Leg chains stretch along the bone axis; the body rises so the ankles meet the IK feet.
    leg_len = 0.0
    for side in ('L', 'R'):
        upper = arm.data.bones[f'UpperLeg.{side}']
        lower = arm.data.bones[f'LowerLeg.{side}']
        leg_len = max(leg_len, (upper.tail_local - upper.head_local).length + (lower.tail_local - lower.head_local).length)
        bones[f'UpperLeg.{side}'].scale = (1, LEG_SCALE, 1)
    lift = (LEG_SCALE - 1) * leg_len
    body = arm.data.bones['Body']
    # Pose location is in the bone's rest frame: express the world-up lift in it.
    up_armature = arm.matrix_world.inverted().to_3x3() @ Vector((0, 0, lift))
    bones['Body'].location = body.matrix_local.to_3x3().inverted() @ up_armature
    bpy.context.view_layer.update()
    log(f'lift {lift:.3f} (leg {leg_len:.3f})')

    for obj in [o for o in bpy.data.objects if o.type == 'MESH']:
        select_only(obj)
        mod = next(m for m in obj.modifiers if m.type == 'ARMATURE')
        bpy.ops.object.modifier_apply(modifier=mod.name)
        new = obj.modifiers.new('Armature', 'ARMATURE')
        new.object = arm
    select_only(arm)
    bpy.ops.object.mode_set(mode='POSE')
    bpy.ops.pose.select_all(action='SELECT')
    bpy.ops.pose.armature_apply(selected=False)
    bpy.ops.object.mode_set(mode='OBJECT')


def rename_actions():
    for action in bpy.data.actions:
        if action.name.startswith(ACTION_PREFIX):
            action.name = action.name[len(ACTION_PREFIX):]
        action.use_fake_user = True


def join_meshes(arm, name):
    meshes = [o for o in bpy.data.objects if o.type == 'MESH']
    select_only(meshes[0])
    for o in meshes[1:]:
        o.select_set(True)
    bpy.ops.object.join()
    body = bpy.context.view_layer.objects.active
    body.name = name
    body.data.name = name
    # One armature modifier after the join.
    mods = [m for m in body.modifiers if m.type == 'ARMATURE']
    for m in mods[1:]:
        body.modifiers.remove(m)
    return body


def height_of(obj):
    zs = [(obj.matrix_world @ v.co).z for v in obj.data.vertices]
    return max(zs) - min(zs)


def image_rgba(image, size):
    if image.size[0] != size or image.size[1] != size:
        image.scale(size, size)
    px = np.empty(size * size * 4, dtype=np.float32)
    image.pixels.foreach_get(px)
    return px.reshape(size, size, 4)


def build_atlas(body, arm, name, out_dir):
    """One material: weapon UVs move into the top-right quarter of a body+weapon atlas; the
    bottom-right quarter carries the tabard; the eyes are painted on the face."""
    slots = body.material_slots
    main = next(i for i, s in enumerate(slots) if s.material.name == f'{name}_Texture')
    tex_of = lambda mat: next(n.image for n in mat.node_tree.nodes if n.type == 'TEX_IMAGE')
    atlas_px = np.zeros((ATLAS_H, ATLAS_W, 4), dtype=np.float32)
    atlas_px[..., 3] = 1
    body_px = image_rgba(tex_of(slots[main].material), BODY_PX)
    atlas_px[:, :BODY_PX] = body_px
    weapon_slots = [i for i in range(len(slots)) if i != main]
    if len(weapon_slots) != 1:
        raise RuntimeError(f'{name}: expected one weapon material, got {len(weapon_slots)}')
    atlas_px[ATLAS_H - WEAPON_PX:, BODY_PX:] = image_rgba(tex_of(slots[weapon_slots[0]].material), WEAPON_PX)
    # Unused bottom-right quarter: body mean colour (mip-map bleeding stays neutral).
    atlas_px[:ATLAS_H - WEAPON_PX, BODY_PX:] = body_px.reshape(-1, 4).mean(axis=0)

    uv = body.data.uv_layers.active.data
    lo, hi = np.inf, -np.inf
    for poly in body.data.polygons:
        for li in poly.loop_indices:
            u, v = uv[li].uv
            lo, hi = min(lo, u, v), max(hi, u, v)
            if poly.material_index == main:
                uv[li].uv = (u * BODY_PX / ATLAS_W, v)
            else:
                uv[li].uv = ((BODY_PX + u * WEAPON_PX) / ATLAS_W, 1 - WEAPON_PX / ATLAS_H + v * WEAPON_PX / ATLAS_H)
        poly.material_index = main
    if lo < -UV_TOLERANCE or hi > 1 + UV_TOLERANCE:
        raise RuntimeError(f'{name}: UVs outside [0, 1] ({lo:.3f}..{hi:.3f}), cannot atlas')

    paint_eyes(body, arm, name, atlas_px)
    add_tabard(body, arm, name, atlas_px, main)

    atlas = bpy.data.images.new(f'{name}_Atlas', ATLAS_W, ATLAS_H, alpha=False)
    atlas.pixels.foreach_set(atlas_px.ravel())
    atlas.filepath_raw = os.path.abspath(os.path.join(out_dir, f'{name.lower()}_atlas.png'))
    atlas.file_format = 'PNG'
    atlas.save()
    mat = slots[main].material
    next(n for n in mat.node_tree.nodes if n.type == 'TEX_IMAGE').image = atlas
    mat.name = f'{name}_Atlas'
    for i in sorted(weapon_slots, reverse=True):
        body.active_material_index = i
        bpy.ops.object.material_slot_remove()
    log(name, f'atlas {ATLAS_W}x{ATLAS_H}, uv range {lo:.3f}..{hi:.3f}')


def bone_world(arm, name, tail=False):
    bone = arm.data.bones[name]
    return arm.matrix_world @ (bone.tail_local if tail else bone.head_local)


def facing_sign(arm):
    """-1 when the character faces -Y (its right hand on -X), +1 otherwise."""
    return -1.0 if bone_world(arm, 'Fist.R').x < bone_world(arm, 'Fist.L').x else 1.0


def paint_disc(px, u, v, radius_px, color):
    h, w = px.shape[:2]
    cx, cy = u * w, v * h
    r = int(radius_px) + 2
    for y in range(max(0, int(cy) - r), min(h, int(cy) + r + 1)):
        for x in range(max(0, int(cx) - r), min(w, int(cx) + r + 1)):
            d = ((x + 0.5 - cx) ** 2 + (y + 0.5 - cy) ** 2) ** 0.5
            a = min(1.0, max(0.0, radius_px + 0.5 - d))
            if a > 0:
                px[y, x, :3] = px[y, x, :3] * (1 - a) + np.array(color) * a


def paint_eyes(body, arm, name, px):
    """Two dark eyes where the face looks forward at eye level (the faces ship blank)."""
    front = facing_sign(arm)
    head = bone_world(arm, 'Head')
    head_h = bone_world(arm, 'Head_end').z - head.z
    eye_z = head.z + 0.42 * head_h
    mesh = body.data
    m = body.matrix_world
    nm = m.to_3x3().inverted().transposed()
    uv = mesh.uv_layers.active.data
    best = {}
    for poly in mesh.polygons:
        c = m @ poly.center
        n = (nm @ poly.normal).normalized()
        if abs(c.z - eye_z) > 0.12 * head_h or n.y * front < 0.6:
            continue
        dx = c.x - head.x
        if not 0.05 * head_h < abs(dx) < 0.3 * head_h:
            continue
        side = 'L' if dx > 0 else 'R'
        # Frontmost face polygon, preferably at the usual eye spacing.
        score = c.y * front - 0.3 * abs(abs(dx) - 0.16 * head_h)
        if side not in best or score > best[side][0]:
            u = sum(uv[li].uv[0] for li in poly.loop_indices) / poly.loop_total
            v = sum(uv[li].uv[1] for li in poly.loop_indices) / poly.loop_total
            best[side] = (score, u, v)
    for _, u, v in best.values():
        paint_disc(px, u, v, 5.5, EYE_COLOR)
    log(name, 'eyes painted on', sorted(best))


def add_tabard(body, arm, name, px, material_index):
    """Front and back cloth panels hugging the torso and hanging to mid-thigh, each band rigid
    to its bone (torso, abdomen, hips)."""
    front = facing_sign(arm)
    m = body.matrix_world
    # Body surface = vertices ruled by the trunk and pelvis only: the weapon and the hands pass
    # in front of the belt in the rest pose and would pull the cloth off the body.
    trunk = {body.vertex_groups[n].index for n in TRUNK_BONES if n in body.vertex_groups}

    def dominant(v):
        return max(v.groups, key=lambda g: g.weight).group if len(v.groups) else -1

    verts = np.array([tuple(m @ v.co) for v in body.data.vertices if dominant(v) in trunk], dtype=np.float64)
    hips = bone_world(arm, 'Hips')
    torso = bone_world(arm, 'Torso')
    shoulder_l = bone_world(arm, 'UpperArm.L')
    shoulder_r = bone_world(arm, 'UpperArm.R')
    knee = bone_world(arm, 'LowerLeg.L')
    span = shoulder_l.z - knee.z
    width = 0.72 * abs(shoulder_l.x - shoulder_r.x)
    z_top = shoulder_l.z - 0.35 * (shoulder_l.z - torso.z)
    z_belt = hips.z
    z_bottom = knee.z + 0.4 * (hips.z - knee.z)
    cx = hips.x
    reach = 0.06 * span
    offset = 0.018 * span

    def extreme_y(x, z, side):
        near = verts[(np.abs(verts[:, 0] - x) < reach) & (np.abs(verts[:, 2] - z) < reach)]
        if len(near) == 0:
            near = verts[(np.abs(verts[:, 0] - cx) < reach) & (np.abs(verts[:, 2] - z) < reach)]
        return near[:, 1].min() if side < 0 else near[:, 1].max()

    row_z = [z_top + (z_bottom - z_top) * r / TABARD_ROWS for r in range(TABARD_ROWS + 1)]
    belt_row = max(r for r, z in enumerate(row_z) if z >= z_belt)
    bm = bmesh.new()
    bm.from_mesh(body.data)
    uv_layer = bm.loops.layers.uv.active
    deform = bm.verts.layers.deform.verify()
    groups = {n: body.vertex_groups[n].index for n in ('Torso', 'Abdomen', 'Hips')}
    to_local = m.inverted()
    for side in (front, -front):
        grid = []
        for r, z in enumerate(row_z):
            row = []
            for c in range(TABARD_COLUMNS + 1):
                x = cx - width / 2 + width * c / TABARD_COLUMNS
                if r <= belt_row:
                    y = extreme_y(x, z, side) + side * offset
                else:
                    # Below the belt the cloth hangs straight, drifting a little off the legs.
                    y = grid[belt_row][c][1] + side * offset * 0.8 * (z_belt - z) / (z_belt - z_bottom)
                vert = bm.verts.new(to_local @ Vector((x, y, z)))
                bone = 'Torso' if z >= torso.z else ('Abdomen' if z >= hips.z else 'Hips')
                vert[deform][groups[bone]] = 1.0
                row.append((vert, y))
            grid.append(row)
        for r in range(TABARD_ROWS):
            for c in range(TABARD_COLUMNS):
                corners = [(r + 1, c), (r + 1, c + 1), (r, c + 1), (r, c)]
                # Outward normals: the winding flips with the side the panel faces.
                if side > 0:
                    corners.reverse()
                face = bm.faces.new([grid[rr][cc][0] for rr, cc in corners])
                face.material_index = material_index
                face.smooth = True
                for loop, (rr, cc) in zip(face.loops, corners):
                    u = (BODY_PX + (cc / TABARD_COLUMNS) * WEAPON_PX) / ATLAS_W
                    v = (1 - rr / TABARD_ROWS) * (ATLAS_H - WEAPON_PX) / ATLAS_H
                    loop[uv_layer].uv = (u, v)
    bm.normal_update()
    bm.to_mesh(body.data)
    bm.free()
    paint_tabard(px)
    log(name, f'tabard {width:.2f} m wide, {z_top - z_bottom:.2f} m long')


def paint_tabard(px):
    """Key-coloured field with a gold border and chevron, lightly brushed (painted, not flat)."""
    region = px[: ATLAS_H - WEAPON_PX, BODY_PX:]
    h, w = region.shape[:2]
    rng = np.random.default_rng(7)
    noise = np.kron(rng.normal(0.0, 1.0, (h // 16 + 1, w // 16 + 1)), np.ones((16, 16)))[:h, :w]
    ys, xs = np.mgrid[0:h, 0:w]
    u = xs / w
    v = ys / h
    field = np.array(TABARD_KEY)[None, None, :] * (1 + 0.06 * noise[..., None])
    gold = np.array(TABARD_GOLD)[None, None, :] * (1 + 0.05 * noise[..., None])
    border = (u < 0.07) | (u > 0.93) | (v < 0.05)
    # Chevron pointing up on the chest (v grows upwards: row 0 is the hem).
    chevron = np.abs(v - (0.62 - 0.55 * np.abs(u - 0.5))) < 0.045
    region[..., :3] = np.clip(np.where((border | chevron)[..., None], gold, field), 0, 1)
    region[..., 3] = 1


def rest_signature(arm):
    return tuple(
        (b.name, tuple(round(c, 4) for c in b.head_local), tuple(round(c, 4) for c in b.tail_local))
        for b in arm.data.bones
    )


def short_name(action_name):
    """'CharacterArmature.001|CharacterArmature.001|Bow_Attack_Draw.001' → 'Bow_Attack_Draw'."""
    return re.sub(r'\.\d{3}$', '', action_name.split('|')[-1])


def build_animation_library(pack_dir, out_dir, names):
    """Clips of every body on the first body's retuned armature (rigs must match exactly)."""
    bpy.ops.wm.read_factory_settings(use_empty=True)
    bpy.ops.import_scene.fbx(filepath=os.path.join(pack_dir, 'FBX', f'{names[0]}.fbx'))
    arm = armature_object()
    signature = rest_signature(arm)
    rigidify_bone_children(arm)
    retune_proportions(arm)
    rename_actions()
    for other in names[1:]:
        before_objects = set(bpy.data.objects)
        before_actions = set(bpy.data.actions)
        bpy.ops.import_scene.fbx(filepath=os.path.join(pack_dir, 'FBX', f'{other}.fbx'))
        new_objects = [o for o in bpy.data.objects if o not in before_objects]
        other_arm = next(o for o in new_objects if o.type == 'ARMATURE')
        if rest_signature(other_arm) != signature:
            raise RuntimeError(f'{other}: rest pose differs from {names[0]}, clips cannot be shared')
        existing = {a.name for a in before_actions}
        for action in [a for a in bpy.data.actions if a not in before_actions]:
            short = short_name(action.name)
            if short in existing:
                bpy.data.actions.remove(action)
            else:
                action.name = short
                action.use_fake_user = True
                existing.add(short)
                log('clip', short, 'from', other)
        for o in new_objects:
            bpy.data.objects.remove(o, do_unlink=True)
    for o in [o for o in bpy.data.objects if o.type == 'MESH']:
        bpy.data.objects.remove(o, do_unlink=True)
    if arm.animation_data:
        arm.animation_data.action = None
    select_only(arm)
    out = os.path.join(out_dir, 'rpg-animations.glb')
    bpy.ops.export_scene.gltf(
        filepath=out,
        export_format='GLB',
        use_selection=True,
        export_yup=True,
        export_animations=True,
        export_animation_mode='ACTIONS',
        export_force_sampling=True,
        export_frame_step=1,
        export_skins=True,
        export_morph=False,
        export_materials='NONE',
    )
    log('wrote', out, 'clips', sorted(a.name for a in bpy.data.actions))


def convert(pack_dir, out_dir, name):
    bpy.ops.wm.read_factory_settings(use_empty=True)
    bpy.ops.import_scene.fbx(filepath=os.path.join(pack_dir, 'FBX', f'{name}.fbx'))
    arm = armature_object()
    relink_textures(os.path.join(pack_dir, 'Textures'), name)
    rigidify_bone_children(arm)
    retune_proportions(arm)
    rename_actions()
    body = join_meshes(arm, name)
    build_atlas(body, arm, name, out_dir)
    log(name, f'height {height_of(body):.3f}', f'tris {sum(len(p.vertices) - 2 for p in body.data.polygons)}')
    out = os.path.join(out_dir, f'{name.lower()}.glb')
    select_only(arm)
    body.select_set(True)
    bpy.ops.export_scene.gltf(
        filepath=out,
        export_format='GLB',
        use_selection=True,
        export_yup=True,
        export_apply=False,
        export_animations=False,
        export_skins=True,
        export_all_influences=False,
        export_morph=False,
        export_materials='EXPORT',
        export_image_format='AUTO',
    )
    log('wrote', out)


def main():
    argv = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
    if len(argv) < 2:
        raise SystemExit('usage: -- <pack dir> <out dir> [Name ...]')
    pack_dir, out_dir, *names = argv
    os.makedirs(out_dir, exist_ok=True)
    names = names or DEFAULT_NAMES
    for name in names:
        convert(pack_dir, out_dir, name)
    build_animation_library(pack_dir, out_dir, names)


main()
