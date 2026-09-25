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


def build_atlas(body, name, out_dir):
    """One material: weapon UVs move into the top-right quarter of a body+weapon atlas."""
    slots = body.material_slots
    main = next(i for i, s in enumerate(slots) if s.material.name == f'{name}_Texture')
    if len(slots) == 1:
        return
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
    build_atlas(body, name, out_dir)
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
