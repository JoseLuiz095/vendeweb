export type FitnessMovementMedia = {
  key: string;
  label: string;
  group: string;
  animation: string;
  model: string;
  credit: string;
};

const deskBreak = '/assets/fitness-desk-break.glb';
const deskBreakCredit = 'Animação 3D ilustrativa · Desk Break · MIT';

/** Curated labels are Portuguese; each one maps to an exact animation in the licensed GLB. */
export const fitnessMovementLibrary: FitnessMovementMedia[] = [
  { key: 'desk:mini-squat', label: 'Agachamento curto', group: 'Pernas e glúteos', animation: 'mini-squat', model: deskBreak, credit: deskBreakCredit },
  { key: 'desk:sit-back-squat', label: 'Agachamento com quadril para trás', group: 'Pernas e glúteos', animation: 'sit-back-squat', model: deskBreak, credit: deskBreakCredit },
  { key: 'desk:wide-mini-squat', label: 'Agachamento com base aberta', group: 'Pernas e glúteos', animation: 'wide-mini-squat', model: deskBreak, credit: deskBreakCredit },
  { key: 'desk:shallow-split-squat', label: 'Agachamento dividido curto', group: 'Pernas e glúteos', animation: 'shallow-split-squat', model: deskBreak, credit: deskBreakCredit },
  { key: 'desk:squat-to-calf-raise', label: 'Agachamento com elevação de panturrilha', group: 'Pernas e glúteos', animation: 'squat-to-calf-raise', model: deskBreak, credit: deskBreakCredit },
  { key: 'desk:hip-hinge', label: 'Flexão de quadril', group: 'Pernas e glúteos', animation: 'hip-hinge', model: deskBreak, credit: deskBreakCredit },
  { key: 'desk:good-morning-bodyweight', label: 'Bom-dia sem carga', group: 'Pernas e glúteos', animation: 'good-morning-bodyweight', model: deskBreak, credit: deskBreakCredit },
  { key: 'desk:reverse-lunge-knee-drive', label: 'Passo para trás com elevação de joelho', group: 'Pernas e glúteos', animation: 'reverse-lunge-knee-drive', model: deskBreak, credit: deskBreakCredit },
  { key: 'desk:back-leg-raise', label: 'Elevação de perna para trás em pé', group: 'Pernas e glúteos', animation: 'back-leg-raise', model: deskBreak, credit: deskBreakCredit },
  { key: 'desk:standing-side-leg-raise', label: 'Elevação lateral de perna em pé', group: 'Pernas e glúteos', animation: 'side-leg-raise', model: deskBreak, credit: deskBreakCredit },
  { key: 'desk:standing-hamstring-curl', label: 'Flexão de joelho em pé', group: 'Pernas e glúteos', animation: 'standing-hamstring-curl', model: deskBreak, credit: deskBreakCredit },
  { key: 'desk:calf-raise', label: 'Elevação de panturrilha', group: 'Pernas e glúteos', animation: 'calf-raise', model: deskBreak, credit: deskBreakCredit },
  { key: 'desk:glute-bridge', label: 'Ponte de quadril no solo', group: 'Pernas e glúteos', animation: 'glute-bridge', model: deskBreak, credit: deskBreakCredit },
  { key: 'desk:clam-shell', label: 'Abertura de quadril deitado', group: 'Pernas e glúteos', animation: 'clam-shell', model: deskBreak, credit: deskBreakCredit },
  { key: 'desk:side-lying-leg-lift', label: 'Elevação lateral de perna deitado', group: 'Pernas e glúteos', animation: 'side-lying-leg-lift', model: deskBreak, credit: deskBreakCredit },
  { key: 'desk:hinge-row-no-weight', label: 'Remada inclinada sem carga', group: 'Costas e postura', animation: 'hinge-row-no-weight', model: deskBreak, credit: deskBreakCredit },
  { key: 'desk:chair-rowing', label: 'Remada sentado', group: 'Costas e postura', animation: 'chair-rowing', model: deskBreak, credit: deskBreakCredit },
  { key: 'desk:pull-aparts', label: 'Abertura de braços à frente', group: 'Costas e postura', animation: 'pull-aparts', model: deskBreak, credit: deskBreakCredit },
  { key: 'desk:scapular-squeeze', label: 'Aproximação das escápulas', group: 'Costas e postura', animation: 'scapular-squeeze', model: deskBreak, credit: deskBreakCredit },
  { key: 'desk:lateral-raise', label: 'Elevação lateral de braços', group: 'Ombros e braços', animation: 'lateral-raise', model: deskBreak, credit: deskBreakCredit },
  { key: 'desk:front-raise', label: 'Elevação frontal de braços', group: 'Ombros e braços', animation: 'front-raise', model: deskBreak, credit: deskBreakCredit },
  { key: 'desk:biceps-curl', label: 'Flexão de cotovelos', group: 'Ombros e braços', animation: 'biceps-curl', model: deskBreak, credit: deskBreakCredit },
  { key: 'desk:chair-shoulder-press', label: 'Pressão de ombros sentado', group: 'Ombros e braços', animation: 'chair-shoulder-press', model: deskBreak, credit: deskBreakCredit },
  { key: 'desk:dead-bug', label: 'Dead bug alternado', group: 'Abdômen e controle', animation: 'dead-bug', model: deskBreak, credit: deskBreakCredit },
  { key: 'desk:standing-bicycle-crunch', label: 'Abdominal cruzado em pé', group: 'Abdômen e controle', animation: 'standing-bicycle-crunch', model: deskBreak, credit: deskBreakCredit },
  { key: 'desk:chair-knee-drive-twist', label: 'Joelho ao cotovelo sentado', group: 'Abdômen e controle', animation: 'chair-knee-drive-twist', model: deskBreak, credit: deskBreakCredit },
  { key: 'desk:standing-cat-cow', label: 'Mobilidade de coluna em pé', group: 'Mobilidade e cardio leve', animation: 'standing-cat-cow', model: deskBreak, credit: deskBreakCredit },
  { key: 'desk:shoulder-rolls-back', label: 'Rotação de ombros para trás', group: 'Mobilidade e cardio leve', animation: 'shoulder-rolls-back', model: deskBreak, credit: deskBreakCredit },
  { key: 'desk:march-in-place', label: 'Marcha estacionária', group: 'Mobilidade e cardio leve', animation: 'march-in-place', model: deskBreak, credit: deskBreakCredit },
  { key: 'desk:step-jack', label: 'Polichinelo sem salto', group: 'Mobilidade e cardio leve', animation: 'step-jack', model: deskBreak, credit: deskBreakCredit },
  { key: 'desk:boxer-shuffle', label: 'Deslocamento leve de boxe', group: 'Mobilidade e cardio leve', animation: 'boxer-shuffle', model: deskBreak, credit: deskBreakCredit },
  { key: 'pilot:squat', label: 'Agachamento · modelo azul original', group: 'Modelos demonstrativos', animation: 'Agachamento ilustrativo', model: '/assets/fitness-demo-squat.glb', credit: 'Modelo 3D original do piloto Vendeweb' },
];

export const fitnessMovementByKey = new Map(fitnessMovementLibrary.map(movement => [movement.key, movement]));
export const fitnessMovementGroups = [...new Set(fitnessMovementLibrary.map(movement => movement.group))];
