/** Bound the waiting time without logging provider errors or card data. */
export function cardBrickErrorCategory(error:unknown):string{
 if(!error||typeof error!=='object')return 'unknown';
 const candidate=(error as Record<string,unknown>).cause;
 const code=typeof candidate==='string'?candidate:typeof candidate==='object'&&candidate!==null?(candidate as Record<string,unknown>).code:undefined;
 return typeof code==='string'&&['incorrect_initialization','fields_setup_failed','get_payment_methods_failed','get_identification_types_failed','missing_locale_property'].includes(code)?code:'unknown';
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
