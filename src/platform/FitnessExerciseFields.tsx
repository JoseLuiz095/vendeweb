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
  const search = normalizeText(mediaSearch);
  const illustrations = fitnessExerciseIllustrations.filter(item => `repdb:${item.id}` === exercise.media_key || !search || normalizeText(`${item.label} ${item.group}`).includes(search));
  const movements = fitnessMovementLibrary.filter(item => item.key === exercise.media_key || !search || normalizeText(`${item.label} ${item.group}`).includes(search));
  const illustrationGroups = fitnessIllustrationGroups.filter(group => illustrations.some(item => item.group === group));
  const movementGroups = fitnessMovementGroups.filter(group => movements.some(item => item.group === group));

  return <div className="business-form-grid">
    <label>Dia<select value={exercise.day || 'A'} onChange={event => onChange({ day: event.target.value })}>{'ABCDEFG'.split('').map(day => <option key={day}>{day}</option>)}</select></label>
    {texts.map(([key, label]) => <label key={key}>{label}<textarea maxLength={1000} value={exercise[key] || ''} onChange={event => onChange({ [key]: event.target.value })}/></label>)}
    {(['primary_muscles', 'secondary_muscles'] as const).map(key => <fieldset key={key}>
      <legend>{key === 'primary_muscles' ? 'Músculos principais' : 'Músculos secundários'}</legend>
      {Object.entries(muscleLabels).map(([value, label]) => <label className="fitness-check" key={value}>
        <input type="checkbox" checked={(exercise[key] || []).includes(value)} onChange={event => onChange({ [key]: event.target.checked ? [...(exercise[key] || []), value] : (exercise[key] || []).filter(item => item !== value) })}/><span>{label}</span>
      </label>)}
    </fieldset>)}
    <label>Filtrar demonstrações<input type="search" maxLength={80} value={mediaSearch} onChange={event => setMediaSearch(event.target.value)} placeholder="Ex.: supino, halter, costas"/></label>
    <label>Demonstração do movimento<select value={exercise.media_key || ''} onChange={event => onChange({ media_key: event.target.value })}>
      <option value="">Somente instrução profissional</option>
      <optgroup label="Ilustração esquemática original · 2D">
        <option value="squat">Agachamento esquemático</option><option value="row">Remada esquemática</option><option value="bridge">Ponte de quadril esquemática</option><option value="hinge">Flexão de quadril esquemática</option><option value="lunge">Avanço esquemático</option>
      </optgroup>
      {illustrationGroups.map(group => <optgroup key={group} label={`${group} · ilustrações 2D RepDB`}>
        {illustrations.filter(item => item.group === group).map(item => <option key={item.id} value={`repdb:${item.id}`}>{item.label} · 2D</option>)}
      </optgroup>)}
      {movementGroups.map(group => <optgroup key={group} label={group}>
        {movements.filter(item => item.group === group).map(item => <option key={item.key} value={item.key}>{item.label} · loop 3D</option>)}
      </optgroup>)}
    </select><small>Escolha uma referência que corresponda ao exercício acima. Existem mais de 100 exemplos 2D de academia e movimentos animados 3D. Eles não representam carga ou técnica individual.</small></label>
    <div className="fitness-movement-preview-control">
      <button type="button" className="secondary-button" disabled={!exercise.media_key} aria-expanded={showPreview} aria-controls={previewId} onClick={() => setShowPreview(value => !value)}>{showPreview ? 'Ocultar prévia do aluno' : 'Visualizar prévia do aluno'}</button>
      <div id={previewId} hidden={!showPreview}>{showPreview && exercise.media_key && <FitnessMovement kind={exercise.media_key}/>}</div>
    </div>
    <FitnessMuscles primary={exercise.primary_muscles} secondary={exercise.secondary_muscles}/>
  </div>;
}
