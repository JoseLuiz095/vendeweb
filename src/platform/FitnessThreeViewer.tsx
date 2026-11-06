import { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import type { FitnessMovementMedia } from './fitnessMovementLibrary';

export default function FitnessThreeViewer({ movement }: { movement: FitnessMovementMedia }) {
  const container = useRef<HTMLDivElement>(null);
  const model = useRef<THREE.Object3D | null>(null);
  const action = useRef<THREE.AnimationAction | null>(null);
  const [playing, setPlaying] = useState(false);
  const [ready, setReady] = useState(false);
  const [status, setStatus] = useState('Carregando modelo 3D…');

  useEffect(() => {
    const host = container.current;
    if (!host) return;
    let renderer: THREE.WebGLRenderer;
    try {
      renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    } catch {
      setStatus('Visualização 3D indisponível neste aparelho. Use a demonstração anterior e as instruções da ficha.');
      return;
    }
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    host.appendChild(renderer.domElement);
    const scene = new THREE.Scene();
    scene.add(new THREE.HemisphereLight(0xffffff, 0x66806d, 2.5));
    const light = new THREE.DirectionalLight(0xffffff, 2);
    light.position.set(3, 5, 4);
    scene.add(light);
    const camera = new THREE.PerspectiveCamera(35, 1, 0.01, 100);
    const timer = new THREE.Timer();
    timer.connect(document);
    let mixer: THREE.AnimationMixer | undefined;
    let loaded: THREE.Object3D | undefined;
    let frame = 0;
    let disposed = false;
    const resize = () => {
      const width = Math.max(host.clientWidth, 1);
      const height = Math.max(host.clientHeight, 1);
      renderer.setSize(width, height, false);
      camera.aspect = width / height;
      camera.updateProjectionMatrix();
    };
    const observer = new ResizeObserver(resize);
    observer.observe(host);
    resize();
    new GLTFLoader().load(movement.model, gltf => {
      if (disposed) return;
      const clip = THREE.AnimationClip.findByName(gltf.animations, movement.animation);
      if (!clip) { setStatus('Animação indisponível para este exercício.'); return; }
      loaded = gltf.scene;
      model.current = gltf.scene;
      scene.add(gltf.scene);
      const bounds = new THREE.Box3().setFromObject(gltf.scene);
      const size = bounds.getSize(new THREE.Vector3());
      const center = bounds.getCenter(new THREE.Vector3());
      const distance = Math.max(size.x, size.y, size.z, 1) * 2.3;
      camera.position.set(center.x, center.y, center.z + distance);
      camera.lookAt(center);
      mixer = new THREE.AnimationMixer(gltf.scene);
      action.current = mixer.clipAction(clip);
      action.current.play();
      action.current.paused = true;
      setReady(true);
      setStatus('Modelo carregado. Use os controles para girar e reproduzir.');
    }, undefined, () => { if (!disposed) setStatus('Não foi possível carregar o modelo. Consulte a demonstração anterior e a ficha.'); });
    const render = () => {
      frame = requestAnimationFrame(render);
      timer.update();
      const delta = Math.min(timer.getDelta(), 0.05);
      if (!document.hidden && host.getBoundingClientRect().bottom > 0 && host.getBoundingClientRect().top < window.innerHeight) {
        mixer?.update(delta);
        renderer.render(scene, camera);
      }
    };
    render();
    return () => {
      disposed = true;
      cancelAnimationFrame(frame);
      observer.disconnect();
      timer.dispose();
      mixer?.stopAllAction();
      loaded?.traverse(object => {
        if (object instanceof THREE.Mesh) {
          object.geometry.dispose();
          const materials = Array.isArray(object.material) ? object.material : [object.material];
          materials.forEach(material => {
            Object.values(material).forEach(value => { if (value instanceof THREE.Texture) value.dispose(); });
            material.dispose();
          });
        }
      });
      renderer.dispose();
      renderer.domElement.remove();
      action.current = null;
      model.current = null;
    };
  }, [movement]);

  return <section aria-label="Visualização 3D interativa" className="fitness-three-viewer">
    <div ref={container} className="fitness-three-canvas" aria-hidden="true" />
    <p><strong>{movement.label}</strong> · {movement.credit}. Demonstração ilustrativa; siga as orientações do profissional.</p>
    <p role="status">{status}</p>
    <div className="fitness-movement-controls">
      <button type="button" className="secondary-button" disabled={!ready} onClick={() => { if (model.current) model.current.rotation.y -= Math.PI / 4; }}>Girar à esquerda</button>
      <button type="button" className="secondary-button" disabled={!ready} onClick={() => { if (model.current) model.current.rotation.y += Math.PI / 4; }}>Girar à direita</button>
      <button type="button" className="secondary-button" disabled={!ready} onClick={() => { if (action.current) { action.current.paused = playing; setPlaying(!playing); } }}>{playing ? 'Pausar movimento 3D' : 'Reproduzir movimento 3D'}</button>
    </div>
  </section>;
}
