import { useEffect, useRef } from 'react';
import * as THREE from 'three';

const prefersReducedMotion = () =>
  typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

const hash = (x: number, y: number) => {
  const value = Math.sin(x * 127.1 + y * 311.7) * 43758.5453123;
  return value - Math.floor(value);
};

function makeStarField(count: number) {
  const positions = new Float32Array(count * 3);

  for (let i = 0; i < count; i += 1) {
    const radius = 10 + hash(i, 2) * 18;
    const theta = hash(i, 7) * Math.PI * 2;
    const phi = Math.acos(hash(i, 11) * 2 - 1);
    positions[i * 3] = radius * Math.sin(phi) * Math.cos(theta);
    positions[i * 3 + 1] = radius * Math.cos(phi);
    positions[i * 3 + 2] = radius * Math.sin(phi) * Math.sin(theta);
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));

  const material = new THREE.PointsMaterial({
    color: '#d6ebff',
    opacity: 0.34,
    size: 0.012,
    transparent: true,
    depthWrite: false
  });

  return new THREE.Points(geometry, material);
}

function makeOrbit(radiusX: number, radiusY: number, opacity: number) {
  const curve = new THREE.EllipseCurve(0, 0, radiusX, radiusY, 0, Math.PI * 2, false, 0);
  const points = curve.getPoints(240).map((point) => new THREE.Vector3(point.x, 0, point.y));
  const geometry = new THREE.BufferGeometry().setFromPoints(points);
  const material = new THREE.LineBasicMaterial({
    color: '#d8ecff',
    transparent: true,
    opacity,
    depthWrite: false
  });
  const line = new THREE.LineLoop(geometry, material);
  line.rotation.x = THREE.MathUtils.degToRad(73);
  line.rotation.z = THREE.MathUtils.degToRad(-13);
  return line;
}

function makeTexture(path: string, colorSpace: THREE.ColorSpace = THREE.NoColorSpace) {
  const texture = new THREE.TextureLoader().load(path);
  texture.colorSpace = colorSpace;
  texture.anisotropy = 8;
  return texture;
}

export function EarthScene() {
  const mountRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const mount = mountRef.current;
    if (!mount) return;

    const reducedMotion = prefersReducedMotion();
    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(34, 1, 0.1, 90);
    camera.position.set(0, 0.02, 6.35);

    const renderer = new THREE.WebGLRenderer({
      alpha: true,
      antialias: true,
      powerPreference: 'high-performance'
    });
    renderer.setClearColor(0x000000, 0);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.04;
    mount.appendChild(renderer.domElement);

    const root = new THREE.Group();
    root.rotation.z = THREE.MathUtils.degToRad(-18);
    root.position.set(-1.06, 0.03, 0);
    root.scale.setScalar(0.86);
    scene.add(root);

    const dayMap = makeTexture('/textures/earth-day.jpg', THREE.SRGBColorSpace);
    const cloudMap = makeTexture('/textures/earth-clouds.png', THREE.SRGBColorSpace);
    const specularMap = makeTexture('/textures/earth-specular.jpg');

    const earth = new THREE.Mesh(
      new THREE.SphereGeometry(1.42, 160, 160),
      new THREE.MeshPhongMaterial({
        map: dayMap,
        specularMap,
        specular: new THREE.Color('#8fcfff'),
        shininess: 21,
        emissive: new THREE.Color('#020b18'),
        emissiveIntensity: 0.26
      })
    );
    earth.rotation.x = THREE.MathUtils.degToRad(-7);
    earth.rotation.y = THREE.MathUtils.degToRad(-112);
    root.add(earth);

    const clouds = new THREE.Mesh(
      new THREE.SphereGeometry(1.448, 144, 144),
      new THREE.MeshLambertMaterial({
        map: cloudMap,
        color: '#ffffff',
        transparent: true,
        opacity: 0.42,
        depthWrite: false
      })
    );
    clouds.rotation.x = earth.rotation.x;
    clouds.rotation.y = earth.rotation.y + 0.18;
    root.add(clouds);

    const atmosphere = new THREE.Mesh(
      new THREE.SphereGeometry(1.51, 128, 128),
      new THREE.ShaderMaterial({
        transparent: true,
        blending: THREE.AdditiveBlending,
        side: THREE.BackSide,
        depthWrite: false,
        uniforms: {
          glowColor: { value: new THREE.Color('#77cfff') }
        },
        vertexShader: `
          varying vec3 vNormal;
          void main() {
            vNormal = normalize(normalMatrix * normal);
            gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
          }
        `,
        fragmentShader: `
          varying vec3 vNormal;
          uniform vec3 glowColor;
          void main() {
            float rim = pow(0.66 - dot(vNormal, vec3(0.0, 0.0, 1.0)), 3.05);
            gl_FragColor = vec4(glowColor, rim * 0.58);
          }
        `
      })
    );
    root.add(atmosphere);

    const innerGlow = new THREE.Mesh(
      new THREE.SphereGeometry(1.435, 128, 128),
      new THREE.ShaderMaterial({
        transparent: true,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        uniforms: {
          glowColor: { value: new THREE.Color('#3aa9ff') }
        },
        vertexShader: `
          varying vec3 vNormal;
          void main() {
            vNormal = normalize(normalMatrix * normal);
            gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
          }
        `,
        fragmentShader: `
          varying vec3 vNormal;
          uniform vec3 glowColor;
          void main() {
            float fresnel = pow(1.0 - abs(dot(vNormal, vec3(0.0, 0.0, 1.0))), 2.4);
            gl_FragColor = vec4(glowColor, fresnel * 0.13);
          }
        `
      })
    );
    root.add(innerGlow);

    const key = new THREE.DirectionalLight('#fbfdff', 4.4);
    key.position.set(-4.8, 1.55, 4.9);
    scene.add(key);

    const fill = new THREE.DirectionalLight('#7cc8ff', 0.42);
    fill.position.set(2.4, -1.2, 2.2);
    scene.add(fill);

    const rim = new THREE.DirectionalLight('#5cb8ff', 1.15);
    rim.position.set(3.4, -0.1, -2.5);
    scene.add(rim);

    scene.add(new THREE.AmbientLight('#06172d', 0.28));

    const orbitRoot = new THREE.Group();
    orbitRoot.add(makeOrbit(2.72, 1.08, 0.06));
    orbitRoot.add(makeOrbit(3.32, 1.38, 0.032));
    root.add(orbitRoot);

    const starPoints = makeStarField(500);
    scene.add(starPoints);

    let width = 0;
    let height = 0;
    let raf = 0;
    const clock = new THREE.Clock();
    const baseEarthRotation = earth.rotation.y;
    const baseCloudRotation = clouds.rotation.y;

    const resize = () => {
      const rect = mount.getBoundingClientRect();
      width = Math.max(1, rect.width);
      height = Math.max(1, rect.height);
      camera.aspect = width / height;
      camera.updateProjectionMatrix();
      renderer.setSize(width, height, false);
    };

    const getScrollProgress = () => {
      const vh = Math.max(window.innerHeight, 1);
      return THREE.MathUtils.clamp(window.scrollY / (vh * 0.94), 0, 1);
    };

    const render = () => {
      const elapsed = clock.getElapsedTime();
      const progress = reducedMotion ? 0.78 : getScrollProgress();
      const ease = 1 - Math.pow(1 - progress, 3);
      const isNarrow = width < 760;

      const targetX = isNarrow ? 0 : THREE.MathUtils.lerp(-1.06, 1.92, ease);
      const targetY = isNarrow ? THREE.MathUtils.lerp(0.18, 0.64, ease) : THREE.MathUtils.lerp(0.03, 0.0, ease);
      const targetScale = isNarrow ? THREE.MathUtils.lerp(0.78, 0.54, ease) : THREE.MathUtils.lerp(0.86, 0.58, ease);

      root.position.x += (targetX - root.position.x) * 0.075;
      root.position.y += (targetY - root.position.y) * 0.075;
      root.scale.setScalar(root.scale.x + (targetScale - root.scale.x) * 0.075);
      camera.position.z += (THREE.MathUtils.lerp(6.45, 6.9, ease) - camera.position.z) * 0.06;

      if (!reducedMotion) {
        earth.rotation.y = baseEarthRotation + elapsed * 0.042;
        clouds.rotation.y = baseCloudRotation + elapsed * 0.058;
        atmosphere.rotation.y = earth.rotation.y;
        innerGlow.rotation.y = earth.rotation.y;
        orbitRoot.rotation.y = elapsed * 0.021;
        starPoints.rotation.y = elapsed * 0.004;
      }

      renderer.render(scene, camera);
      raf = window.requestAnimationFrame(render);
    };

    resize();
    window.addEventListener('resize', resize);
    raf = window.requestAnimationFrame(render);

    return () => {
      window.cancelAnimationFrame(raf);
      window.removeEventListener('resize', resize);
      mount.removeChild(renderer.domElement);
      renderer.dispose();
      earth.geometry.dispose();
      clouds.geometry.dispose();
      atmosphere.geometry.dispose();
      innerGlow.geometry.dispose();
      (earth.material as THREE.Material).dispose();
      (clouds.material as THREE.Material).dispose();
      (atmosphere.material as THREE.Material).dispose();
      (innerGlow.material as THREE.Material).dispose();
      orbitRoot.children.forEach((child) => {
        const line = child as THREE.Line;
        line.geometry.dispose();
        (line.material as THREE.Material).dispose();
      });
      starPoints.geometry.dispose();
      (starPoints.material as THREE.Material).dispose();
      dayMap.dispose();
      cloudMap.dispose();
      specularMap.dispose();
    };
  }, []);

  return <div ref={mountRef} className="pointer-events-none absolute inset-0 z-[2] h-full w-full" aria-hidden="true" />;
}
