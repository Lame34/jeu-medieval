/**
 * The moat's mirror (ADR-055, high preset): still water reflects the walls, the towers, the trees
 * and the sky. The scene is rendered from the camera mirrored in the water's plane, at a share of
 * the screen's resolution, with an oblique near plane on the water so that nothing under it is
 * drawn (E. Lengyel's oblique frustum, as three's Reflector does); the water samples that image
 * through `textureMatrix`. Objects that would only cost there or show amiss (the water itself, the
 * grass, the crops' tufts, the men's see-through silhouettes…) live on a layer that the mirror's
 * camera does not see. The shadow maps are not redrawn for it.
 */
import { HalfFloatType, Matrix4, PerspectiveCamera, Plane, Vector2, Vector3, Vector4, WebGLRenderTarget, type Object3D, type Scene, type WebGLRenderer } from 'three';

/** The layer of what the mirror does not show: the view's camera sees it too (GameCanvas), the mirror's only layer 0. */
export const MIRROR_HIDDEN_LAYER = 1;

/** Keeps an object out of the mirror (it stays in the view and in the shadow maps). */
export function keepOutOfReflections(object: Object3D): void {
  object.layers.set(MIRROR_HIDDEN_LAYER);
}

/** Offsets the oblique near plane a little (clip space), so the banks' foot does not flicker. */
const CLIP_BIAS = 0.003;
const UP = new Vector3(0, 1, 0);
/** Clip space to texture space. */
const TO_TEXTURE = new Matrix4().set(0.5, 0, 0, 0.5, 0, 0.5, 0, 0.5, 0, 0, 0.5, 0.5, 0, 0, 0, 1);

export class PlanarReflection {
  readonly target = new WebGLRenderTarget(1, 1, { type: HalfFloatType });
  /** World position to the mirror image's texture coordinates (projective). */
  readonly textureMatrix = new Matrix4();
  private readonly camera = new PerspectiveCamera();
  private readonly planePoint: Vector3;
  private readonly plane = new Plane();
  private readonly clipPlane = new Vector4();
  private readonly q = new Vector4();
  private readonly cameraPosition = new Vector3();
  private readonly lookAt = new Vector3();
  private readonly mirrored = new Vector3();
  private readonly rotation = new Matrix4();
  private readonly size = new Vector2();
  /** The mirror's resolution, as a share of the drawing buffer's. */
  private readonly scale: number;

  constructor(levelM: number, scale: number) {
    this.planePoint = new Vector3(0, levelM, 0);
    this.scale = scale;
  }

  /** Renders the mirror image for `viewer` (call before the frame's own render); false when the viewer is under the water's plane. */
  render(gl: WebGLRenderer, scene: Scene, viewer: PerspectiveCamera): boolean {
    this.cameraPosition.setFromMatrixPosition(viewer.matrixWorld);
    if (this.cameraPosition.y <= this.planePoint.y) return false;
    gl.getDrawingBufferSize(this.size);
    const width = Math.max(1, Math.round(this.size.x * this.scale));
    const height = Math.max(1, Math.round(this.size.y * this.scale));
    if (this.target.width !== width || this.target.height !== height) this.target.setSize(width, height);

    // The viewer mirrored in the plane, looking at its mirrored target, its up mirrored.
    this.mirrored.subVectors(this.planePoint, this.cameraPosition).reflect(UP).negate().add(this.planePoint);
    this.rotation.extractRotation(viewer.matrixWorld);
    this.lookAt.set(0, 0, -1).applyMatrix4(this.rotation).add(this.cameraPosition);
    this.lookAt.subVectors(this.planePoint, this.lookAt).reflect(UP).negate().add(this.planePoint);
    const camera = this.camera;
    camera.position.copy(this.mirrored);
    camera.up.set(0, 1, 0).applyMatrix4(this.rotation).reflect(UP);
    camera.lookAt(this.lookAt);
    camera.near = viewer.near;
    camera.far = viewer.far;
    camera.updateMatrixWorld();
    camera.projectionMatrix.copy(viewer.projectionMatrix);
    this.textureMatrix.copy(TO_TEXTURE).multiply(camera.projectionMatrix).multiply(camera.matrixWorldInverse);

    // The near plane laid on the water (in the mirror camera's view space).
    this.plane.setFromNormalAndCoplanarPoint(UP, this.planePoint).applyMatrix4(camera.matrixWorldInverse);
    this.clipPlane.set(this.plane.normal.x, this.plane.normal.y, this.plane.normal.z, this.plane.constant);
    const p = camera.projectionMatrix.elements;
    this.q.set((Math.sign(this.clipPlane.x) + (p[8] as number)) / (p[0] as number), (Math.sign(this.clipPlane.y) + (p[9] as number)) / (p[5] as number), -1, (1 + (p[10] as number)) / (p[14] as number));
    this.clipPlane.multiplyScalar(2 / this.clipPlane.dot(this.q));
    p[2] = this.clipPlane.x;
    p[6] = this.clipPlane.y;
    p[10] = this.clipPlane.z + 1 - CLIP_BIAS;
    p[14] = this.clipPlane.w;
    camera.projectionMatrixInverse.copy(camera.projectionMatrix).invert();

    const target = gl.getRenderTarget();
    const autoClear = gl.autoClear;
    const shadows = gl.shadowMap.needsUpdate;
    gl.shadowMap.needsUpdate = false;
    gl.autoClear = true;
    gl.setRenderTarget(this.target);
    gl.render(scene, camera);
    gl.setRenderTarget(target);
    gl.autoClear = autoClear;
    gl.shadowMap.needsUpdate = shadows;
    return true;
  }

  dispose(): void {
    this.target.dispose();
  }
}
