// One-shot WebGL capability probe. The dashboard uses this to decide
// between the three.js globe and the flat SVG map — on Linux/WebKitGTK
// some driver setups expose no usable WebGL context, and the globe would
// otherwise render a black void.
export function webglAvailable(): boolean {
  try {
    const canvas = document.createElement("canvas");
    return !!(
      window.WebGLRenderingContext &&
      (canvas.getContext("webgl") || canvas.getContext("experimental-webgl"))
    );
  } catch {
    return false;
  }
}

// Best-effort sniff of the GL rasteriser behind the context. Some setups
// (WebKitGTK without GPU compositing, VMs) expose a working WebGL context
// that is actually CPU-rasterised (SwiftShader / llvmpipe / softpipe).
// The globe still works there but fill-rate is the bottleneck, so callers
// use this to pick a cheaper quality preset.
export function webglSoftwareRenderer(): boolean {
  try {
    const canvas = document.createElement("canvas");
    const gl = canvas.getContext("webgl") as WebGLRenderingContext | null;
    if (!gl) return false;
    const dbg = gl.getExtension("WEBGL_debug_renderer_info");
    const renderer = String(
      dbg
        ? gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL)
        : gl.getParameter(gl.RENDERER),
    );
    gl.getExtension("WEBGL_lose_context")?.loseContext();
    return /swiftshader|llvmpipe|softpipe|software|basic render/i.test(renderer);
  } catch {
    return false;
  }
}
