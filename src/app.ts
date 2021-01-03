import { mat4 } from 'gl-matrix'
import { BlockAtlas } from './BlockAtlas'
import { ModelManager } from './ModelManager';
import { mergeFloat32Arrays } from './Util';

const blocksTextureIds = [
  'block/crafting_table_front',
  'block/crafting_table_side',
  'block/crafting_table_top',
  'block/oak_planks',
  'block/dirt',
  'block/sand',
  'block/cobblestone',
  'block/stone',
  'block/hopper_inside',
  'block/hopper_outside',
  'block/hopper_top',
  'block/lantern',
  'block/oak_sapling',
]

const blockModelIds = [
  'block/stone',
  'block/crafting_table',
  'block/cube_all',
  'block/cube',
  'block/hopper',
  'block/hanging_lantern',
  'block/cross',
  'block/oak_sapling',
]

type GL = WebGLRenderingContext

const structure = {
  size: [3, 2, 1],
  palette: [
    { Name: 'stone' },
    { Name: 'crafting_table' },
    { Name: 'hopper' },
    { Name: 'hanging_lantern' },
    { Name: 'oak_sapling' },
  ],
  blocks: [
    { pos: [1, 0, 0], state: 0 },
    { pos: [2, 0, 0], state: 0 },
    { pos: [2, 1, 0], state: 1 },
    { pos: [0, 1, 0], state: 2 },
    { pos: [0, 0, 0], state: 3 },
    { pos: [1, 1, 0], state: 4 },
  ]
}

const vsSource = `
  attribute vec4 vertPos;
  attribute vec2 texCoord;

  uniform mat4 mView;
  uniform mat4 mProj;

  varying highp vec2 vTexCoord;

  void main(void) {
    gl_Position = mProj * mView * vertPos;
    vTexCoord = texCoord;
  }
`;

const fsSource = `
  varying highp vec2 vTexCoord;

  uniform sampler2D sampler;

  void main(void) {
    gl_FragColor = texture2D(sampler, vTexCoord);
  }
`;

let blockAtlas = new BlockAtlas(1)
let modelManager = new ModelManager({})

let viewDist = 4;
let xRotation = 0.8;
let yRotation = 0.5;

main();

async function main() {
  const canvas = document.querySelector('#glcanvas') as HTMLCanvasElement;
  const gl = canvas.getContext('webgl');

  if (!gl) {
    console.error('Unable to initialize WebGL. Your browser or machine may not support it.');
    return;
  }

  const shaderProgram = initShaderProgram(gl, vsSource, fsSource);
  if (!shaderProgram) {
    return
  }

  // Fetch block textures
  blockAtlas = await BlockAtlas.fromIds(blocksTextureIds)
  // Create atlas texture
  const atlasTexture = blockAtlas.createTexture(gl)
  // Display preview of atlas
  const atlasCanvas = document.querySelector('#atlas') as HTMLCanvasElement;
  const ctx = atlasCanvas.getContext('2d')!;
  atlasCanvas.width = blockAtlas.pixelWidth
  atlasCanvas.height = blockAtlas.pixelWidth
  ctx.putImageData(blockAtlas.getImageData(), 0, 0)

  // Fetch block models
  modelManager = await ModelManager.fromIds(blockModelIds)

  console.log(modelManager)

  const { vertexCount } = initGl(gl, shaderProgram)

  const viewMatrixLoc = gl.getUniformLocation(shaderProgram,'mView')!

  function render() {
    yRotation = yRotation % (Math.PI * 2)
    xRotation = Math.max(-Math.PI / 2, Math.min(Math.PI / 2, xRotation))
    viewDist = Math.max(1, Math.min(20, viewDist))
    drawScene(gl!, viewMatrixLoc, vertexCount, atlasTexture!);
  }
  requestAnimationFrame(render);

  let dragPos: [number, number] | null = null
  canvas.addEventListener('mousedown', evt => {
    dragPos = [evt.clientX, evt.clientY]
  })
  canvas.addEventListener('mousemove', evt => {
    if (dragPos) {
      yRotation += (evt.clientX - dragPos[0]) / 100
      xRotation += (evt.clientY - dragPos[1]) / 100
      dragPos = [evt.clientX, evt.clientY]
      requestAnimationFrame(render);
    }
  })
  canvas.addEventListener('mouseup', () => {
    dragPos = null
  })
  canvas.addEventListener('wheel', evt => {
    viewDist += evt.deltaY / 100
    requestAnimationFrame(render);
  })
}

function initShaderProgram(gl: GL, vsSource: string, fsSource: string) {
  const vertexShader = loadShader(gl, gl.VERTEX_SHADER, vsSource)!;
  const fragmentShader = loadShader(gl, gl.FRAGMENT_SHADER, fsSource)!;

  const shaderProgram = gl.createProgram()!;
  gl.attachShader(shaderProgram, vertexShader);
  gl.attachShader(shaderProgram, fragmentShader);
  gl.linkProgram(shaderProgram);

  if (!gl.getProgramParameter(shaderProgram, gl.LINK_STATUS)) {
    console.error('Unable to initialize the shader program: ' + gl.getProgramInfoLog(shaderProgram));
    return null;
  }

  return shaderProgram;
}

function loadShader(gl: GL, type: number, source: string) {
  const shader = gl.createShader(type)!;

  gl.shaderSource(shader, source);
  gl.compileShader(shader);

  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    console.error('An error occurred compiling the shaders: ' + gl.getShaderInfoLog(shader));
    gl.deleteShader(shader);
    return null;
  }

  return shader;
}

function createBuffer(gl: GL, type: number, array: ArrayBuffer) {
  const buffer = gl.createBuffer();
  gl.bindBuffer(type, buffer);
  gl.bufferData(type, array, gl.STATIC_DRAW);
  return buffer
}

function initBuffers(gl: GL) {
  const positions = []
  const textureCoordinates = []
  const indices = []
  let indexOffset = 0

  for (const b of structure.blocks) {
    const blockState = structure.palette[b.state]
    const model = modelManager.getModel(`block/${blockState.Name}`)
    const buffers = model.getBuffers(blockAtlas, indexOffset, b.pos[0], b.pos[1], b.pos[2])
    positions.push(buffers.position)
    textureCoordinates.push(...buffers.texCoord)
    indices.push(...buffers.index)
    indexOffset += buffers.texCoord.length / 2
  }

  return {
    position: createBuffer(gl, gl.ARRAY_BUFFER, mergeFloat32Arrays(...positions)),
    textureCoord: createBuffer(gl, gl.ARRAY_BUFFER, new Float32Array(textureCoordinates)),
    indices: createBuffer(gl, gl.ELEMENT_ARRAY_BUFFER, new Uint16Array(indices)),
    length: indices.length
  };
}

function initGl(gl: GL, shaderProgram: WebGLProgram) {
  const p0 = performance.now()
  const buffers = initBuffers(gl)
  const p1 = performance.now()
  console.log("Initializing buffers took", (p1-p0).toFixed(3), "ms")

  gl.clearColor(0.0, 0.0, 0.0, 1.0);
  gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);

  gl.enable(gl.DEPTH_TEST)
  gl.depthFunc(gl.LEQUAL)
  gl.enable(gl.BLEND)
  gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA)

  gl.enable(gl.CULL_FACE);
  gl.cullFace(gl.BACK);

  const fieldOfView = 70 * Math.PI / 180;
  const aspect = (gl.canvas as HTMLCanvasElement).clientWidth / (gl.canvas as HTMLCanvasElement).clientHeight;
  const projMatrix = mat4.create();
  mat4.perspective(projMatrix, fieldOfView, aspect, 0.1, 100.0);

  const vertLoc = gl.getAttribLocation(shaderProgram, 'vertPos')
  gl.bindBuffer(gl.ARRAY_BUFFER, buffers.position);
  gl.vertexAttribPointer(vertLoc, 3, gl.FLOAT, false, 0, 0);
  gl.enableVertexAttribArray(vertLoc);

  const texCoordLoc = gl.getAttribLocation(shaderProgram, 'texCoord')
  gl.bindBuffer(gl.ARRAY_BUFFER, buffers.textureCoord);
  gl.vertexAttribPointer(texCoordLoc, 2, gl.FLOAT, false, 0, 0);
  gl.enableVertexAttribArray(texCoordLoc);

  gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, buffers.indices);

  gl.useProgram(shaderProgram);
  
  gl.uniformMatrix4fv(gl.getUniformLocation(shaderProgram, 'mProj'), false, projMatrix);

  return {
    vertexCount: buffers.length
  }
}

function drawScene(gl: GL, viewMatrixLoc: WebGLUniformLocation, vertexCount: number, atlas: WebGLTexture) {
  const viewMatrix = mat4.create();
  mat4.translate(viewMatrix, viewMatrix, [0, 0, -viewDist]);
  mat4.rotate(viewMatrix, viewMatrix, xRotation, [1, 0, 0]);
  mat4.rotate(viewMatrix, viewMatrix, yRotation, [0, 1, 0]);
  mat4.translate(viewMatrix, viewMatrix, [-structure.size[0] / 2, -structure.size[1] / 2, -structure.size[2] / 2]);
  gl.uniformMatrix4fv(viewMatrixLoc, false, viewMatrix);

  gl.activeTexture(gl.TEXTURE0);
  gl.bindTexture(gl.TEXTURE_2D, atlas);

  gl.drawElements(gl.TRIANGLES, vertexCount, gl.UNSIGNED_SHORT, 0);
}
