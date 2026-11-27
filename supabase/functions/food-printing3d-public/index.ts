import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.112.4';
import { createPrinting3dPublicHandler } from '../_shared/printing3dPublicHandler.ts';
Deno.serve(createPrinting3dPublicHandler({env:key=>Deno.env.get(key),fetch,client:(url,key)=>createClient(url,key,{auth:{persistSession:false,autoRefreshToken:false},global:{fetch:(input,init)=>fetch(input,{...init,signal:AbortSignal.timeout(10000)})}})}));
