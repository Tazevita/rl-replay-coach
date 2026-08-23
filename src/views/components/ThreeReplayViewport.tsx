import { Canvas, type ThreeEvent, useFrame, useThree } from "@react-three/fiber";
import { Edges, OrbitControls } from "@react-three/drei";
import { type ComponentRef, type MutableRefObject, memo, useEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";
import type { ReplayViewerController } from "../../application/controllers/replay-viewer-controller";
import { projectedCarsAt, type PredictionHorizon } from "../../replay/predictions";
import { playerKey, replayActorKey } from "../../replay/timeline";
import type { PlayerPredictions } from "../../shared/contracts/replay-analysis-v2";
import type { InterpolatedReplayState, ReplayCar, Vector3Data } from "../../replay/types";

const FIELD_X = 4096;
const FIELD_Y = 5120;
const CORNER_RADIUS = 1792;
const WORLD_SCALE = 0.01;
const BLUE = "#43a5ff";
const ORANGE = "#ff914d";
const BOOST_PADS = [
  { x: -3584, y: 0 }, { x: 3584, y: 0 },
  { x: -3584, y: -4096 }, { x: 3584, y: -4096 },
  { x: -3584, y: 4096 }, { x: 3584, y: 4096 },
];

interface ThreeReplayViewportProps {
  controller: ReplayViewerController;
  active: boolean;
  replayActors: readonly ReplayCar[];
  autoCamera: boolean;
  trackedPlayerKey: string | null;
  projectedPredictions: PlayerPredictions;
  projectedCarsEnabled: boolean;
  projectedHorizon: PredictionHorizon;
  selectedProjectedPlayerIds: ReadonlySet<string>;
}

interface ProjectedActor {
  id: string;
  name: string;
  team: number;
}

export const ThreeReplayViewport = memo(function ThreeReplayViewport(props: ThreeReplayViewportProps) {
  return <div className={`render-surface${props.active ? "" : " hidden"}`} aria-label="3D Rocket League field replay" aria-hidden={!props.active}>
    <Canvas
      className="view-canvas"
      camera={{ fov: 45, near: 0.1, far: 500, position: [86, 72, 105] }}
      dpr={[1, 2]}
      frameloop={props.active ? "always" : "never"}
      gl={{ antialias: true, outputColorSpace: THREE.SRGBColorSpace, toneMapping: THREE.ACESFilmicToneMapping, toneMappingExposure: 1.15 }}
      shadows="soft"
    >
      <ReplayScene {...props} />
    </Canvas>
  </div>;
});

function ReplayScene(props: ThreeReplayViewportProps) {
  const { controller, active, replayActors, autoCamera, trackedPlayerKey } = props;
  const controls = useRef<ComponentRef<typeof OrbitControls>>(null);
  const camera = useThree(root => root.camera);
  const cars = useRef(new Map<string, THREE.Group>());
  const projectedCars = useRef(new Map<string, THREE.Group>());
  const ball = useRef<THREE.Mesh>(null);
  const target = useRef(new THREE.Vector3());
  const position = useRef(new THREE.Vector3());
  const offset = useRef(new THREE.Vector3(1.25, 0.82, 0.48).normalize());
  const autoDistance = useRef(40);
  const autoDistanceScale = useRef(1);
  const autoInteracting = useRef(false);
  const wasAuto = useRef(false);
  const lastCameraReset = useRef(-1);
  const projectedActors = useMemo<ProjectedActor[]>(() => {
    if (!props.projectedCarsEnabled) return [];
    return props.projectedPredictions.players
      .filter(player => props.selectedProjectedPlayerIds.has(player.id))
      .map(player => ({ id: player.id, name: player.displayName, team: player.team === "blue" ? 0 : 1 }));
  }, [props.projectedCarsEnabled, props.projectedPredictions, props.selectedProjectedPlayerIds]);

  useFrame((_, delta) => {
    if (!active) {
      wasAuto.current = false;
      return;
    }

    controller.tick(delta);
    const snapshot = controller.getSnapshot();
    const state = snapshot.currentReplayState;

    for (const object of cars.current.values()) object.visible = false;
    for (const car of state.cars) {
      const object = cars.current.get(replayActorKey(car));
      if (!object) continue;
      object.visible = true;
      setReplayTransform(object, car);
    }

    for (const object of projectedCars.current.values()) object.visible = false;
    if (props.projectedCarsEnabled) {
      const currentProjectedCars = projectedCarsAt(props.projectedPredictions, snapshot.playhead, props.projectedHorizon, props.selectedProjectedPlayerIds);
      for (const projectedCar of currentProjectedCars) {
        const object = projectedCars.current.get(projectedCar.id);
        if (!object) continue;
        object.visible = true;
        object.position.set(projectedCar.x * WORLD_SCALE, projectedCar.z * WORLD_SCALE, projectedCar.y * WORLD_SCALE);
        object.rotation.set(0, -projectedCar.yaw, 0);
      }
    }

    if (ball.current) {
      ball.current.visible = Boolean(state.ball);
      if (state.ball) ball.current.position.copy(toThreePosition(state.ball));
    }

    const orbit = controls.current;
    if (orbit && autoCamera) {
      const focus = cameraFocus(state, trackedPlayerKey);
      if (focus) {
        const reset = !wasAuto.current || lastCameraReset.current !== snapshot.cameraResetVersion;
        if (reset) {
          offset.current.set(1.25, 0.82, 0.48).normalize();
          autoDistanceScale.current = 1;
          autoDistance.current = focus.distance;
          target.current.copy(focus.target);
          position.current.copy(focus.target).addScaledVector(offset.current, focus.distance);
        } else {
          const currentOffset = camera.position.clone().sub(orbit.target);
          if (currentOffset.lengthSq() > 0) offset.current.copy(currentOffset.normalize());
          const cameraDelta = Math.min(delta, 0.1);
          autoDistance.current = focus.distance;
          const distance = THREE.MathUtils.clamp(focus.distance * autoDistanceScale.current, orbit.minDistance, orbit.maxDistance);
          autoDistanceScale.current = distance / focus.distance;
          target.current.lerp(focus.target, 1 - Math.exp(-5.5 * cameraDelta));
          const nextPosition = focus.target.clone().addScaledVector(offset.current, distance);
          position.current.lerp(nextPosition, 1 - Math.exp(-3.5 * cameraDelta));
        }
        orbit.target.copy(target.current);
        camera.position.copy(position.current);
      }
    }
    orbit?.update();
    wasAuto.current = autoCamera;
    lastCameraReset.current = snapshot.cameraResetVersion;
  });

  return <>
    <color attach="background" args={["#07100e"]} />
    <fog attach="fog" args={["#07100e", 115, 220]} />
    <Arena />
    {replayActors.map(car => <ReplayCarVisual key={replayActorKey(car)} car={car} registry={cars} />)}
    {projectedActors.map(car => <ProjectedCarVisual key={car.id} car={car} registry={projectedCars} />)}
    <mesh ref={ball} castShadow visible={false}>
      <icosahedronGeometry args={[0.92, 3]} />
      <meshStandardMaterial color="#e5e8e7" roughness={0.48} />
    </mesh>
    <OrbitControls
      ref={controls}
      makeDefault
      target={[0, 0, 0]}
      enableDamping={!autoCamera}
      dampingFactor={0.08}
      enableZoom
      enablePan={!autoCamera}
      minDistance={25}
      maxDistance={210}
      maxPolarAngle={Math.PI * 0.48}
      onStart={() => { autoInteracting.current = autoCamera; }}
      onChange={() => {
        const orbit = controls.current;
        if (!autoCamera || !autoInteracting.current || !orbit) return;
        const currentOffset = camera.position.clone().sub(orbit.target);
        const distance = currentOffset.length();
        if (distance <= 0) return;
        offset.current.copy(currentOffset.divideScalar(distance));
        autoDistanceScale.current = distance / autoDistance.current;
        target.current.copy(orbit.target);
        position.current.copy(camera.position);
      }}
      onEnd={() => { autoInteracting.current = false; }}
    />
  </>;
}

function ReplayCarVisual({ car, registry }: { car: ReplayCar; registry: MutableRefObject<Map<string, THREE.Group>> }) {
  const ref = useRef<THREE.Group>(null);
  const [hovered, setHovered] = useState(false);
  useEffect(() => {
    const object = ref.current;
    if (!object) return;
    const key = replayActorKey(car);
    registry.current.set(key, object);
    return () => { registry.current.delete(key); };
  }, [car, registry]);
  const handlePointerMove = (event: ThreeEvent<PointerEvent>): void => {
    event.stopPropagation();
    setHovered(true);
  };
  return <group ref={ref} visible={false} scale={hovered ? 1.12 : 1} onPointerMove={handlePointerMove} onPointerOut={() => setHovered(false)}>
    <mesh castShadow>
      <boxGeometry args={[1.35, 0.28, 0.78]} />
      <meshStandardMaterial color={car.team === 0 ? BLUE : ORANGE} metalness={0.35} roughness={0.28} />
    </mesh>
    <CarDetails color={car.team === 0 ? BLUE : ORANGE} />
    <PlayerLabel name={car.name} />
  </group>;
}

function ProjectedCarVisual({ car, registry }: { car: ProjectedActor; registry: MutableRefObject<Map<string, THREE.Group>> }) {
  const ref = useRef<THREE.Group>(null);
  useEffect(() => {
    const object = ref.current;
    if (!object) return;
    registry.current.set(car.id, object);
    return () => { registry.current.delete(car.id); };
  }, [car.id, registry]);
  const color = car.team === 0 ? BLUE : ORANGE;
  return <group ref={ref} visible={false}>
    <mesh>
      <boxGeometry args={[1.35, 0.28, 0.78]} />
      <meshStandardMaterial color={color} emissive={color} emissiveIntensity={0.9} transparent opacity={0.32} depthWrite={false} />
    </mesh>
    <PlayerLabel name={car.name} />
  </group>;
}

function CarDetails({ color }: { color: string }) {
  return <>
    <mesh position={[-0.14, 0.23, 0]} castShadow>
      <boxGeometry args={[0.62, 0.24, 0.62]} />
      <meshPhysicalMaterial color="#9fd6ea" transmission={0.35} />
    </mesh>
    <mesh position={[0.74, 0.02, 0]} rotation-z={-Math.PI / 2} castShadow>
      <coneGeometry args={[0.16, 0.28, 4]} />
      <meshStandardMaterial color={color} metalness={0.35} roughness={0.28} />
    </mesh>
    {[-0.42, 0.43].flatMap(x => [-0.45, 0.45].map(z => <mesh key={`${x}:${z}`} position={[x, -0.1, z]} rotation-x={Math.PI / 2} castShadow>
      <cylinderGeometry args={[0.14, 0.14, 0.12, 16]} />
      <meshStandardMaterial color="#111820" roughness={0.65} />
    </mesh>))}
  </>;
}

function PlayerLabel({ name }: { name: string }) {
  const texture = useMemo(() => {
    const canvas = document.createElement("canvas");
    canvas.width = 512;
    canvas.height = 96;
    const context = canvas.getContext("2d");
    if (!context) return null;
    context.font = "700 38px system-ui";
    context.textAlign = "center";
    context.textBaseline = "middle";
    context.lineJoin = "round";
    context.lineWidth = 9;
    context.strokeStyle = "rgba(5, 9, 14, .9)";
    context.strokeText(name, 256, 48);
    context.fillStyle = "white";
    context.fillText(name, 256, 48);
    const result = new THREE.CanvasTexture(canvas);
    result.colorSpace = THREE.SRGBColorSpace;
    return result;
  }, [name]);
  useEffect(() => () => texture?.dispose(), [texture]);
  if (!texture) return null;
  return <sprite position={[0, 2.2, 0]} scale={[8, 1.5, 1]} renderOrder={5}>
    <spriteMaterial map={texture} transparent depthTest={false} />
  </sprite>;
}

function Arena() {
  const width = FIELD_X * 2 * WORLD_SCALE;
  const length = FIELD_Y * 2 * WORLD_SCALE;
  const wallHeight = 4.8;
  const cornerRadius = CORNER_RADIUS * WORLD_SCALE;
  const ceilingHeight = 20.44;
  const corners = [
    { x: width / 2 - cornerRadius, z: length / 2 - cornerRadius, thetaStart: 0 },
    { x: -width / 2 + cornerRadius, z: length / 2 - cornerRadius, thetaStart: -Math.PI / 2 },
    { x: -width / 2 + cornerRadius, z: -length / 2 + cornerRadius, thetaStart: Math.PI },
    { x: width / 2 - cornerRadius, z: -length / 2 + cornerRadius, thetaStart: Math.PI / 2 },
  ];
  const wallMaterial = <meshPhysicalMaterial color="#b9eee3" transparent opacity={0.28} roughness={0.18} transmission={0.35} side={THREE.DoubleSide} depthWrite={false} />;
  return <>
    <mesh rotation-x={-Math.PI / 2} receiveShadow>
      <planeGeometry args={[width, length]} />
      <meshStandardMaterial color="#173a31" roughness={0.94} />
    </mesh>
    <mesh rotation-x={-Math.PI / 2} position={[0, 0.012, -length / 4]}>
      <planeGeometry args={[width, length / 2]} />
      <meshBasicMaterial color={BLUE} transparent opacity={0.035} depthWrite={false} />
    </mesh>
    <mesh rotation-x={-Math.PI / 2} position={[0, 0.013, length / 4]}>
      <planeGeometry args={[width, length / 2]} />
      <meshBasicMaterial color={ORANGE} transparent opacity={0.035} depthWrite={false} />
    </mesh>
    <mesh rotation-x={-Math.PI / 2} position-y={0.025}>
      <planeGeometry args={[width, 0.1]} />
      <meshBasicMaterial color="#dcefe8" transparent opacity={0.72} />
    </mesh>
    <mesh rotation-x={-Math.PI / 2} position-y={0.03}>
      <ringGeometry args={[9.05, 9.18, 96]} />
      <meshBasicMaterial color="#dcefe8" transparent opacity={0.72} />
    </mesh>
    {[-1, 1].map(side => <mesh key={`side:${side}`} rotation-y={Math.PI / 2} position={[side * width / 2, wallHeight / 2, 0]}>
      <planeGeometry args={[length - cornerRadius * 2, wallHeight]} />
      {wallMaterial}
    </mesh>)}
    {[-1, 1].map(end => <mesh key={`end:${end}`} position={[0, wallHeight / 2, end * length / 2]}>
      <planeGeometry args={[width - cornerRadius * 2, wallHeight]} />
      {wallMaterial}
    </mesh>)}
    {corners.map(corner => <mesh key={`${corner.x}:${corner.z}`} position={[corner.x, wallHeight / 2, corner.z]}>
      <cylinderGeometry args={[cornerRadius, cornerRadius, wallHeight, 32, 1, true, corner.thetaStart, Math.PI / 2]} />
      {wallMaterial}
    </mesh>)}
    <mesh rotation-x={Math.PI / 2} position-y={ceilingHeight}>
      <planeGeometry args={[width, length]} />
      <meshPhysicalMaterial color="#8fcfc5" transparent opacity={0.12} roughness={0.2} transmission={0.45} side={THREE.DoubleSide} depthWrite={false} />
    </mesh>
    <mesh position-y={ceilingHeight / 2}>
      <boxGeometry args={[width, ceilingHeight, length]} />
      <meshBasicMaterial visible={false} />
      <Edges color="#b9eee3" transparent opacity={0.58} />
    </mesh>
    {BOOST_PADS.map(pad => <mesh key={`${pad.x}:${pad.y}`} position={[pad.x * WORLD_SCALE, 0.06, pad.y * WORLD_SCALE]}>
      <cylinderGeometry args={[0.72, 0.86, 0.08, 32]} />
      <meshStandardMaterial color="#ffb52e" emissive="#ff8a00" emissiveIntensity={1.8} />
    </mesh>)}
    <Goal z={-length / 2} color={BLUE} direction={-1} />
    <Goal z={length / 2} color={ORANGE} direction={1} />
    <hemisphereLight args={["#cce8ff", "#0b1712", 1.65]} />
    <directionalLight position={[-35, 72, 24]} intensity={2.35} castShadow shadow-mapSize={[2048, 2048]} shadow-camera-left={-70} shadow-camera-right={70} shadow-camera-top={80} shadow-camera-bottom={-80} />
  </>;
}

function Goal({ z, color, direction }: { z: number; color: string; direction: number }) {
  const width = 17.86;
  const height = 6.42;
  const depth = 6.5;
  return <group>
    <GoalBeam position={[-width / 2, height / 2, z]} size={[0.18, height, 0.18]} color={color} />
    <GoalBeam position={[width / 2, height / 2, z]} size={[0.18, height, 0.18]} color={color} />
    <GoalBeam position={[0, height, z]} size={[width, 0.18, 0.18]} color={color} />
    <mesh position={[0, height / 2, z + direction * depth / 2]}>
      <boxGeometry args={[width, height, depth, 9, 4, 4]} />
      <meshBasicMaterial color={color} wireframe transparent opacity={0.16} />
    </mesh>
  </group>;
}

function GoalBeam({ position, size, color }: { position: [number, number, number]; size: [number, number, number]; color: string }) {
  return <mesh position={position}>
    <boxGeometry args={size} />
    <meshStandardMaterial color={color} emissive={color} emissiveIntensity={0.42} />
  </mesh>;
}

function cameraFocus(state: InterpolatedReplayState, trackedKey: string | null): { target: THREE.Vector3; distance: number } | null {
  const tracked = trackedKey ? state.cars.find(car => playerKey(car) === trackedKey) : null;
  const actors: Vector3Data[] = [];
  if (tracked) actors.push(tracked);
  else if (state.ball) {
    actors.push(state.ball, state.ball);
    actors.push(...[...state.cars].sort((a, b) => distanceSquared(a, state.ball!) - distanceSquared(b, state.ball!)).slice(0, 4));
  } else actors.push(...state.cars);
  if (!actors.length) return null;
  const target = new THREE.Vector3();
  for (const actor of actors) target.add(toThreePosition(actor));
  target.divideScalar(actors.length);
  target.set(THREE.MathUtils.clamp(target.x, -32, 32), THREE.MathUtils.clamp(target.y, 0.8, 10), THREE.MathUtils.clamp(target.z, -44, 44));
  let spread = 0;
  for (const actor of actors) spread = Math.max(spread, toThreePosition(actor).distanceTo(target));
  return { target, distance: (tracked ? 27 : 40) + THREE.MathUtils.clamp(spread * 1.35, 0, 25) };
}

function setReplayTransform(object: THREE.Object3D, car: ReplayCar): void {
  object.position.set(car.x * WORLD_SCALE, car.z * WORLD_SCALE, car.y * WORLD_SCALE);
  if (car.rotation) object.quaternion.set(-car.rotation.x, -car.rotation.z, -car.rotation.y, car.rotation.w).normalize();
  else object.rotation.set(0, -car.yaw, 0);
}

function toThreePosition(actor: Vector3Data): THREE.Vector3 {
  return new THREE.Vector3(actor.x, actor.z, actor.y).multiplyScalar(WORLD_SCALE);
}

function distanceSquared(left: Vector3Data, right: Vector3Data): number {
  return (left.x - right.x) ** 2 + (left.y - right.y) ** 2 + (left.z - right.z) ** 2;
}
