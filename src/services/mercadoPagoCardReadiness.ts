/** Bound the waiting time without logging provider errors or card data. */
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
