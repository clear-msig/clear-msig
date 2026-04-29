"use client";

// Distorted sphere that tracks the cursor. Adds subtle organic
// motion behind the hero. Kept at 5% opacity so it never competes
// with foreground copy.

import { useRef } from "react";
import type { Mesh } from "three";
import { Canvas, useFrame } from "@react-three/fiber";
import { Sphere, MeshDistortMaterial } from "@react-three/drei";

function Blob() {
  const ref = useRef<Mesh>(null);
  useFrame((state) => {
    if (!ref.current) return;
    ref.current.rotation.x = state.clock.elapsedTime * 0.15;
    ref.current.rotation.y = state.clock.elapsedTime * 0.2;
    const mouseX = (state.pointer.x * Math.PI) / 4;
    const mouseY = (state.pointer.y * Math.PI) / 4;
    ref.current.rotation.x += (mouseY - ref.current.rotation.x) * 0.05;
    ref.current.rotation.y += (mouseX - ref.current.rotation.y) * 0.05;
  });
  return (
    <Sphere ref={ref} args={[1, 96, 96]} scale={2.8} position={[0, 0, -2]}>
      <MeshDistortMaterial
        color="#000000"
        attach="material"
        distort={0.42}
        speed={1.1}
        roughness={0.1}
        metalness={0.9}
        transparent
        opacity={0.72}
      />
    </Sphere>
  );
}

export function AnimatedBlob() {
  return (
    <div
      aria-hidden="true"
      className="pointer-events-none fixed inset-0 z-0 opacity-[0.05] mix-blend-multiply"
    >
      <Canvas camera={{ position: [0, 0, 5] }} dpr={[1, 1.5]} gl={{ antialias: false }}>
        <ambientLight intensity={1.5} />
        <directionalLight position={[5, 10, 5]} intensity={3} color="#16a34a" />
        <directionalLight position={[-5, -10, -5]} intensity={1} color="#ffffff" />
        <Blob />
      </Canvas>
    </div>
  );
}
