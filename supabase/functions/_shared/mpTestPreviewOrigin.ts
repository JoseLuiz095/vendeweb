const pilotPreview='https://codex-mercadopago-piloto-isolado-20261119-foodweb.joseluizacama.workers.dev';
/** Only this project's explicit test preview may supplement configured origins. */
export function testOrigins(configured:string,preview:string):Set<string>{
 const allowed=new Set(configured.split(',').map(value=>value.trim()).filter(Boolean));
 if(preview===pilotPreview)allowed.add(pilotPreview);
 return allowed;
}
