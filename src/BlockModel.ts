import { glMatrix, mat4, vec3 } from "gl-matrix";
import { TextureUVProvider } from "./BlockAtlas";
import { mergeFloat32Arrays } from "./Util";

type Direction = 'up' | 'down' | 'north' | 'east' | 'south' | 'west'

type BlockModelFace = {
  texture: string
  uv?: number[]
  rotation?: 0 | 90 | 180 | 270
}

type BlockModelElement = {
  from: number[]
  to: number[]
  rotation?: {
    origin: [number, number, number]
    axis: 'x' | 'y' | 'z'
    angle: number
  }
  faces?: {
    [key in Direction]: BlockModelFace
  }
}

const faceRotations = {
  0: [0, 3, 2, 3, 2, 1, 0, 1],
  90: [2, 3, 2, 1, 0, 1, 0, 3],
  180: [2, 1, 0, 1, 0, 3, 2, 3],
  270: [0, 1, 0, 3, 2, 3, 2, 1],
}

export interface BlockModelProvider {
  getBlockModel(id: string): BlockModel | null
}

export class BlockModel {
  private flattened: boolean
  constructor(
    private id: string,
    private parent: string | undefined,
    private textures: { [key: string]: string } | undefined,
    private elements: BlockModelElement[] | undefined,
  ) {
    this.flattened = false
  }

  public getBuffers(uvProvider: TextureUVProvider, offset: number) {
    const position: number[] = []
    const texCoord: number[] = []
    const index: number[] = []

    for (const element of this.elements ?? []) {
      const buffers = this.getElementBuffers(element, offset, uvProvider)
      position.push(...buffers.position)
      texCoord.push(...buffers.texCoord)
      index.push(...buffers.index)
      offset += buffers.texCoord.length / 2
    }

    return {
      position,
      texCoord,
      index
    }
  }

  private getElementBuffers(e: BlockModelElement, i: number, uvProvider: TextureUVProvider) {
    const x0 = e.from[0]
    const y0 = e.from[1]
    const z0 = e.from[2]
    const x1 = e.to[0]
    const y1 = e.to[1]
    const z1 = e.to[2]

    const positions: number[] = []
    const texCoords: number[] = []
    const indices: number[] = []

    const p = uvProvider.part / 16

    const addFace = (face: BlockModelFace, uv: number[], pos: number[]) => {
      const [u0, v0] = uvProvider.getUV(this.getTexture(face.texture))
      ;(face.uv ?? uv).forEach((e, i) => uv[i] = p * e)
      const r = faceRotations[face.rotation ?? 0]
      texCoords.push(
        u0 + uv[r[0]], v0 + uv[r[1]],
        u0 + uv[r[2]], v0 + uv[r[3]],
        u0 + uv[r[4]], v0 + uv[r[5]],
        u0 + uv[r[6]], v0 + uv[r[7]])
      positions.push(...pos)
      indices.push(i, i+1, i+2,  i, i+2, i+3)
      i += 4
    }

    if (e.faces?.up?.texture) {
      addFace(e.faces.up, [16 - x1, z1, 16 - x0, z0],
        [x0, y1, z1,  x1, y1, z1,  x1, y1, z0,  x0, y1, z0])
    }
    if (e.faces?.down?.texture) {
      addFace(e.faces.down, [16 - z1, 16 - x1, 16 - z0, 16 - x0],
        [x0, y0, z0,  x1, y0, z0,  x1, y0, z1,  x0, y0, z1])
    }
    if (e.faces?.south?.texture) {
      addFace(e.faces.south, [x0, 16 - y1, x1, 16 - y0], 
        [x0, y0, z1,  x1, y0, z1,  x1, y1, z1,  x0, y1, z1])
    }
    if (e.faces?.north?.texture) {
      addFace(e.faces.north, [16 - x1, 16 - y1, 16 - x0, 16 - y0], 
        [x1, y0, z0,  x0, y0, z0,  x0, y1, z0,  x1, y1, z0])
    }
    if (e.faces?.east?.texture) {
      addFace(e.faces.east, [16 - z1, 16 - y1, 16 - z0, 16 - y0], 
        [x1, y0, z1,  x1, y0, z0,  x1, y1, z0,  x1, y1, z1])
    }
    if (e.faces?.west?.texture) {
      addFace(e.faces.west, [z0, 16 - y1, z1, 16 - y0], 
        [x0, y0, z0,  x0, y0, z1,  x0, y1, z1,  x0, y1, z0])
    }

    const t = mat4.create()
    mat4.identity(t)
    if (e.rotation) {
      const origin = vec3.fromValues(...e.rotation.origin)
      mat4.translate(t, t, origin)
      mat4.rotate(t, t, glMatrix.toRadian(e.rotation.angle),
        e.rotation.axis === 'y' ? [0, 1, 0] : e.rotation.axis === 'x' ? [1, 0, 0] : [0, 0, 1])
      vec3.negate(origin, origin)
      mat4.translate(t, t, origin)
    }

    return {
      position: positions,
      texCoord: texCoords,
      index: indices
    }
  }

  private getTexture(textureRef: string) {
    while (textureRef.startsWith('#')) {
      textureRef = this.textures?.[textureRef.slice(1)] ?? ''
    }
    if (!textureRef.startsWith('minecraft:')) {
      textureRef = 'minecraft:' + textureRef
    }
    return textureRef
  }

  public flatten(accessor: BlockModelProvider) {
    if (!this.flattened && this.parent) {
      const parent = accessor.getBlockModel(this.parent)
      if (!parent) {
        console.warn(`parent ${this.parent} does not exist!`)
        this.flattened = true
        return
      }
      parent.flatten(accessor)
      if (!this.elements) {
        this.elements = parent.elements
      }
      if (!this.textures) {
        this.textures = {}
      }
      Object.keys(parent.textures ?? {}).forEach(t => {
        if (!this.textures![t]) {
          this.textures![t] = parent.textures![t]
        }
      })
      this.flattened = true
    }
  }

  public textureReferences() {
    return Object.values(this.textures ?? {})
      .filter(t => !t.startsWith('#'))
  }

  public static fromJson(id: string, data: any) {
    let parent = data.parent as string | undefined
    if (parent && !parent.startsWith('minecraft:')) {
      parent = 'minecraft:' + parent
    }
    return new BlockModel(id, parent, data.textures, data.elements)
  }
}
