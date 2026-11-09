import { useMemo, useState, type FormEvent } from 'react';
import type { FitnessExercise, FitnessWorkout } from '../services/fitnessApi';
import { normalizeText } from '../utils/text';
import { fitnessExerciseIllustrations, fitnessIllustrationGroups, type FitnessExerciseIllustration } from './fitnessExerciseIllustrationLibrary';
import { FitnessExerciseFields } from './FitnessExerciseFields';

const days = 'ABCDEFG'.split('');
type Props = { workout: FitnessWorkout; busy: boolean; onCancel: () => void; onSave: (workout: FitnessWorkout) => void };

export function FitnessWorkoutEditor({ workout, busy, onCancel, onSave }: Props) {
  const [draft, setDraft] = useState(() => ({ ...workout, exercises: workout.exercises.map(row => ({ ...row })) }));
  const [day, setDay] = useState(() => workout.exercises[0]?.day || 'A');
  const [query, setQuery] = useState('');
  const [group, setGroup] = useState('');
  const [page, setPage] = useState(0);
  const [libraryOpen, setLibraryOpen] = useState(false);
  const [error, setError] = useState('');
  const [invalidId, setInvalidId] = useState('');
  const matches = useMemo(() => fitnessExerciseIllustrations.filter(item => (!group || item.group === group) && normalizeText(`${item.label} ${item.group}`).includes(normalizeText(query.trim()))), [group, query]);
  const visible = draft.exercises.filter(row => (row.day || 'A') === day);
  const update = (id: string, patch: Partial<FitnessExercise>) => setDraft(current => ({ ...current, exercises: current.exercises.map(row => row.id === id ? { ...row, ...patch } : row) }));
  const add = (item: FitnessExerciseIllustration) => {
    if (draft.exercises.length >= 30) return;
    setDraft(current => ({ ...current, exercises: [...current.exercises, { id: crypto.randomUUID(), position: current.exercises.length + 1, name: item.label, media_key: `repdb:${item.id}`, day, sets: 1, repetitions: '', rest_seconds: 0, load_or_effort: '', instructions: '', alternative: '' }] }));
  };
  const move = (id: string, direction: -1 | 1) => setDraft(current => {
    const positions = current.exercises.map((row, index) => (row.day || 'A') === day ? index : -1).filter(index => index !== -1);
    const index = current.exercises.findIndex(row => row.id === id);
    const target = positions[positions.indexOf(index) + direction];
    if (target === undefined) return current;
    const exercises = [...current.exercises];
    [exercises[index], exercises[target]] = [exercises[target], exercises[index]];
    return { ...current, exercises };
  });
  const save = (event: FormEvent) => {
    event.preventDefault();
    if (draft.title.trim().length < 3) { setError('Informe um título com pelo menos 3 caracteres.'); return; }
    if (!draft.exercises.length) { setError('Adicione ao menos um exercício.'); return; }
    const invalid = draft.exercises.find(row => row.name.trim().length < 2 || !Number.isInteger(row.sets) || row.sets < 1 || row.sets > 20 || !row.repetitions.trim() || row.repetitions.trim().length > 40 || !Number.isInteger(row.rest_seconds) || row.rest_seconds < 0 || row.rest_seconds > 1800 || row.load_or_effort.trim().length < 3 || row.instructions.trim().length < 5 || row.alternative.trim().length < 2);
    if (invalid) { setDay(invalid.day || 'A'); setInvalidId(invalid.id); setError(`Complete ${invalid.name || 'o exercício'}: séries, repetições, descanso, carga ou esforço, instruções e alternativa são obrigatórios.`); return; }
    setError(''); onSave(draft);
  };
  const cancel = () => { if (JSON.stringify(draft) === JSON.stringify(workout) || window.confirm('Descartar alterações não salvas nesta ficha?')) onCancel(); };
  return <form className="fitness-builder" onSubmit={save} noValidate>
    <div className="fitness-builder-top"><div><h3>{workout.id ? 'Editar ficha' : 'Criar ficha de treino'}</h3><p>Organize os exercícios por treino e salve para revisão profissional.</p></div><span className="business-badge">Rascunho</span></div>
    <div className="fitness-builder-meta"><label>Nome da ficha<input maxLength={120} value={draft.title} onChange={e => setDraft({ ...draft, title: e.target.value })} placeholder="Ex.: Treino iniciante" /></label><label>Nível<select value={draft.level} onChange={e => setDraft({ ...draft, level: e.target.value as FitnessWorkout['level'] })}><option value="basic">Básico</option><option value="medium">Médio</option><option value="advanced">Avançado</option></select></label></div>
    <details className="fitness-builder-description"><summary>Descrição da ficha (opcional)</summary><label>Descrição<textarea maxLength={1000} value={draft.description} onChange={e => setDraft({ ...draft, description: e.target.value })}/></label></details>
    <nav className="fitness-builder-days" aria-label="Selecionar treino">{days.map(item => <button type="button" key={item} aria-pressed={day === item} onClick={() => setDay(item)}>Treino {item}{draft.exercises.some(row => (row.day || 'A') === item) ? ` (${draft.exercises.filter(row => (row.day || 'A') === item).length})` : ''}</button>)}</nav>
    <div className="fitness-builder-layout">
      <section className="fitness-builder-list" aria-label={`Exercícios do treino ${day}`}><div className="fitness-builder-list-title"><h4>Treino {day} · {visible.length} exercício{visible.length === 1 ? '' : 's'}</h4><button type="button" className="secondary-button fitness-builder-library-toggle" aria-expanded={libraryOpen} aria-controls="fitness-builder-library" onClick={() => setLibraryOpen(!libraryOpen)}>{libraryOpen ? 'Fechar biblioteca' : 'Adicionar exercício'}</button></div>
        {visible.length === 0 ? <p className="business-muted">Escolha exercícios na biblioteca para montar este treino.</p> : <ol className="fitness-builder-rows">{visible.map((row, index) => <li key={row.id}><div className="fitness-builder-row-heading"><strong>{index + 1}. {row.name || 'Novo exercício'}</strong><div><button type="button" disabled={index === 0} aria-label={`Subir ${row.name}`} onClick={() => move(row.id, -1)}>↑</button><button type="button" disabled={index === visible.length - 1} aria-label={`Descer ${row.name}`} onClick={() => move(row.id, 1)}>↓</button><button type="button" aria-label={`Remover ${row.name}`} onClick={() => setDraft(current => ({ ...current, exercises: current.exercises.filter(item => item.id !== row.id) }))}>✕</button></div></div>
          <div className="fitness-builder-quick"><label>Séries<input aria-label={`Séries de ${row.name}`} type="number" min={1} max={20} value={row.sets || ''} onChange={e => update(row.id, { sets: Number(e.target.value) })}/></label><label>Repetições<input aria-label={`Repetições de ${row.name}`} maxLength={40} value={row.repetitions} onChange={e => update(row.id, { repetitions: e.target.value })} placeholder="Ex.: 8 a 10"/></label><label>Descanso (s)<input aria-label={`Descanso de ${row.name}`} type="number" min={0} max={1800} value={row.rest_seconds} onChange={e => update(row.id, { rest_seconds: Number(e.target.value) })}/></label></div>
          <details open={invalidId === row.id ? true : undefined} onToggle={event => { if (!event.currentTarget.open && invalidId === row.id) setInvalidId(''); }}><summary>Orientações e detalhes</summary><div className="fitness-builder-detail"><label>Carga ou esforço<input maxLength={160} value={row.load_or_effort} onChange={e => update(row.id, { load_or_effort: e.target.value })} placeholder="Definido pelo profissional"/></label><label>Instruções<textarea maxLength={1000} value={row.instructions} onChange={e => update(row.id, { instructions: e.target.value })}/></label><label>Alternativa<input maxLength={160} value={row.alternative} onChange={e => update(row.id, { alternative: e.target.value })}/></label><details><summary>Músculos, mídia e outros detalhes</summary><FitnessExerciseFields exercise={row} onChange={patch => update(row.id, patch)}/></details></div></details>
        </li>)}</ol>}
      </section>
      <aside id="fitness-builder-library" className={`fitness-builder-library${libraryOpen ? ' is-open' : ''}`} aria-label="Biblioteca de exercícios"><h4>Biblioteca de exercícios</h4><p>Busque pelo nome ou grupo muscular e adicione ao treino {day}.</p><label>Buscar exercício<input type="search" value={query} onChange={e => { setQuery(e.target.value); setPage(0); }} placeholder="Ex.: supino, peito"/></label><label>Grupo muscular<select value={group} onChange={e => { setGroup(e.target.value); setPage(0); }}><option value="">Todos os grupos</option>{fitnessIllustrationGroups.map(item => <option key={item}>{item}</option>)}</select></label><p role="status">{matches.length} exercício{matches.length === 1 ? '' : 's'} encontrado{matches.length === 1 ? '' : 's'}</p>
        <div className="fitness-builder-results">{matches.slice(page * 12, page * 12 + 12).map(item => <div className="fitness-builder-result" key={item.id}><img src={`/assets/fitness-exercises/${item.id}-${item.pose === 'single' ? 'main' : 'start'}.webp`} alt="" loading="lazy"/><span><strong>{item.label}</strong><small>{item.group}</small></span><button type="button" disabled={draft.exercises.length >= 30} aria-label={`Adicionar ${item.label}`} onClick={() => add(item)}>＋</button></div>)}</div>
        {matches.length > 12 && <div className="fitness-builder-pages"><button type="button" disabled={page === 0} onClick={() => setPage(page - 1)}>Anterior</button><span>Página {page + 1} de {Math.ceil(matches.length / 12)}</span><button type="button" disabled={(page + 1) * 12 >= matches.length} onClick={() => setPage(page + 1)}>Próxima</button></div>}
        <p className="business-muted">Confira a técnica e a demonstração antes de atribuir. Limite de 30 exercícios por ficha.</p>
      </aside>
    </div>{error && <p role="alert" className="business-message business-message--error">{error}</p>}<div className="fitness-builder-actions"><button type="submit" className="primary-button" disabled={busy}>Salvar rascunho</button><button type="button" className="secondary-button" disabled={busy} onClick={cancel}>Cancelar</button></div>
  </form>;
}
