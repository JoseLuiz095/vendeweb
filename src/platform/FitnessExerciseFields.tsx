import { useId, useState } from 'react';
import type { FitnessExercise } from '../services/fitnessApi';
import { normalizeText } from '../utils/text';
import { FitnessMuscles, muscleLabels } from './FitnessMuscles';
import { FitnessMovement } from './FitnessMovement';
import { fitnessExerciseIllustrations, fitnessIllustrationGroups } from './fitnessExerciseIllustrationLibrary';
import { fitnessMovementGroups, fitnessMovementLibrary } from './fitnessMovementLibrary';

const texts = [
  ['objective', 'Objetivo'], ['equipment', 'Equipamento'], ['tempo', 'Ritmo'], ['range_of_motion', 'Amplitude'],
  ['common_mistakes', 'Erros comuns'], ['precautions', 'Cuidados'], ['professional_notes', 'Notas do profissional'],
] as const;

export function FitnessExerciseFields({ exercise, onChange }: { exercise: FitnessExercise; onChange: (patch: Partial<FitnessExercise>) => void }) {
  const [mediaSearch, setMediaSearch] = useState('');
  const [showPreview, setShowPreview] = useState(false);
  const previewId = useId();
  const [showAll, setShowAll] = useState(false);
  const [group, setGroup] = useState('');
  const search = normalizeText(mediaSearch);
  const illustrations = fitnessExerciseIllustrations.filter(item => (!group || item.group === group) && (!search || normalizeText(`${item.label} ${item.group}`).includes(search)));
  const movements = fitnessMovementLibrary.filter(item => item.key === exercise.media_key || !search || normalizeText(`${item.label} ${item.group}`).includes(search));
  const selectedIllustration = fitnessExerciseIllustrations.find(item => `repdb:${item.id}` === exercise.media_key);
  const illustrationGroups = fitnessIllustrationGroups.filter(group => illustrations.some(item => item.group === group));
  const movementGroups = fitnessMovementGroups.filter(group => movements.some(item => item.group === group));

  return <div className="business-form-grid">
    <label>Dia<select value={exercise.day || 'A'} onChange={event => onChange({ day: event.target.value })}>{'ABCDEFG'.split('').map(day => <option key={day}>{day}</option>)}</select></label>
    <details><summary>Detalhes do exercício</summary>{texts.map(([key, label]) => <label key={key}>{label}<textarea maxLength={1000} value={exercise[key] || ''} onChange={event => onChange({ [key]: event.target.value })}/></label>)}</details>
    <details><summary>Músculos trabalhados</summary>{(['primary_muscles', 'secondary_muscles'] as const).map(key => <fieldset key={key}>
      <legend>{key === 'primary_muscles' ? 'Músculos principais' : 'Músculos secundários'}</legend>
      {Object.entries(muscleLabels).map(([value, label]) => <label className="fitness-check" key={value}>
        <input type="checkbox" checked={(exercise[key] || []).includes(value)} onChange={event => onChange({ [key]: event.target.checked ? [...(exercise[key] || []), value] : (exercise[key] || []).filter(item => item !== value) })}/><span>{label}</span>
      </label>)}
    </fieldset>)}</details>
    <label>Buscar exercício ou equipamento pelo nome<input type="search" maxLength={80} value={mediaSearch} onChange={event => setMediaSearch(event.target.value)} placeholder="Ex.: supino, halter, costas"/></label>
    <label>Grupo muscular<select value={group} onChange={event => { setGroup(event.target.value); setShowAll(false); }}><option value="">Todos os grupos</option>{fitnessIllustrationGroups.map(item => <option key={item} value={item}>{item}</option>)}</select></label>
    <section className="fitness-exercise-picker" aria-label="Biblioteca visual de exercícios">
      <div><strong>Escolha um exercício</strong><p>Confira se a ilustração corresponde ao movimento prescrito e revise a técnica antes de atribuir.</p></div>
      {illustrations.length === 0 ? <p>Nenhum exercício encontrado. Tente outro nome ou grupo muscular.</p> : <div className="fitness-exercise-cards">{illustrations.slice(0, showAll ? undefined : 24).map(item => <button type="button" className="fitness-exercise-card" aria-pressed={exercise.media_key === `repdb:${item.id}`} key={item.id} onClick={() => { onChange({ name:item.label, media_key:`repdb:${item.id}` }); setShowPreview(true); }}><img loading="lazy" src={`/assets/fitness-exercises/${item.id}-${item.pose === 'single' ? 'main' : 'start'}.webp`} alt=""/><span><strong>{item.label}</strong><small>{item.group} · 2D</small></span></button>)}</div>}
      {illustrations.length > 24 && <button type="button" className="secondary-button" onClick={() => setShowAll(value => !value)}>{showAll ? 'Mostrar menos' : `Mostrar mais exercícios (${illustrations.length - 24})`}</button>}
    </section>
    <details><summary>Escolher movimento 3D</summary><p>Selecione um movimento e confira se ele corresponde ao exercício prescrito.</p>{movements.length === 0 ? <p>Nenhum movimento 3D encontrado para este filtro.</p> : <div className="fitness-visual-library">{movements.map(item=><button type="button" className="fitness-visual-library__item" key={item.key} onClick={()=>{onChange({name:item.label,media_key:item.key});setShowPreview(true);}}><span>{item.label}<small>{item.group} · animação 3D</small></span></button>)}</div>}</details>
    <details><summary>Outras opções de demonstração</summary><label>Demonstração do movimento<select value={exercise.media_key || ''} onChange={event => onChange({ media_key: event.target.value })}>
      <option value="">Somente instrução profissional</option>
      {selectedIllustration && !illustrations.some(item => item.id === selectedIllustration.id) && <option value={`repdb:${selectedIllustration.id}`}>{selectedIllustration.label} · selecionado</option>}
      <optgroup label="Ilustração esquemática original · 2D">
        <option value="squat">Agachamento esquemático</option><option value="row">Remada esquemática</option><option value="bridge">Ponte de quadril esquemática</option><option value="hinge">Flexão de quadril esquemática</option><option value="lunge">Avanço esquemático</option>
      </optgroup>
      {illustrationGroups.map(group => <optgroup key={group} label={`${group} · ilustrações 2D RepDB`}>
        {illustrations.filter(item => item.group === group).map(item => <option key={item.id} value={`repdb:${item.id}`}>{item.label} · 2D</option>)}
      </optgroup>)}
      {movementGroups.map(group => <optgroup key={group} label={group}>
        {movements.filter(item => item.group === group).map(item => <option key={item.key} value={item.key}>{item.label} · loop 3D</option>)}
      </optgroup>)}
    </select><small>Escolha uma referência que corresponda ao exercício acima. Existem mais de 100 exemplos 2D de academia e movimentos animados 3D. Eles não representam carga ou técnica individual.</small></label></details>
    <div className="fitness-movement-preview-control">
      <button type="button" className="secondary-button" disabled={!exercise.media_key} aria-expanded={showPreview} aria-controls={previewId} onClick={() => setShowPreview(value => !value)}>{showPreview ? 'Ocultar prévia do aluno' : 'Visualizar prévia do aluno'}</button>
      <div id={previewId} hidden={!showPreview}>{showPreview && exercise.media_key && <FitnessMovement kind={exercise.media_key}/>}</div>
    </div>
    <details><summary>Prévia dos músculos</summary><FitnessMuscles primary={exercise.primary_muscles} secondary={exercise.secondary_muscles}/></details>
  </div>;
}
