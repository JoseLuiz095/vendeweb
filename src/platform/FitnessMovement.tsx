import { createElement, lazy, Suspense, useEffect, useId, useRef, useState } from 'react';
import { fitnessIllustrationByKey } from './fitnessExerciseIllustrationLibrary';
import { fitnessMovementByKey, type FitnessMovementMedia } from './fitnessMovementLibrary';

const FitnessThreeViewer = lazy(() => import('./FitnessThreeViewer').catch(() => ({
  default: () => <p role="alert">Não foi possível carregar o visualizador. Feche esta visualização para voltar à demonstração anterior.</p>,
})));

const schematicPoses: Record<string, { name: string; body: string }> = {
  squat: { name: 'Agachamento', body: 'M170 67l-20 34-27 13 3 35 M150 101l34 16 13 32 M163 80l-31 2' },
  row: { name: 'Remada', body: 'M170 67l-18 36-8 46 M152 103l28 46 M164 80l-27 17 19-2' },
  bridge: { name: 'Ponte de quadril', body: 'M111 127l46-25 31 25-17 22 M157 102l-23 47 M119 130l-22 19' },
  hinge: { name: 'Flexão de quadril', body: 'M178 78l-35 23 5 48 M143 101l22 48 M169 85l-10 40' },
  lunge: { name: 'Avanço', body: 'M155 65v40l-29 14 2 30 M155 105l30 28 15 16 M155 79l-25 28' },
};

type ModelViewerElement = HTMLElement & {
  loaded?: boolean;
  currentTime: number;
  play: (options?: { repetitions?: number }) => void | Promise<void>;
  pause: () => void;
};

function prefersReducedMotion() {
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

function ExistingMovement({ movement }: { movement: FitnessMovementMedia }) {
  const viewer = useRef<ModelViewerElement | null>(null);
  const frame = useRef<HTMLElement | null>(null);
  const [customElementReady, setCustomElementReady] = useState(false);
  const [modelReady, setModelReady] = useState(false);
  const [playIntent, setPlayIntent] = useState(() => !prefersReducedMotion());
  const [inView, setInView] = useState(false);
  const [replay, setReplay] = useState(0);
  const [pageVisible, setPageVisible] = useState(() => !document.hidden);
  const [error, setError] = useState('');

  useEffect(() => {
    const element = viewer.current;
    if (!element) return;

    const onLoad = () => setModelReady(true);
    const onError = () => setError('A demonstração não carregou neste aparelho. A execução descrita na ficha continua disponível.');
    element.addEventListener('load', onLoad);
    element.addEventListener('error', onError);

    let cancelled = false;
    void (async () => {
      try {
        const moduleUrl = 'https://cdn.jsdelivr.net/npm/@google/model-viewer@4.4.0/dist/model-viewer.min.js';
        await import(/* @vite-ignore */ moduleUrl);
        await customElements.whenDefined('model-viewer');
        if (cancelled) return;
        setCustomElementReady(true);
        if (element.loaded) setModelReady(true);
      } catch {
        if (!cancelled) setError('O visualizador 3D não carregou. A instrução profissional continua disponível.');
      }
    })();

    return () => {
      cancelled = true;
      element.removeEventListener('load', onLoad);
      element.removeEventListener('error', onError);
      element.pause?.();
    };
  }, [movement.animation, movement.model]);

  useEffect(() => {
    const target = frame.current;
    if (!target) return;
    if (!('IntersectionObserver' in window)) {
      setInView(true);
      return;
    }
    const observer = new IntersectionObserver(([entry]) => setInView(entry.isIntersecting), { threshold: 0.15 });
    observer.observe(target);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    const update = () => setPageVisible(!document.hidden);
    document.addEventListener('visibilitychange', update);
    return () => document.removeEventListener('visibilitychange', update);
  }, []);

  useEffect(() => {
    const element = viewer.current;
    if (!element || !customElementReady) return;
    if (!playIntent || !inView || !pageVisible || !modelReady) {
      element.pause();
      return;
    }
    element.currentTime = 0;
    const stop = window.setTimeout(() => setPlayIntent(false), 12000);
    void Promise.resolve(element.play({ repetitions: Infinity })).catch(() => {
      setError('Não foi possível reproduzir esta demonstração neste aparelho.');
      setPlayIntent(false);
    });
    return () => window.clearTimeout(stop);
  }, [customElementReady, inView, modelReady, pageVisible, playIntent, replay]);

  const mediaLabelId = useId();
  return <figure ref={frame} className="fitness-movement fitness-movement--loop" aria-labelledby={mediaLabelId}>
    {createElement('model-viewer', {
      ref: viewer,
      src: movement.model,
      'animation-name': movement.animation,
      'camera-controls': true,
      'disable-zoom': true,
      loading: 'lazy',
      alt: `${movement.label}: demonstração 3D ilustrativa.`,
      'aria-label': `${movement.label}: demonstração animada em loop.`,
    })}
    <figcaption id={mediaLabelId}>
      <strong>{movement.label}</strong>
      <span>{movement.credit}. Demonstração visual geral, sem carga e sem substituir a orientação do profissional.</span>
    </figcaption>
    <div className="fitness-movement-controls">
      <button type="button" className="secondary-button" aria-label="Rever demonstração do exercício" title="Rever demonstração" onClick={() => { setReplay(value => value + 1); setPlayIntent(true); }}>↻</button>
      <span>Demonstração breve · sem áudio</span>
    </div>
    {!modelReady && !error && <p role="status" className="business-muted">Carregando demonstração animada…</p>}
    {error && <p role="status" className="business-muted">{error}</p>}
  </figure>;
}

function LoopingMovement({ movement }: { movement: FitnessMovementMedia }) {
  const [interactive, setInteractive] = useState(false);
  return <div>
    {interactive ? <Suspense fallback={<p role="status">Preparando visualização 3D…</p>}><FitnessThreeViewer movement={movement}/></Suspense> : <ExistingMovement movement={movement}/>}
    <button type="button" className="secondary-button" onClick={() => setInteractive(value => !value)}>{interactive ? 'Fechar visualização 3D interativa' : 'Abrir visualização 3D interativa'}</button>
  </div>;
}

function ExercisePose({src,alt,label}:{src:string;alt:string;label:string}) {
  const [failed,setFailed]=useState(false);
  return <figure>{failed?<p role="status">Imagem indisponível. Consulte as instruções do profissional.</p>:<img src={src} alt={alt} loading="lazy" decoding="async" onError={()=>setFailed(true)}/>}<figcaption>{label}</figcaption></figure>;
}

function AnimatedPoses({ base, label }: { base: string; label: string }) {
  const [run, setRun] = useState(0);
  return <div className="fitness-pose-demo">
    <div key={run} className="fitness-pose-animation" role="img" aria-label={`${label}: duas posições ilustrativas. Consulte as instruções da ficha.`}>
      <img src={`${base}-start.webp`} alt="" loading="lazy" />
      <img src={`${base}-peak.webp`} alt="" loading="lazy" />
    </div>
    <button type="button" className="secondary-button fitness-pose-replay" onClick={() => setRun(value => value + 1)} aria-label="Rever demonstração do exercício" title="Rever demonstração">↻</button>
    <span className="business-muted">Demonstração ilustrativa. As posições não substituem as instruções do profissional.</span>
  </div>;
}

export function FitnessMovement({ kind }: { kind?: string }) {
  const id = useId();
  const illustration = kind ? fitnessIllustrationByKey.get(kind) : undefined;
  if (illustration) {
    const base = `/assets/fitness-exercises/${illustration.id}`;
    return <figure className="fitness-movement fitness-movement--illustrated">
      {illustration.pose === 'single' ? <div className="fitness-movement-poses fitness-movement-poses--single"><ExercisePose key={`${base}-main`} src={`${base}-main.webp`} alt={`${illustration.label} · referência`} label="Referência"/></div> : <AnimatedPoses key={base} base={base} label={illustration.label}/>}
      <figcaption><strong>{illustration.label} · ilustração 2D</strong><span>Use as imagens para reconhecer as posições. A execução, amplitude e carga devem seguir a ficha revisada pelo profissional.</span><a href="https://repdb.co" target="_blank" rel="noreferrer">Ilustrações de exercício por RepDB</a></figcaption>
    </figure>;
  }
  const movement = kind ? fitnessMovementByKey.get(kind) : undefined;
  if (movement) return <LoopingMovement key={movement.key} movement={movement} />;

  const pose = kind ? schematicPoses[kind] : null;
  if (!pose) return <p className="business-muted">Sem mídia validada para este exercício. Consulte a instrução e a alternativa do profissional.</p>;
  const head = kind === 'bridge' ? { x: 98, y: 120 } : kind === 'hinge' ? { x: 187, y: 66 } : kind === 'lunge' ? { x: 155, y: 49 } : { x: 176, y: 53 };

  return <figure className="fitness-movement">
    <svg viewBox="0 0 280 180" role="img" aria-labelledby={id}>
      <title id={id}>{pose.name}: referência 2D esquemática, sem validação anatômica</title>
      <path d="M20 152h240" stroke="currentColor" strokeOpacity=".3"/>
      <g fill="none" stroke="currentColor" strokeWidth="7" strokeLinecap="round" strokeLinejoin="round">
        <circle cx={head.x} cy={head.y} r="11"/><path d={pose.body}/>
      </g>
    </svg>
    <figcaption>{pose.name} · Ilustração original simbólica. Não representa amplitude ou técnica individual. A execução deve seguir a revisão profissional.</figcaption>
  </figure>;
}
