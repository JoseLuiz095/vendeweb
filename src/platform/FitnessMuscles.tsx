import { useId } from 'react';

export const muscleLabels:Record<string,string>={quadriceps:'Quadríceps',hamstrings:'Posteriores da coxa',glutes:'Glúteos',back:'Costas',chest:'Peitoral',shoulders:'Ombros',biceps:'Bíceps',triceps:'Tríceps',core:'Tronco',calves:'Panturrilhas'};
/** Original symbolic body map. Regions identify labels; they are not anatomical measurements. */
export function FitnessMuscles({primary=[],secondary=[]}:{primary?:string[];secondary?:string[]}) {
  const id=useId();
  const shapes:Record<string,string>={quadriceps:'M66 107h17v43H66z M87 107h17v43H87z',hamstrings:'M226 107h17v43h-17z M247 107h17v43h-17z',glutes:'M225 87h40v21h-40z',back:'M226 45h38v42h-38z',chest:'M66 46h38v22H66z',shoulders:'M51 43h14v18H51z M105 43h14v18h-14z',biceps:'M49 62h13v25H49z M108 62h13v25h-13z',triceps:'M209 62h13v25h-13z M268 62h13v25h-13z',core:'M68 70h34v31H68z',calves:'M228 153h13v27h-13z M249 153h13v27h-13z'};
  return <figure className="fitness-muscles">
    <svg viewBox="0 0 330 210" role="img" aria-labelledby={id}>
      <title id={id}>Mapa corporal esquemático. Principais: {primary.map(x=>muscleLabels[x]||x).join(', ')||'não informados'}. Secundários: {secondary.map(x=>muscleLabels[x]||x).join(', ')||'não informados'}.</title>
      {[85,245].map(x=><g key={x} fill="none" stroke="currentColor" strokeWidth="2"><circle cx={x} cy="25" r="14"/><path d={`M${x-20} 43h40l17 51-12 5-8-25v31l-2 80h-16l-4-65-4 65h-16l-2-80V74l-8 25-12-5Z`}/></g>)}
      {Object.entries(shapes).map(([key,path])=><path key={key} d={path} fill="currentColor" fillOpacity={primary.includes(key)?'.8':secondary.includes(key)?'.3':'.04'} stroke={secondary.includes(key)?'currentColor':'none'} strokeDasharray="3 2"/>)}
      <text x="85" y="205" textAnchor="middle" fill="currentColor">Frente</text><text x="245" y="205" textAnchor="middle" fill="currentColor">Costas</text>
    </svg>
    <figcaption><strong>Principais:</strong> {primary.map(x=>muscleLabels[x]||x).join(', ')||'A definir pelo profissional'}<br/><strong>Secundários (contorno):</strong> {secondary.map(x=>muscleLabels[x]||x).join(', ')||'A definir pelo profissional'}<br/><small>Localização simbólica; não mede ativação muscular nem substitui orientação.</small></figcaption>
  </figure>;
}
