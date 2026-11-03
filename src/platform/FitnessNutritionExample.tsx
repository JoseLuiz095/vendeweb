/** Visual-only sample. It is not a diet, a saved plan, or content assigned to any student. */
const sample = [
  { name: 'Arroz cozido', group: 'Cereal', amount: '80 g', tone: 'grain' },
  { name: 'Feijão cozido', group: 'Leguminosa', amount: '70 g', tone: 'bean' },
  { name: 'Legumes cozidos', group: 'Vegetais', amount: '100 g', tone: 'vegetable' },
] as const;

export function FitnessNutritionExample() {
  return <section className="fitness-nutrition-example" aria-labelledby="fitness-nutrition-example-title">
    <div><span className="fitness-demo-status">Exemplo fictício · sem prescrição</span>
      <h3 id="fitness-nutrition-example-title">Como seria a leitura de um plano alimentar</h3>
      <p>Refeição ilustrativa, sem vínculo com aluno. Uma nutricionista identificada precisará elaborar, revisar e aprovar cada plano individual antes de disponibilizá-lo.</p>
      <ul>{sample.map(item => <li key={item.name}><span className={`fitness-food-dot fitness-food-dot--${item.tone}`} aria-hidden="true"/><strong>{item.name}</strong> · {item.group} · {item.amount}</li>)}</ul>
      <p className="business-muted">Quantidades inventadas apenas para mostrar a interface; não são recomendação de consumo. Todos os pesos deste exemplo são do alimento cozido. O tamanho das áreas no desenho não representa o peso.</p>
    </div>
    <svg className="fitness-plate" viewBox="0 0 240 240" role="img" aria-labelledby="fitness-plate-title fitness-plate-desc">
      <title id="fitness-plate-title">Prato ilustrativo com três grupos de alimentos</title>
      <desc id="fitness-plate-desc">Três áreas coloridas apenas para identificação. As quantidades estão na lista em texto e não são proporcionais às áreas.</desc>
      <circle cx="120" cy="120" r="108" fill="#f8faf8" stroke="#b5c7b9" strokeWidth="3"/>
      <path d="M120 120L120 23A97 97 0 0 1 212 150Z" fill="#dec893"/>
      <path d="M120 120L212 150A97 97 0 0 1 27 145Z" fill="#a67652"/>
      <path d="M120 120L27 145A97 97 0 0 1 120 23Z" fill="#8cb696"/>
      <circle cx="120" cy="120" r="97" fill="none" stroke="#f8faf8" strokeWidth="5"/>
    </svg>
  </section>;
}
