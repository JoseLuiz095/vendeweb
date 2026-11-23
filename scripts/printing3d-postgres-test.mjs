/** PostgreSQL 17 real, temporário e restrito ao loopback. Não aceita DB URL. */
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import { mkdtemp, rm, realpath } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import net from 'node:net';
import { randomBytes, randomUUID } from 'node:crypto';
import {runPrinting3dTests} from './printing3d-db-test.mjs';

assert.notEqual(process.getuid?.(), 0, 'Execute este runner como usuário sem privilégios; não crie usuário do sistema automaticamente.');
assert.ok(process.env.FOOD_DB_TEST_RUNTIME, 'Defina FOOD_DB_TEST_RUNTIME para as dependências isoladas, sem URL de banco.');
const requireRuntime = createRequire(path.join(path.resolve(process.env.FOOD_DB_TEST_RUNTIME), 'food-db-test.cjs'));
const { default: EmbeddedPostgres } = await import(pathToFileURL(requireRuntime.resolve('embedded-postgres')));
const pg = requireRuntime('pg');
const password = randomBytes(24).toString('hex');
class LocalPostgres {
  constructor() { this.ready = this.start(); this.clients = new Set(); }
  async start() {
    this.parent = await realpath(tmpdir());
    this.dir = await mkdtemp(path.join(this.parent, 'food-printing3d-'));
    const socket = net.createServer();
    await new Promise((resolve, reject) => { socket.once('error', reject); socket.listen(0, '127.0.0.1', resolve); });
    const port = socket.address().port;
    await new Promise(resolve => socket.close(resolve));
    this.config = { host: '127.0.0.1', port, user: 'postgres', database: 'postgres', password,
      connectionTimeoutMillis: 10000, options: '-c statement_timeout=20000 -c lock_timeout=15000' };
    this.server = new EmbeddedPostgres({ databaseDir: path.join(this.dir, 'data'), port, user: 'postgres', password,
      authMethod: 'scram-sha-256', persistent: true, initdbFlags: ['--encoding=UTF8', '--locale=C'],
      postgresFlags: ['-k', '', '-h', '127.0.0.1', '-c', 'log_statement=none', '-c', 'log_min_error_statement=panic'],
      onLog: () => {}, onError: message => console.error(message),
    });
    await this.server.initialise(); await this.server.start();
    this.client = new pg.Client(this.config); await this.client.connect(); this.clients.add(this.client);
    const version = (await this.client.query('show server_version')).rows[0].server_version;
    assert.match(version, /^17\./); console.log(`Isolated PostgreSQL ${version}, loopback only.`);
  }
  async query(sql, args = []) {
    await this.ready;
    return this.client.query(sql, args.map(v => v !== null && typeof v === 'object' ? JSON.stringify(v) : v));
  }
  async exec(sql) { await this.ready; return this.client.query(sql); }
  async connection() {
    await this.ready; const c = new pg.Client(this.config); await c.connect(); this.clients.add(c); return c;
  }
  async close() {
    await this.ready.catch(() => {});
    await Promise.allSettled([...this.clients].map(c => c.end()));
    if (this.server) await this.server.stop();
    if (this.dir) {
      assert.equal(path.dirname(this.dir), this.parent);
      assert.ok(path.basename(this.dir).startsWith('food-printing3d-'));
      await rm(this.dir, { recursive: true, force: true, maxRetries: 20, retryDelay: 100 });
    }
  }
}

async function concurrentCases({db,q,one,check,cmd,user,store,filament,plan}) {
 await db.exec('reset role');
 await q("update food_business_profiles set primary_segment='printing3d' where store_id=$1",[store]);
 const job=await cmd('job_save',{description:'Concorrência real',quantity:1,plan});
 const a=await db.connection(),b=await db.connection();
 for(const c of [a,b]) {await c.query("select set_config('request.jwt.claims',$1,false)",[JSON.stringify({sub:user,role:'authenticated',aal:'aal1'})]);await c.query('set role authenticated');}
 const key=randomUUID(),payload={id:job.id,revision:0,outcome:'completed',pieces:1,hours:1,materials:[{inventory_item_id:filament,quantity:100,unit:'g',origin:'estimated_confirmed'}]};
 const call=c=>c.query('select food_printing3d_command_v1($1,$2,$3,$4) result',[store,'finish',JSON.stringify(payload),key]);
 const before=Number((await one('select current_quantity from food_inventory_items where id=$1',[filament])).current_quantity);
 await a.query('begin');await call(a);
 const pid=(await b.query('select pg_backend_pid() pid')).rows[0].pid;
 const pending=call(b);
 let locked=false;const end=Date.now()+5000;
 while(Date.now()<end) {if((await one("select wait_event_type='Lock' waiting from pg_stat_activity where pid=$1",[pid])).waiting){locked=true;break;}await new Promise(r=>setTimeout(r,20));}
 check(locked,'segunda sessão aguarda lock de consumo');
 await a.query('commit');const second=await pending;
 check(second.rows[0].result.duplicate===true,'segunda sessão recebe resultado idempotente');
 check(Number((await one('select current_quantity from food_inventory_items where id=$1',[filament])).current_quantity)===before-.1,'sessões concorrentes debitam uma vez');
 check(Number((await one('select count(*) n from food_print_records where job_id=$1',[job.id])).n)===1,'sessões concorrentes geram histórico único');
 const buy=await cmd('purchase_plan',{stage:'ordered',items:[{inventory_item_id:filament,quantity:1,unit:'kg',unit_cost:50}]});
 const recv=c=>c.query('select food_printing3d_command_v1($1,$2,$3,$4)',[store,'purchase_receive',JSON.stringify({id:buy.id}),randomUUID()]);
 await a.query('begin');await recv(a);const denied=recv(b).then(()=>false,()=>true);await a.query('commit');
 check(await denied,'recebimentos simultâneos com chaves diferentes não duplicam compra');
 check(Number((await one('select count(*) n from food_inventory_movements where source_id=$1',[buy.id])).n)===1,'recebimento concorrente gera movimento único');
}
await runPrinting3dTests(new LocalPostgres(),concurrentCases);
