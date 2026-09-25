"""Headless preview of character GLBs side by side (Workbench, texture colours), for plank tests.

Usage: blender -b --factory-startup --python scripts/blender/preview_glb.py -- <out.png> <action> <a.glb> [...]
"""
import math
import os
import sys

import bpy
from mathutils import Vector

argv = sys.argv[sys.argv.index('--') + 1:]
out_png, action_name, *files = argv

bpy.ops.wm.read_factory_settings(use_empty=True)
scene = bpy.context.scene
x = 0.0
for path in files:
    before = set(bpy.data.objects)
    bpy.ops.import_scene.gltf(filepath=os.path.abspath(path))
    new = [o for o in bpy.data.objects if o not in before]
    roots = [o for o in new if o.parent is None]
    for r in roots:
        r.location.x += x
    for o in new:
        if o.type == 'ARMATURE' and o.animation_data is not None:
            act = next((a for a in bpy.data.actions if a.name.startswith(action_name)), None)
            if act:
                o.animation_data.action = act
    x += 1.6
    print('[preview] loaded', path, [o.name for o in new if o.type == 'MESH'])

scene.frame_set(20)
# Reference 1.8 m human silhouette (thin box) at the end of the row for scale.
bpy.ops.mesh.primitive_cube_add(size=1, location=(x, 0, 0.9))
bpy.context.object.scale = (0.4, 0.25, 1.8)

cam_data = bpy.data.cameras.new('cam')
cam_data.type = 'ORTHO'
cam_data.ortho_scale = max(4.0, x + 1.6)
cam = bpy.data.objects.new('cam', cam_data)
scene.collection.objects.link(cam)
cam.location = Vector(((x) / 2, -12, 1.4))
cam.rotation_euler = (math.radians(90), 0, 0)
scene.camera = cam
scene.render.engine = 'BLENDER_WORKBENCH'
scene.display.shading.light = 'STUDIO'
scene.display.shading.color_type = 'TEXTURE'
scene.render.resolution_x = 1600
scene.render.resolution_y = 900
scene.render.filepath = os.path.abspath(out_png)
bpy.ops.render.render(write_still=True)
print('[preview] wrote', out_png)
