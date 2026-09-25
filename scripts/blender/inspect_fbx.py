"""Headless FBX inspection: meshes (triangles, materials, images), armatures (bones) and actions.

Usage: blender -b --factory-startup --python scripts/blender/inspect_fbx.py -- <file.fbx> [...]
"""
import sys

import bpy


def triangles(obj):
    mesh = obj.data
    return sum(len(p.vertices) - 2 for p in mesh.polygons)


def inspect(path):
    bpy.ops.wm.read_factory_settings(use_empty=True)
    bpy.ops.import_scene.fbx(filepath=path)
    print(f"=== {path}")
    for obj in bpy.data.objects:
        if obj.type == 'MESH':
            mats = [s.material.name if s.material else '-' for s in obj.material_slots]
            images = sorted({
                n.image.name
                for s in obj.material_slots if s.material and s.material.use_nodes
                for n in s.material.node_tree.nodes if n.type == 'TEX_IMAGE' and n.image
            })
            parent = obj.parent.name if obj.parent else '-'
            print(f"mesh {obj.name} tris={triangles(obj)} mats={mats} images={images} parent={parent} "
                  f"groups={len(obj.vertex_groups)} dims={tuple(round(d, 3) for d in obj.dimensions)}")
        elif obj.type == 'ARMATURE':
            bones = [b.name for b in obj.data.bones]
            print(f"armature {obj.name} bones={len(bones)} scale={tuple(round(s, 3) for s in obj.scale)}")
            print("  " + ", ".join(bones))
    for action in bpy.data.actions:
        start, end = action.frame_range
        print(f"action {action.name} frames={start:.0f}-{end:.0f}")


argv = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
for p in argv:
    inspect(p)
