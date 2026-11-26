/** Bound the waiting time without logging provider errors or card data. */
export function cardBrickErrorCategory(error:unknown):string{
 const allowed=['incorrect_initialization','fields_setup_failed','get_payment_methods_failed','get_identification_types_failed','missing_locale_property','settings_empty','missing_amount_property','missing_required_callbacks','missing_container_id'];
 const candidates:unknown[]=[error];
 if(error&&typeof error==='object'){
  const record=error as Record<string,unknown>;candidates.push(record.code,record.cause);
  if(record.cause&&typeof record.cause==='object')candidates.push((record.cause as Record<string,unknown>).code);
 }
 return candidates.find(code=>typeof code==='string'&&allowed.includes(code)) as string|undefined ?? 'unknown';
}
export function watchCardForm(onFailure:()=>void,timeoutMs=15000){
 let failed=false,disposed=false;
 const fail=()=>{if(disposed||failed)return;failed=true;clearTimeout(timer);onFailure();};
 const timer=setTimeout(fail,timeoutMs);
 return {
  ready:()=>{clearTimeout(timer);if(!disposed)failed=false;},
  fail,
  dispose:()=>{disposed=true;clearTimeout(timer);},
 };
}
