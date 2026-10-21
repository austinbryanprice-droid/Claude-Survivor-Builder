import { CanvasTexture, Group, Sprite, SpriteMaterial, SRGBColorSpace, type Texture } from 'three';
import { angleDelta, wrapAngle } from '../shared/look';
import { colorForSlot } from '../shared/player-colors';
import type { PlayerId, RemotePose } from '../shared/protocol';
import { createAvatar, type Avatar } from './avatar';
import type { MaterialRegistry } from './materials';

/**
 * The other players in the world: one suit per seat in that seat's color, walking and turning as
 * their owner does, with a name tag over the head. Poses come from the network layer already
 * interpolated; this only dresses them. Nothing here allocates while the set of players stays
 * the same, so a quiet room costs nothing per frame.
 */

/** Height of the name tag's centre above the feet. */
const TAG_HEIGHT = 2.2;
const TAG_WIDTH = 1.7;
const TAG_ASPECT = 4;
/** Same easing the local suit uses to turn its body toward the view. */
const TURN_RATE = 16;

export interface RemotePlayers {
  readonly object: Group;
  /** Moves the suits to these poses, adding and removing players as the list changes. */
  update(dt: number, poses: readonly RemotePose[]): void;
  /** Who is on screen now, for tests and the debug hook. */
  list(): { id: PlayerId; name: string; slot: number; x: number; y: number; z: number }[];
  dispose(): void;
}

export interface RemotePlayersOptions {
  /** The stage's material registry: the suits are lit by the same sun, shadows and haze as the world. */
  registry: MaterialRegistry;
  /** Draws a name tag. Defaults to a canvas texture; tests pass a stand-in because they have no canvas. */
  drawTag?: (name: string, color: string) => Texture;
}

interface Entry {
  readonly avatar: Avatar;
  readonly tag: Sprite;
  readonly tagMaterial: SpriteMaterial;
  name: string;
  slot: number;
  bodyYaw: number;
  seen: boolean;
}

function drawTagWithCanvas(name: string, color: string): Texture {
  const canvas = document.createElement('canvas');
  canvas.width = 512;
  canvas.height = 128;
  const ctx = canvas.getContext('2d');
  if (ctx) {
    ctx.fillStyle = 'rgba(16, 22, 30, 0.82)';
    ctx.beginPath();
    ctx.roundRect(8, 24, 496, 80, 24);
    ctx.fill();
    ctx.lineWidth = 4;
    ctx.strokeStyle = color;
    ctx.stroke();
    ctx.font = '600 52px Merriweather, Georgia, "Times New Roman", serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = '#eef3f8';
    ctx.fillText(name, 256, 66, 456);
  }
  const texture = new CanvasTexture(canvas);
  texture.colorSpace = SRGBColorSpace;
  return texture;
}

export function createRemotePlayers({
  registry,
  drawTag = drawTagWithCanvas,
}: RemotePlayersOptions): RemotePlayers {
  const object = new Group();
  object.name = 'remote-players';
  const entries = new Map<PlayerId, Entry>();
  const avatarPose = { x: 0, y: 0, z: 0, bodyYaw: 0, speed: 0, onGround: true, pitch: 0 };

  const dressTag = (entry: Entry, name: string, slot: number): void => {
    const previous = entry.tagMaterial.map;
    entry.tagMaterial.map = drawTag(name, colorForSlot(slot).hex);
    entry.tagMaterial.needsUpdate = true;
    previous?.dispose();
  };

  const create = (pose: RemotePose): Entry => {
    const avatar = createAvatar(registry, { accent: colorForSlot(pose.slot).hex });
    const tagMaterial = new SpriteMaterial({
      transparent: true,
      depthTest: false,
      depthWrite: false,
      fog: false,
    });
    const tag = new Sprite(tagMaterial);
    tag.scale.set(TAG_WIDTH, TAG_WIDTH / TAG_ASPECT, 1);
    tag.renderOrder = 10;
    const group = new Group();
    group.add(avatar.object, tag);
    object.add(group);
    const entry: Entry = {
      avatar,
      tag,
      tagMaterial,
      name: pose.name,
      slot: pose.slot,
      bodyYaw: pose.yaw,
      seen: true,
    };
    dressTag(entry, pose.name, pose.slot);
    return entry;
  };

  return {
    object,

    update(dt, poses) {
      for (const entry of entries.values()) entry.seen = false;

      for (const pose of poses) {
        let entry = entries.get(pose.id);
        if (!entry) {
          entry = create(pose);
          entries.set(pose.id, entry);
        } else if (entry.name !== pose.name || entry.slot !== pose.slot) {
          // A seat can change hands (a returning player keeps theirs, a new one may take a freed one).
          entry.name = pose.name;
          entry.slot = pose.slot;
          dressTag(entry, pose.name, pose.slot);
        }
        entry.seen = true;
        entry.bodyYaw = wrapAngle(
          entry.bodyYaw + angleDelta(entry.bodyYaw, pose.yaw) * (1 - Math.exp(-TURN_RATE * dt)),
        );
        avatarPose.x = pose.x;
        avatarPose.y = pose.y;
        avatarPose.z = pose.z;
        avatarPose.bodyYaw = entry.bodyYaw;
        avatarPose.speed = pose.speed;
        avatarPose.onGround = pose.onGround;
        avatarPose.pitch = pose.pitch;
        entry.avatar.update(dt, avatarPose);
        entry.tag.position.set(pose.x, pose.y + TAG_HEIGHT, pose.z);
      }

      for (const [id, entry] of entries) {
        if (entry.seen) continue;
        entries.delete(id);
        entry.avatar.object.parent?.removeFromParent();
        entry.avatar.dispose();
        entry.tagMaterial.map?.dispose();
        entry.tagMaterial.dispose();
      }
    },

    list() {
      return [...entries.entries()].map(([id, entry]) => ({
        id,
        name: entry.name,
        slot: entry.slot,
        x: entry.avatar.object.position.x,
        y: entry.avatar.object.position.y,
        z: entry.avatar.object.position.z,
      }));
    },

    dispose() {
      for (const entry of entries.values()) {
        entry.avatar.dispose();
        entry.tagMaterial.map?.dispose();
        entry.tagMaterial.dispose();
      }
      entries.clear();
      object.clear();
      object.removeFromParent();
    },
  };
}
