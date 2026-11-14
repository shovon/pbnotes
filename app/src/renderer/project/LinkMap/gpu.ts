/// <reference types="@webgpu/types" />
/**
 * The graph view's WebGPU: the buffers a map is loaded into, the compute
 * pass that steps the physics, and the two draws. Positions live on the GPU;
 * each frame that stepped copies them back, a frame or two late, for what
 * the CPU does with them: picking and the titles.
 */
import type { Camera, Size } from './camera/camera';
import type { Flat } from './flat/flat';
import { EDGES, NODES, SIM } from './shaders';

export type Rgb = readonly [number, number, number];
export type Colors = { fg: Rgb; muted: Rgb; accent: Rgb; tag: Rgb };

export type Frame = {
  camera: Camera;
  size: Size;
  colors: Colors;
  /** The node under the pointer, or -1. */
  hover: number;
  /** The node being dragged, and where in the world the pointer has it. */
  drag: { node: number; x: number; y: number } | null;
  /** How many times to step the physics before drawing. */
  steps: number;
  /** How strongly the map lays itself out: 1 fresh, cooling to 0 at rest. */
  heat: number;
};

export type Gpu = {
  /**
   * A map to simulate and draw, starting from `state` (four numbers a node:
   * x, y and velocity). `state` is written over, in place, each time the
   * positions are read back, and `onState` is called.
   */
  load(flat: Flat, state: Float32Array): void;
  frame(frame: Frame): void;
  destroy(): void;
};

type Loaded = {
  count: number;
  edges: number;
  state: [GPUBuffer, GPUBuffer];
  /** Which of `state` holds the newest positions. */
  at: 0 | 1;
  sim: [GPUBindGroup, GPUBindGroup];
  nodes: [GPUBindGroup, GPUBindGroup];
  arrows: [GPUBindGroup, GPUBindGroup];
  /** Buffers to read positions back through that are not being read now. */
  free: GPUBuffer[];
  into: Float32Array;
  buffers: GPUBuffer[];
};

/**
 * Undefined where there is no WebGPU to be had. Throws what the shaders or
 * pipelines were refused for.
 */
export async function createGpu(
  gpu: GPU | undefined,
  canvas: HTMLCanvasElement,
  onState: () => void,
  onLost: (why: string) => void,
): Promise<Gpu | undefined> {
  const adapter = await gpu?.requestAdapter({ powerPreference: 'high-performance' });
  if (!gpu || !adapter) return undefined;
  const device = await adapter.requestDevice();
  const context = canvas.getContext('webgpu');
  if (!context) return undefined;
  const format = gpu.getPreferredCanvasFormat();
  context.configure({ device, format, alphaMode: 'premultiplied' });

  let destroyed = false;
  void device.lost.then((info) => {
    if (!destroyed) onLost(info.message);
  });
  device.addEventListener('uncapturederror', (event) => console.error('link map:', event.error.message));

  device.pushErrorScope('validation');
  const blend: GPUBlendState = {
    color: { srcFactor: 'one', dstFactor: 'one-minus-src-alpha' },
    alpha: { srcFactor: 'one', dstFactor: 'one-minus-src-alpha' },
  };
  const draws = (code: string) => {
    const module = device.createShaderModule({ code });
    return device.createRenderPipeline({
      layout: 'auto',
      vertex: { module, entryPoint: 'vertex' },
      fragment: { module, entryPoint: 'fragment', targets: [{ format, blend }] },
      primitive: { topology: 'triangle-list' },
    });
  };
  const simPipeline = device.createComputePipeline({
    layout: 'auto',
    compute: { module: device.createShaderModule({ code: SIM }), entryPoint: 'simulate' },
  });
  const nodePipeline = draws(NODES);
  const arrowPipeline = draws(EDGES);
  const refused = await device.popErrorScope();
  if (refused) {
    device.destroy();
    throw new Error(refused.message);
  }

  const simUniform = device.createBuffer({ size: 32, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
  const viewUniform = device.createBuffer({ size: 96, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });

  let loaded: Loaded | null = null;

  const unload = () => {
    loaded?.buffers.forEach((it) => it.destroy());
    loaded = null;
  };

  const storage = (data: Int32Array | Uint32Array | Float32Array, extra = 0) => {
    // Never empty: a binding needs something behind it.
    const buffer = device.createBuffer({
      size: Math.max(data.byteLength, 32),
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST | extra,
    });
    device.queue.writeBuffer(buffer, 0, data.buffer as ArrayBuffer, data.byteOffset, data.byteLength);
    return buffer;
  };

  return {
    load(flat, state) {
      unload();
      const { count } = flat;

      const packed = new ArrayBuffer(count * 32);
      const ints = new Int32Array(packed);
      const floats = new Float32Array(packed);
      for (let i = 0; i < count; i++) {
        ints[i * 8] = flat.parent[i];
        ints[i * 8 + 1] = flat.sibStart[i];
        ints[i * 8 + 2] = flat.sibCount[i];
        ints[i * 8 + 3] = flat.childStart[i];
        ints[i * 8 + 4] = flat.childCount[i];
        ints[i * 8 + 5] = flat.springStart[i];
        ints[i * 8 + 6] = flat.springCount[i];
        floats[i * 8 + 7] = flat.radius[i];
      }
      // The other node and the kind are whole numbers on the GPU.
      const springs = new ArrayBuffer(flat.springs.byteLength);
      const springInts = new Uint32Array(springs);
      const springFloats = new Float32Array(springs);
      for (let i = 0; i < flat.springs.length; i += 4) {
        springInts[i] = flat.springs[i];
        springInts[i + 1] = flat.springs[i + 1];
        springFloats[i + 2] = flat.springs[i + 2];
        springFloats[i + 3] = flat.springs[i + 3];
      }

      const nodes = storage(ints);
      const springBuffer = storage(springInts);
      const edges = storage(flat.edges);
      const first = storage(state, GPUBufferUsage.COPY_SRC);
      const second = storage(state, GPUBufferUsage.COPY_SRC);
      const free = [0, 1, 2].map(() =>
        device.createBuffer({
          size: Math.max(count * 16, 32),
          usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST,
        }),
      );

      const group = (pipeline: GPUComputePipeline | GPURenderPipeline, buffers: GPUBuffer[]) =>
        device.createBindGroup({
          layout: pipeline.getBindGroupLayout(0),
          entries: buffers.map((buffer, binding) => ({ binding, resource: { buffer } })),
        });

      loaded = {
        count,
        edges: flat.edges.length / 4,
        state: [first, second],
        at: 0,
        sim: [
          group(simPipeline, [simUniform, nodes, springBuffer, first, second]),
          group(simPipeline, [simUniform, nodes, springBuffer, second, first]),
        ],
        nodes: [group(nodePipeline, [viewUniform, nodes, first]), group(nodePipeline, [viewUniform, nodes, second])],
        arrows: [
          group(arrowPipeline, [viewUniform, nodes, first, edges]),
          group(arrowPipeline, [viewUniform, nodes, second, edges]),
        ],
        free,
        into: state,
        buffers: [nodes, springBuffer, edges, first, second, ...free],
      };
    },

    frame({ camera, size, colors, hover, drag, steps, heat }) {
      if (destroyed) return;
      const now = loaded;

      const view = new ArrayBuffer(96);
      const viewFloats = new Float32Array(view);
      viewFloats.set([camera.x, camera.y, size.width, size.height, camera.zoom]);
      new Int32Array(view)[5] = hover;
      viewFloats.set([...colors.fg, 1], 8);
      viewFloats.set([...colors.muted, 1], 12);
      viewFloats.set([...colors.accent, 1], 16);
      viewFloats.set([...colors.tag, 1], 20);
      device.queue.writeBuffer(viewUniform, 0, view);

      const encoder = device.createCommandEncoder();
      let reading: GPUBuffer | undefined;
      if (now && now.count > 0 && steps > 0) {
        const uniform = new ArrayBuffer(32);
        new Uint32Array(uniform)[0] = now.count;
        new Int32Array(uniform)[1] = drag?.node ?? -1;
        new Float32Array(uniform).set([drag?.x ?? 0, drag?.y ?? 0, heat], 2);
        device.queue.writeBuffer(simUniform, 0, uniform);

        const pass = encoder.beginComputePass();
        pass.setPipeline(simPipeline);
        for (let step = 0; step < steps; step++) {
          pass.setBindGroup(0, now.sim[now.at]);
          pass.dispatchWorkgroups(Math.ceil(now.count / 64));
          now.at = now.at === 0 ? 1 : 0;
        }
        pass.end();
        reading = now.free.pop();
        if (reading) encoder.copyBufferToBuffer(now.state[now.at], 0, reading, 0, now.count * 16);
      }

      const pass = encoder.beginRenderPass({
        colorAttachments: [
          {
            view: context.getCurrentTexture().createView(),
            clearValue: { r: 0, g: 0, b: 0, a: 0 },
            loadOp: 'clear',
            storeOp: 'store',
          },
        ],
      });
      if (now && now.count > 0) {
        if (now.edges > 0) {
          pass.setPipeline(arrowPipeline);
          pass.setBindGroup(0, now.arrows[now.at]);
          pass.draw(6, now.edges);
        }
        pass.setPipeline(nodePipeline);
        pass.setBindGroup(0, now.nodes[now.at]);
        pass.draw(6, now.count);
      }
      pass.end();
      device.queue.submit([encoder.finish()]);

      if (now && reading) {
        const buffer = reading;
        buffer.mapAsync(GPUMapMode.READ, 0, now.count * 16).then(
          () => {
            // Another map was loaded while this was on its way: its buffers are gone.
            if (loaded !== now) return;
            now.into.set(new Float32Array(buffer.getMappedRange(0, now.count * 16)));
            buffer.unmap();
            now.free.push(buffer);
            onState();
          },
          (): void => undefined,
        );
      }
    },

    destroy() {
      destroyed = true;
      unload();
      simUniform.destroy();
      viewUniform.destroy();
      device.destroy();
    },
  };
}
