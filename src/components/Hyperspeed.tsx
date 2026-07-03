import { useEffect, useRef } from 'react';
import * as THREE from 'three';
import './Hyperspeed.css';

type HyperspeedOptions = {
  length?: number;
  roadWidth?: number;
  lanesPerRoad?: number;
  fov?: number;
  speedUp?: number;
  colors?: {
    roadColor?: number;
    background?: number;
    shoulderLines?: number;
    brokenLines?: number;
    leftCars?: number[];
    rightCars?: number[];
    sticks?: number;
  };
};

type ResolvedHyperspeedOptions = Omit<Required<HyperspeedOptions>, 'colors'> & {
  colors: Required<NonNullable<HyperspeedOptions['colors']>>;
};

const DEFAULT_EFFECT_OPTIONS: Required<HyperspeedOptions> = {
  length: 420,
  roadWidth: 10,
  lanesPerRoad: 4,
  fov: 86,
  speedUp: 2.3,
  colors: {
    roadColor: 0x050506,
    background: 0x000000,
    shoulderLines: 0xe8f6ff,
    brokenLines: 0x8ad7ff,
    leftCars: [0xd856bf, 0x6750a2, 0xc247ac],
    rightCars: [0x03b3c3, 0x0e5ea5, 0x324555],
    sticks: 0x03b3c3
  }
};

const random = (min: number, max: number) => min + Math.random() * (max - min);
const pick = (items: number[]) => items[Math.floor(Math.random() * items.length)];

export function Hyperspeed({ effectOptions = {} }: { effectOptions?: HyperspeedOptions }) {
  const containerRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const options = {
      ...DEFAULT_EFFECT_OPTIONS,
      ...effectOptions,
      colors: { ...DEFAULT_EFFECT_OPTIONS.colors, ...effectOptions.colors }
    } as ResolvedHyperspeedOptions;

    const scene = new THREE.Scene();
    scene.background = new THREE.Color(options.colors.background);
    scene.fog = new THREE.FogExp2(0x020409, 0.014);

    const camera = new THREE.PerspectiveCamera(options.fov, 1, 0.1, 1200);
    camera.position.set(0, 6.4, 11);
    camera.rotation.x = -0.47;

    const renderer = new THREE.WebGLRenderer({
      antialias: true,
      alpha: false,
      powerPreference: 'high-performance'
    });
    renderer.setClearColor(options.colors.background, 1);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    container.appendChild(renderer.domElement);

    const roadGroup = new THREE.Group();
    scene.add(roadGroup);

    const roadMaterial = new THREE.MeshBasicMaterial({
      color: options.colors.roadColor,
      transparent: true,
      opacity: 0.96
    });
    const roadGeometry = new THREE.PlaneGeometry(options.roadWidth * 2.2, options.length, 2, 64);
    const road = new THREE.Mesh(roadGeometry, roadMaterial);
    road.rotation.x = -Math.PI / 2;
    road.position.z = -options.length * 0.45;
    roadGroup.add(road);

    const laneMaterial = new THREE.LineBasicMaterial({
      color: options.colors.brokenLines,
      transparent: true,
      opacity: 0.72
    });
    const shoulderMaterial = new THREE.LineBasicMaterial({
      color: options.colors.shoulderLines,
      transparent: true,
      opacity: 0.42
    });

    const makeLine = (x: number, dashed = false) => {
      const group = new THREE.Group();
      const segmentCount = dashed ? 34 : 1;
      const segmentLength = dashed ? 4.8 : options.length;
      const gap = dashed ? 7.8 : 0;

      for (let index = 0; index < segmentCount; index += 1) {
        const z0 = dashed ? -index * (segmentLength + gap) - 12 : 8;
        const z1 = dashed ? z0 - segmentLength : -options.length;
        const geometry = new THREE.BufferGeometry().setFromPoints([
          new THREE.Vector3(x, 0.035, z0),
          new THREE.Vector3(x, 0.035, z1)
        ]);
        group.add(new THREE.Line(geometry, dashed ? laneMaterial : shoulderMaterial));
      }

      roadGroup.add(group);
      return group;
    };

    const laneWidth = (options.roadWidth * 2) / options.lanesPerRoad;
    const laneLines: THREE.Group[] = [];
    laneLines.push(makeLine(-options.roadWidth, false));
    laneLines.push(makeLine(options.roadWidth, false));
    for (let lane = 1; lane < options.lanesPerRoad; lane += 1) {
      laneLines.push(makeLine(-options.roadWidth + lane * laneWidth, true));
    }

    const carLights: Array<{ mesh: THREE.Mesh; speed: number; resetZ: number }> = [];
    const tubeGeometry = new THREE.BoxGeometry(0.055, 0.055, 1);
    const makeLight = (side: 'left' | 'right') => {
      const isLeft = side === 'left';
      const material = new THREE.MeshBasicMaterial({
        color: pick(isLeft ? options.colors.leftCars : options.colors.rightCars),
        transparent: true,
        opacity: 0.95
      });
      const mesh = new THREE.Mesh(tubeGeometry, material);
      const lane = Math.floor(random(0, options.lanesPerRoad));
      const laneX = -options.roadWidth + laneWidth * lane + laneWidth * 0.5;
      const offsetX = random(-laneWidth * 0.26, laneWidth * 0.26);
      const length = random(6, 26);
      mesh.scale.set(random(0.8, 1.8), random(0.7, 1.3), length);
      mesh.position.set(laneX + offsetX, random(0.12, 0.44), -random(18, options.length));
      mesh.rotation.x = 0;
      roadGroup.add(mesh);
      carLights.push({
        mesh,
        speed: isLeft ? random(56, 92) : random(92, 150),
        resetZ: -options.length - random(10, 80)
      });
    };

    for (let index = 0; index < 84; index += 1) {
      makeLight(index % 2 ? 'left' : 'right');
    }

    const stickMaterial = new THREE.MeshBasicMaterial({
      color: options.colors.sticks,
      transparent: true,
      opacity: 0.68
    });
    const sticks: Array<{ mesh: THREE.Mesh; speed: number }> = [];
    const stickGeometry = new THREE.BoxGeometry(0.08, 1, 0.08);
    for (let index = 0; index < 48; index += 1) {
      const mesh = new THREE.Mesh(stickGeometry, stickMaterial);
      const side = index % 2 ? -1 : 1;
      mesh.position.set(side * random(options.roadWidth + 1.2, options.roadWidth + 5.4), random(0.5, 1.4), -random(0, options.length));
      mesh.scale.y = random(1.5, 4.2);
      roadGroup.add(mesh);
      sticks.push({ mesh, speed: random(46, 78) });
    }

    const glow = new THREE.PointLight(0x8ad7ff, 2.4, 70);
    glow.position.set(0, 5, -16);
    scene.add(glow);

    let targetSpeed = 1;
    let speed = 1;
    let raf = 0;
    let disposed = false;

    const resize = () => {
      const { width, height } = container.getBoundingClientRect();
      if (!width || !height) return;
      renderer.setSize(width, height, false);
      camera.aspect = width / height;
      camera.updateProjectionMatrix();
    };

    const onPointerDown = () => {
      targetSpeed = options.speedUp;
    };
    const onPointerUp = () => {
      targetSpeed = 1;
    };

    const resizeObserver = new ResizeObserver(resize);
    resizeObserver.observe(container);
    container.addEventListener('pointerdown', onPointerDown);
    window.addEventListener('pointerup', onPointerUp);
    resize();

    const clock = new THREE.Clock();
    const tick = () => {
      if (disposed) return;
      const delta = Math.min(clock.getDelta(), 0.035);
      speed += (targetSpeed - speed) * 0.065;
      const travel = delta * speed;

      laneLines.forEach((lineGroup, groupIndex) => {
        if (groupIndex < 2) return;
        lineGroup.children.forEach((line) => {
          line.position.z += travel * 68;
          if (line.position.z > 12) line.position.z -= 390;
        });
      });

      carLights.forEach(({ mesh, speed: lightSpeed, resetZ }) => {
        mesh.position.z += travel * lightSpeed;
        const curve = Math.sin((mesh.position.z * 0.028) + performance.now() * 0.00065);
        mesh.position.x += curve * delta * 0.18;
        const material = mesh.material as THREE.MeshBasicMaterial;
        material.opacity = THREE.MathUtils.clamp(1 - mesh.position.z / 26, 0.18, 0.98);
        if (mesh.position.z > 24) mesh.position.z = resetZ;
      });

      sticks.forEach(({ mesh, speed: stickSpeed }) => {
        mesh.position.z += travel * stickSpeed;
        if (mesh.position.z > 18) mesh.position.z = -options.length - random(4, 40);
      });

      roadGroup.rotation.z = Math.sin(performance.now() * 0.00018) * 0.025;
      camera.fov += ((targetSpeed > 1 ? 108 : options.fov) - camera.fov) * 0.05;
      camera.updateProjectionMatrix();
      renderer.render(scene, camera);
      raf = window.requestAnimationFrame(tick);
    };

    tick();

    return () => {
      disposed = true;
      window.cancelAnimationFrame(raf);
      resizeObserver.disconnect();
      container.removeEventListener('pointerdown', onPointerDown);
      window.removeEventListener('pointerup', onPointerUp);
      renderer.dispose();
      renderer.forceContextLoss();
      roadGeometry.dispose();
      roadMaterial.dispose();
      laneMaterial.dispose();
      shoulderMaterial.dispose();
      tubeGeometry.dispose();
      stickGeometry.dispose();
      stickMaterial.dispose();
      if (renderer.domElement.parentNode === container) {
        container.removeChild(renderer.domElement);
      }
    };
  }, [effectOptions]);

  return <div ref={containerRef} className="hyperspeed" aria-hidden="true" />;
}

export default Hyperspeed;
