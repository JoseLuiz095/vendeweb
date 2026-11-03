import { createElement, useState } from 'react';
import { normalizeText } from '../utils/text';
import { FitnessNutritionExample } from './FitnessNutritionExample';
import './fitness.css';

const programs = [
  { level: 'Iniciante', title: 'Ficha iniciante', focus: 'Primeiros movimentos', muscles: 'Pernas, costas e glúteos', equipment: 'Banco, elástico e solo', tone: 'basic', exercises: [
    { name: 'Sentar e levantar de banco', dose: '2 séries · 8 a 10 repetições · 90 s', alternative: 'Agachamento assistido' },
    { name: 'Remada com elástico', dose: '2 séries · 8 a 12 repetições · 90 s', alternative: 'Remada sentada em máquina' },
    { name: 'Ponte de quadril', dose: '2 séries · 8 a 12 repetições · 60 s', alternative: 'Extensão de quadril em pé' },
  ] },
  { level: 'Intermediário', title: 'Ficha intermediária', focus: 'Força e controle', muscles: 'Pernas, costas e glúteos', equipment: 'Halteres e banco', tone: 'medium', exercises: [
    { name: 'Agachamento com halter', dose: '3 séries · 8 a 12 repetições · 90 s', alternative: 'Agachamento com peso corporal' },
    { name: 'Remada unilateral', dose: '3 séries · 8 a 12 por lado · 90 s', alternative: 'Remada sentada' },
    { name: 'Terra romeno com halteres', dose: '3 séries · 8 a 10 repetições · 120 s', alternative: 'Ponte de quadril' },
  ] },
  { level: 'Avançado', title: 'Ficha avançada', focus: 'Progressão supervisionada', muscles: 'Pernas, costas e glúteos', equipment: 'Barra e halteres', tone: 'advanced', exercises: [
    { name: 'Agachamento com barra', dose: '3 séries · 6 a 10 repetições · 150 s', alternative: 'Agachamento com halter' },
    { name: 'Remada curvada', dose: '3 séries · 8 a 10 repetições · 120 s', alternative: 'Remada apoiada' },
    { name: 'Avanço com halteres', dose: '3 séries · 8 a 10 por lado · 120 s', alternative: 'Avanço sem carga' },
  ] },
] as const;

const demoOffers = [
  { name: 'Avaliação física', detail: 'Agendamento com o profissional, após confirmação da compra.' },
  { name: 'Avaliação + ficha personalizada', detail: 'Avaliação e elaboração individual após atendimento.' },
  { name: 'Consulta nutricional', detail: 'Atendimento por nutricionista habilitada.' },
  { name: 'Plano alimentar personalizado', detail: 'Preparado pela nutricionista após avaliação.' },
] as const;

/** Original, deliberately schematic movement diagram; it is not a prescription. */
function SquatDiagram() {
  return <svg className="fitness-demo-diagram" viewBox="0 0 560 236" role="img" aria-labelledby="fitness-diagram-title fitness-diagram-desc">
    <title id="fitness-diagram-title">Sequência 2D demonstrativa de agachamento</title>
    <desc id="fitness-diagram-desc">Três desenhos vetoriais de perfil mostram o início em pé, a descida controlada com quadril e joelhos flexionados e o retorno. A ilustração é esquemática e não define amplitude obrigatória.</desc>
    <defs>
      <g id="fitness-squat-standing">
        <path d="M-7-7C-15 2-12 15-9 25L-9 47Q-9 53-3 53H5L4 23C4 12 8 3 11-6Z" fill="#496b53"/>
        <path d="M5-9C13-5 16 1 17 9L23 27 21 47Q21 53 28 53H34L31 25C30 13 23 0 17-9Z" fill="#34563f"/>
        <path d="M-9 46H5L8 52Q8 55 4 55H-15Q-17 53-14 50Z" fill="#273e31"/>
        <path d="M21 46H33L39 51Q41 54 36 55H18Q16 53 19 50Z" fill="#273e31"/>
        <path d="M-10-62C-5-67 5-65 9-59L11-36Q12-24 9-12L5-5Q-4-3-11-8L-13-20Q-10-33-12-44Z" fill="#477b58"/>
        <path d="M5-57Q13-55 17-48L28-39Q32-36 29-32L25-31Q20-35 14-39L2-45Z" fill="#e0ae91"/>
        <path d="M-5-57Q-12-55-16-49L-22-39Q-25-36-22-33L-18-33Q-14-39-9-42L3-47Z" fill="#e0ae91"/>
        <circle cx="-1" cy="-76" r="13" fill="#e9bea4"/>
      </g>
      <g id="fitness-squat-lowered">
        <path d="M-24 0Q-33 2-38 12L-34 24-34 47Q-34 53-28 53H-20L-20 22-10 10Z" fill="#496b53"/>
        <path d="M-24 0Q-16-3-9 3L10 13 15 27 14 47Q14 53 21 53H28L26 24Q25 12 14 5L-9-7Z" fill="#34563f"/>
        <path d="M-34 46H-20L-18 52Q-18 55-22 55H-40Q-42 53-39 50Z" fill="#273e31"/>
        <path d="M14 46H27L34 51Q36 54 31 55H11Q9 53 12 50Z" fill="#273e31"/>
        <path d="M-7-43Q2-48 8-42L4-27-8-8-19 3Q-26 7-31 2L-27-8-17-24Z" fill="#477b58"/>
        <path d="M3-41Q12-39 17-34L30-28Q35-26 33-22L29-20Q23-24 16-26L1-30Z" fill="#e0ae91"/>
        <path d="M-9-40Q-17-38-21-31L-27-23Q-30-20-27-17L-23-18Q-19-23-14-26L-2-31Z" fill="#e0ae91"/>
        <circle cx="5" cy="-61" r="13" fill="#e9bea4"/>
      </g>
    </defs>
    <g className="fitness-demo-diagram__tile"><rect x="8" y="9" width="164" height="210" rx="12"/><path d="M24 179h132"/><use href="#fitness-squat-standing" x="88" y="128"/><text x="90" y="205">INÍCIO</text></g>
    <path className="fitness-demo-diagram__arrow" d="M177 108h23m-9-8 9 8-9 8"/>
    <g className="fitness-demo-diagram__tile"><rect x="198" y="9" width="164" height="210" rx="12"/><path d="M214 179h132"/><use href="#fitness-squat-lowered" x="286" y="127"/><text x="280" y="205">DESCIDA CONTROLADA</text></g>
    <path className="fitness-demo-diagram__arrow" d="M368 108h23m-9-8 9 8-9 8"/>
    <g className="fitness-demo-diagram__tile"><rect x="389" y="9" width="164" height="210" rx="12"/><path d="M405 179h132"/><use href="#fitness-squat-standing" x="470" y="128"/><text x="471" y="205">RETORNO</text></g>
  </svg>;
}

export function FitnessPilotExamples({ query = '' }: { query?: string }) {
  const [muscle, setMuscle] = useState('all');
  const [equipment, setEquipment] = useState('all');
  const [view3d, setView3d] = useState(false);
  const [loading3d, setLoading3d] = useState(false);
  const [error3d, setError3d] = useState('');
  const open3d = async () => {
    if (loading3d || view3d) return;
    setLoading3d(true); setError3d('');
    try {
      const moduleUrl = 'https://cdn.jsdelivr.net/npm/@google/model-viewer@4.4.0/dist/model-viewer.min.js';
      await import(/* @vite-ignore */ moduleUrl);
      await customElements.whenDefined('model-viewer');
      setView3d(true);
    } catch {
      setError3d('A demonstração 3D não carregou neste aparelho. A prévia 2D permanece disponível.');
    } finally { setLoading3d(false); }
  };
  const filtered = programs.filter(program => (muscle === 'all' || normalizeText(program.muscles).includes(normalizeText(muscle)))
    && (equipment === 'all' || normalizeText(program.equipment).includes(normalizeText(equipment)))
    && normalizeText([program.level, program.focus, program.muscles, program.equipment, ...program.exercises.map(item => item.name + ' ' + item.alternative)].join(' ')).includes(normalizeText(query)));
  return <section className="fitness-pilot-examples" aria-labelledby="fitness-examples-title">
    <div className="fitness-examples-heading">
      <div><span className="eyebrow">CONHEÇA O PILOTO</span><h2 id="fitness-examples-title">Exemplos de treinos e atendimentos</h2>
        <p>Explore o formato das fichas. São amostras fictícias para avaliação do piloto, sem compra nem prescrição individual.</p></div>
      <span className="fitness-demo-status">Demonstração</span>
    </div>
    <div className="fitness-example-filters"><label>Músculo<select value={muscle} onChange={event => setMuscle(event.target.value)}><option value="all">Todos</option><option value="Pernas">Pernas</option><option value="Costas">Costas</option><option value="Glúteos">Glúteos</option></select></label><label>Equipamento<select value={equipment} onChange={event => setEquipment(event.target.value)}><option value="all">Todos</option><option value="Elástico">Elástico</option><option value="Halteres">Halteres</option><option value="Barra">Barra</option><option value="Solo">Solo</option></select></label></div>
    <div className="fitness-example-layout">
      <div className="fitness-example-programs">
        {filtered.length === 0 && <p role="status" className="business-muted">Nenhuma ficha de exemplo corresponde à busca ou aos filtros.</p>}
        {filtered.map(program => <article className="fitness-example-program" key={program.level}>
          <div className="fitness-example-program-top"><span className={'fitness-level fitness-level--' + program.tone}>{program.level}</span><strong>Exemplo fictício</strong></div>
          <h3>{program.title}</h3><p>{program.focus}</p><small>{program.muscles} · {program.equipment}</small>
          <details><summary>Ver exercícios de exemplo</summary><ol>{program.exercises.map(item => <li key={item.name}><strong>{item.name}</strong><span>{item.dose}</span><small>Alternativa: {item.alternative}</small></li>)}</ol></details>
        </article>)}
      </div>
      <div className="fitness-demo-motion">
        <div className="fitness-demo-motion-heading"><div><span>Movimento demonstrativo · sem carga</span><h3>Agachamento</h3></div><span>2D + 3D fixo</span></div>
        <SquatDiagram/>
        <ol className="fitness-demo-cues" aria-label="Etapas do exemplo demonstrativo">
          <li><strong>Comece em pé.</strong> Apoie os pés numa base confortável.</li>
          <li><strong>Desça com controle.</strong> Flexione quadril e joelhos sem forçar a amplitude.</li>
          <li><strong>Volte à posição inicial.</strong> Interrompa se sentir dor e converse com o profissional que acompanha seu treino.</li>
        </ol>
        <p>Exemplo didático, sem carga prescrita. A ilustração não tem precisão anatômica; execução, amplitude e adaptações devem ser revisadas pelo profissional.</p>
        {view3d ? <div className="fitness-demo-viewer">
          {createElement('model-viewer', {
            src: '/assets/fitness-demo-squat.glb',
            'camera-orbit': '0deg 75deg 3.8m',
            'field-of-view': '32deg',
            'disable-zoom': true,
            'shadow-intensity': '0.25',
            alt: 'Modelo 3D esquemático de agachamento em vista fixa, sem animação.',
            'aria-label': 'Modelo 3D estático e esquemático de agachamento, em ângulo fixo',
          })}
          <button type="button" className="secondary-button" onClick={() => setView3d(false)}>Fechar 3D</button>
        </div> : <button type="button" className="secondary-button" onClick={() => void open3d()} disabled={loading3d}>
          {loading3d ? 'Carregando visualizador…' : 'Abrir demonstração 3D estática'}
        </button>}
        {error3d && <p role="status">{error3d}</p>}
        <small>Modelo GLB esquemático do piloto, sem rotação nem animação automática. O arquivo 3D é carregado só quando solicitado; a sequência 2D continua visível.</small>
      </div>
    </div>
    <div className="fitness-example-services"><h3>Também previstos para a loja</h3><div>{demoOffers.map(item => <article key={item.name}>
      <div><strong>{item.name}</strong><span>Exemplo</span></div><p>{item.detail}</p>
    </article>)}</div><p>Avaliação, combo e nutrição estão em preparação e não podem ser comprados nesta etapa. Preços reais aparecem somente nas ofertas publicadas pela loja.</p></div>
    <FitnessNutritionExample/>
  </section>;
}
