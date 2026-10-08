import * as THREE from 'three';

// One decoded image, GPU texture and rendering context per browser tab.
let renderer: THREE.WebGLRenderer | undefined;
let texture: THREE.Texture | undefined;
let material: THREE.MeshPhongMaterial | undefined;
let preparing: Promise<void> | undefined;
let prepared = false;
let inUse = false;

export function acquireTerminalGlobeRenderer() {
  renderer ??= new THREE.WebGLRenderer({ alpha: true, antialias: true, powerPreference: 'high-performance' });
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.setClearColor(0x000000, 0);
  inUse = true;
  return renderer;
}

export function releaseTerminalGlobeRenderer() {
  inUse = false;
  renderer?.renderLists.dispose();
  renderer?.setSize(1, 1, false);
}

export function terminalEarthTexture() {
  texture ??= new THREE.Texture();
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

export function terminalGlobePrepared() { return prepared; }

export function terminalEarthMaterial() {
  material ??= new THREE.MeshPhongMaterial({ map: terminalEarthTexture(), color: '#8ddfff', emissive: '#031421',
    emissiveIntensity: 0.72, shininess: 24, transparent: true, opacity: 0.88 });
  return material;
}

export function prepareTerminalGlobeResources() {
  if (preparing) return preparing;
  preparing = (async () => {
    const image = new Image();
    image.decoding = 'async';
    image.src = '/textures/earth-day.jpg';
    await image.decode();
    const earthTexture = terminalEarthTexture();
    earthTexture.image = image;
    earthTexture.needsUpdate = true;
    if (!inUse) {
      const warmedRenderer = acquireTerminalGlobeRenderer();
      // Prepare the GPU upload and the same lit material before navigation.
      const scene = new THREE.Scene();
      const camera = new THREE.PerspectiveCamera(31, 1, 0.1, 40);
      camera.position.z = 6.7;
      const geometry = new THREE.SphereGeometry(1.72, 64, 48);
      scene.add(new THREE.Mesh(geometry, terminalEarthMaterial()));
      scene.add(new THREE.AmbientLight('#84deff', 1.65));
      const light = new THREE.DirectionalLight('#d9f7ff', 2.3);
      light.position.set(3, 2, 5);
      scene.add(light);
      warmedRenderer.setSize(1, 1, false);
      warmedRenderer.render(scene, camera);
      geometry.dispose();
      releaseTerminalGlobeRenderer();
    } else renderer?.initTexture(earthTexture);
    prepared = true;
  })().catch(error => { preparing = undefined; throw error; });
  return preparing;
}
