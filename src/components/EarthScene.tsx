import { useEffect, useRef } from 'react';
import * as THREE from 'three';

const prefersReducedMotion = () =>
  typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

const hash = (x: number, y: number) => {
  const value = Math.sin(x * 127.1 + y * 311.7) * 43758.5453123;
  return value - Math.floor(value);
};

const ROTATE_SPEED = 0.0048;
const INERTIA = 0.925;
const PARALLAX_EASE = 0.1;
const HOVER_EASE = 0.12;
const PITCH_LIMIT = THREE.MathUtils.degToRad(26);

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
    renderer.domElement.style.cursor = 'auto';
    renderer.domElement.style.touchAction = 'pan-y pinch-zoom';
    mount.appendChild(renderer.domElement);

    const hitArea = document.createElement('div');
    hitArea.setAttribute('aria-hidden', 'true');
    hitArea.style.position = 'absolute';
    hitArea.style.left = '0';
    hitArea.style.top = '0';
    hitArea.style.width = '1px';
    hitArea.style.height = '1px';
    hitArea.style.borderRadius = '9999px';
    hitArea.style.clipPath = 'circle(50%)';
    hitArea.style.cursor = 'grab';
    hitArea.style.pointerEvents = 'auto';
    hitArea.style.touchAction = 'pan-y pinch-zoom';
    hitArea.style.background = 'transparent';
    hitArea.style.zIndex = '1';
    mount.appendChild(hitArea);

    const root = new THREE.Group();
    root.rotation.z = THREE.MathUtils.degToRad(-18);
    root.position.set(0, -0.03, 0);
    root.scale.setScalar(0.9);
    scene.add(root);

    const globeRoot = new THREE.Group();
    root.add(globeRoot);

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
    globeRoot.add(earth);

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
    globeRoot.add(clouds);

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
    globeRoot.add(atmosphere);

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
    globeRoot.add(innerGlow);

    const hitTarget = new THREE.Mesh(
      new THREE.SphereGeometry(1.54, 64, 64),
      new THREE.MeshBasicMaterial({
        transparent: true,
        opacity: 0,
        depthWrite: false
      })
    );
    globeRoot.add(hitTarget);

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
    const manualRotation = { x: 0, y: 0 };
    const velocity = { x: 0, y: 0 };
    const targetParallax = { x: 0, y: 0 };
    const currentParallax = { x: 0, y: 0 };
    const targetHover = { x: 0, y: 0 };
    const currentHover = { x: 0, y: 0 };
    const drag = { active: false, pointerId: -1, lastX: 0, lastY: 0 };
    let pointerOverGlobe = false;
    let zoomOffset = 0;
    let zoomVelocity = 0;

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

    const getGlobeScreenBounds = () => {
      const rect = renderer.domElement.getBoundingClientRect();
      const progress = reducedMotion ? 0.78 : getScrollProgress();
      const ease = 1 - Math.pow(1 - progress, 3);
      const isNarrow = width < 760;
      const centerXRatio = isNarrow ? 0.5 : THREE.MathUtils.lerp(0.5, 0.3, ease);
      const centerYRatio = isNarrow ? THREE.MathUtils.lerp(0.5, 0.46, ease) : THREE.MathUtils.lerp(0.51, 0.54, ease);
      const radiusRatio = isNarrow ? THREE.MathUtils.lerp(0.31, 0.23, ease) : THREE.MathUtils.lerp(0.39, 0.27, ease);

      return {
        centerX: rect.left + rect.width * centerXRatio,
        centerY: rect.top + rect.height * centerYRatio,
        radius: Math.min(rect.width, rect.height) * radiusRatio
      };
    };

    const isOnGlobe = (event: { clientX: number; clientY: number }) => {
      const { centerX, centerY, radius } = getGlobeScreenBounds();

      return Math.hypot(event.clientX - centerX, event.clientY - centerY) <= radius;
    };

    const updatePointerVisuals = (event: { clientX: number; clientY: number }) => {
      pointerOverGlobe = isOnGlobe(event);
      if (!drag.active) {
        renderer.domElement.style.cursor = pointerOverGlobe ? 'grab' : 'auto';
      }
    };

    const onPointerDown = (event: PointerEvent) => {
      if (event.pointerType === 'touch') return;
      if (!isOnGlobe(event)) return;
      drag.active = true;
      drag.pointerId = event.pointerId;
      drag.lastX = event.clientX;
      drag.lastY = event.clientY;
      hitArea.style.cursor = 'grabbing';
      hitArea.setPointerCapture(event.pointerId);
    };

    const onPointerMove = (event: PointerEvent) => {
      updatePointerVisuals(event);

      if (!drag.active || event.pointerId !== drag.pointerId) return;

      const dx = event.clientX - drag.lastX;
      const dy = event.clientY - drag.lastY;
      drag.lastX = event.clientX;
      drag.lastY = event.clientY;

      manualRotation.y += dx * ROTATE_SPEED;
      manualRotation.x = THREE.MathUtils.clamp(manualRotation.x + dy * ROTATE_SPEED, -PITCH_LIMIT, PITCH_LIMIT);
      velocity.x = dy * ROTATE_SPEED;
      velocity.y = dx * ROTATE_SPEED;
    };

    const endDrag = (event: PointerEvent) => {
      if (event.pointerId !== drag.pointerId) return;
      drag.active = false;
      drag.pointerId = -1;
      hitArea.style.cursor = 'grab';
      if (hitArea.hasPointerCapture(event.pointerId)) {
        hitArea.releasePointerCapture(event.pointerId);
      }
    };

    const onWheel = (event: WheelEvent) => {
      if (!isOnGlobe(event)) return;
      if (Math.abs(event.deltaY) < 2) return;
      zoomVelocity += THREE.MathUtils.clamp(event.deltaY * 0.00055, -0.12, 0.12);
      zoomOffset = THREE.MathUtils.clamp(zoomOffset + zoomVelocity, -0.42, 0.58);
    };

    const onMouseMove = (event: MouseEvent) => {
      if (!drag.active) updatePointerVisuals(event);
    };

    const syncHitArea = () => {
      const { centerX, centerY, radius } = getGlobeScreenBounds();
      const mountRect = mount.getBoundingClientRect();
      hitArea.style.width = `${radius * 2}px`;
      hitArea.style.height = `${radius * 2}px`;
      hitArea.style.transform = `translate3d(${centerX - mountRect.left - radius}px, ${centerY - mountRect.top - radius}px, 0)`;
    };

    const render = () => {
      const elapsed = clock.getElapsedTime();
      const progress = reducedMotion ? 0.78 : getScrollProgress();
      const ease = 1 - Math.pow(1 - progress, 3);
      const isNarrow = width < 760;

      const targetX = isNarrow ? 0 : THREE.MathUtils.lerp(0, -1.86, ease);
      const targetY = isNarrow ? THREE.MathUtils.lerp(0.02, 0.52, ease) : THREE.MathUtils.lerp(-0.03, 0.12, ease);
      const targetScale = isNarrow ? THREE.MathUtils.lerp(0.82, 0.56, ease) : THREE.MathUtils.lerp(0.9, 0.62, ease);
      const targetCameraZ = THREE.MathUtils.lerp(6.45, 6.9, ease) + zoomOffset;

      currentParallax.x += (targetParallax.x - currentParallax.x) * PARALLAX_EASE;
      currentParallax.y += (targetParallax.y - currentParallax.y) * PARALLAX_EASE;
      currentHover.x += (targetHover.x - currentHover.x) * HOVER_EASE;
      currentHover.y += (targetHover.y - currentHover.y) * HOVER_EASE;

      root.position.x += (targetX - root.position.x) * 0.075;
      root.position.y += (targetY - root.position.y) * 0.075;
      root.scale.setScalar(root.scale.x + (targetScale - root.scale.x) * 0.075);
      camera.position.z += (targetCameraZ - camera.position.z) * 0.06;

      if (!drag.active) {
        manualRotation.x = THREE.MathUtils.clamp(manualRotation.x + velocity.x, -PITCH_LIMIT, PITCH_LIMIT);
        manualRotation.y += velocity.y;
        velocity.x *= INERTIA;
        velocity.y *= INERTIA;
      }

      zoomOffset = THREE.MathUtils.clamp(zoomOffset * 0.965, -0.42, 0.58);
      zoomVelocity *= 0.72;

      syncHitArea();

      if (!reducedMotion) {
        earth.rotation.y = baseEarthRotation + elapsed * 0.042;
        clouds.rotation.y = baseCloudRotation + elapsed * 0.058;
        atmosphere.rotation.y = earth.rotation.y;
        innerGlow.rotation.y = earth.rotation.y;
        globeRoot.rotation.x = manualRotation.x;
        globeRoot.rotation.y = manualRotation.y;
        orbitRoot.rotation.y = elapsed * 0.021;
        starPoints.rotation.y = elapsed * 0.004;
      } else {
        globeRoot.rotation.x = manualRotation.x;
        globeRoot.rotation.y = manualRotation.y;
      }

      renderer.render(scene, camera);
      raf = window.requestAnimationFrame(render);
    };

    resize();
    syncHitArea();
    window.addEventListener('resize', resize);
    hitArea.addEventListener('pointerdown', onPointerDown);
    window.addEventListener('pointermove', onPointerMove);
    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('pointerup', endDrag);
    window.addEventListener('pointercancel', endDrag);
    hitArea.addEventListener('wheel', onWheel, { passive: true });
    raf = window.requestAnimationFrame(render);

    return () => {
      window.cancelAnimationFrame(raf);
      window.removeEventListener('resize', resize);
      hitArea.removeEventListener('pointerdown', onPointerDown);
      window.removeEventListener('pointermove', onPointerMove);
      window.removeEventListener('mousemove', onMouseMove);
      window.removeEventListener('pointerup', endDrag);
      window.removeEventListener('pointercancel', endDrag);
      hitArea.removeEventListener('wheel', onWheel);
      mount.removeChild(hitArea);
      mount.removeChild(renderer.domElement);
      renderer.dispose();
      earth.geometry.dispose();
      clouds.geometry.dispose();
      atmosphere.geometry.dispose();
      innerGlow.geometry.dispose();
      hitTarget.geometry.dispose();
      (earth.material as THREE.Material).dispose();
      (clouds.material as THREE.Material).dispose();
      (atmosphere.material as THREE.Material).dispose();
      (innerGlow.material as THREE.Material).dispose();
      (hitTarget.material as THREE.Material).dispose();
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

  return <div ref={mountRef} className="absolute inset-0 z-[2] h-full w-full" aria-hidden="true" />;
}
