/** PostgreSQL 17 real, temporário e restrito ao loopback. Não aceita DB URL. */
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import { mkdtemp, rm, realpath } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import net from 'node:net';
import { randomBytes, randomUUID } from 'node:crypto';
import { runModulesDbTests } from './modules-db-test.mjs';

assert.notEqual(process.getuid?.(), 0, 'Execute este runner como usuário sem privilégios; não crie usuário do sistema automaticamente.');
assert.ok(process.env.FOOD_DB_TEST_RUNTIME, 'Defina FOOD_DB_TEST_RUNTIME para as dependências isoladas, sem URL de banco.');
const requireRuntime = createRequire(path.join(path.resolve(process.env.FOOD_DB_TEST_RUNTIME), 'food-db-test.cjs'));
const { default: EmbeddedPostgres } = await import(pathToFileURL(requireRuntime.resolve('embedded-postgres')));
const pg = requireRuntime('pg');
// Mesma representação do PGlite para os valores pequenos da fixture.
pg.types.setTypeParser(20, Number);
const password = randomBytes(24).toString('hex');
class LocalPostgres {
  constructor() { this.ready = this.start(); this.clients = new Set(); }
  async start() {
    this.parent = await realpath(tmpdir());
    this.dir = await mkdtemp(path.join(this.parent, 'food-rental-'));
    const socket = net.createServer();
    await new Promise((resolve, reject) => { socket.once('error', reject); socket.listen(0, '127.0.0.1', resolve); });
    const port = socket.address().port;
    await new Promise(resolve => socket.close(resolve));
    this.config = { host: '127.0.0.1', port, user: 'postgres', database: 'postgres', password,
      connectionTimeoutMillis: 10000, options: '-c statement_timeout=20000 -c lock_timeout=15000' };
    this.server = new EmbeddedPostgres({ databaseDir: path.join(this.dir, 'data'), port, user: 'postgres', password,
      authMethod: 'scram-sha-256', persistent: true, initdbFlags: ['--encoding=UTF8', '--locale=C'],
      postgresFlags: ['-h', '127.0.0.1', '-c', 'log_statement=none', '-c', 'log_min_error_statement=panic'],
      onLog: () => {}, onError: () => {},
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
      assert.ok(path.basename(this.dir).startsWith('food-rental-'));
      await rm(this.dir, { recursive: true, force: true, maxRetries: 20, retryDelay: 100 });
    }
  }
}

async function concurrentCases({db,session,cmd,userB,b,rentInput}) {
 const c1=await db.connection(),c2=await db.connection();
 const jwt=JSON.stringify({sub:userB,aal:'aal1',role:'service_role'});
 const setup=async c=>{await c.query("select set_config('request.jwt.claims',$1,false)",[jwt]);};
 await setup(c1);await setup(c2);await session(userB);
 const offer=(await cmd(b,'offer_save',{name:'Unidade concorrente',kind:'rental',price_cents:10000,published:true})).id;
 const input={...rentInput,items:[{offer_id:offer,quantity:1}],request_id:randomUUID()};
 const create=(c,data)=>c.query("select public.food_modules_customer('create',$1) result",[JSON.stringify(data)]);
 const command=(c,action,data)=>c.query('select public.food_rental_command_v1($1,$2,$3) result',[b,action,JSON.stringify(data)]);
 const waitForLock=async()=>{
  const pid=(await c2.query('select pg_backend_pid() pid')).rows[0].pid;return pid;
 };
 const pid=await waitForLock();
 async function blocked(){
  const deadline=Date.now()+5000;
  while(Date.now()<deadline){if((await db.query("select wait_event_type='Lock' waiting from pg_stat_activity where pid=$1",[pid])).rows[0]?.waiting)return;await new Promise(r=>setTimeout(r,20));}
  assert.fail('A segunda sessão deveria aguardar a trava.');
 }
 await c1.query('begin');const first=(await create(c1,input)).rows[0].result;
 const competing=create(c2,{...input,request_id:randomUUID()}).then(()=>null,e=>e);
 await blocked();await c1.query('commit');assert.match((await competing)?.message,/reservado/);
 assert.equal(Number((await db.query('select count(*) from food_rental_reservations where offer_id=$1',[offer])).rows[0].count),1);
 console.log('OK PostgreSQL real: duas compras simultâneas geram uma única reserva');
 const rid=(await db.query('select id from food_rental_reservations where item_id=$1',[first.items[0].id])).rows[0].id;
 await c1.query('begin');await command(c1,'rental_asset',{offer_id:offer,maintenance:true,notes:'Revisão concorrente'});
 const next={...input,request_id:randomUUID(),scheduled_for:new Date(Date.parse(input.ends_at)+3600000).toISOString(),ends_at:new Date(Date.parse(input.ends_at)+7200000).toISOString()};
 const duringMaintenance=create(c2,next).then(()=>null,e=>e);await blocked();await c1.query('commit');assert.match((await duringMaintenance)?.message,/manutenção/);
 console.log('OK PostgreSQL real: manutenção e nova reserva são serializadas');
 await command(c1,'rental_asset',{offer_id:offer,maintenance:false});
 await c1.query('begin');await command(c1,'rental_checkout',{id:rid,method:'pickup'});
 const duplicate=command(c2,'rental_checkout',{id:rid,method:'pickup'});await blocked();await c1.query('commit');assert.equal((await duplicate).rows[0].result.already_recorded,true);
 assert.equal(Number((await db.query("select count(*) from food_rental_events where reservation_id=$1 and action='checked_out'",[rid])).rows[0].count),1);
 console.log('OK PostgreSQL real: duas confirmações de saída registram um único evento');
 await c1.query('begin');await command(c1,'rental_return',{id:rid,notes:'Danos na base',maintenance:true});
 const duplicateReturn=command(c2,'rental_return',{id:rid,notes:'Não sobrescrever'});await blocked();await c1.query('commit');assert.equal((await duplicateReturn).rows[0].result.already_recorded,true);
 const row=(await db.query('select return_notes from food_rental_reservations where id=$1',[rid])).rows[0];assert.equal(row.return_notes,'Danos na base');
 assert.equal(Number((await db.query("select count(*) from food_rental_events where reservation_id=$1 and action='returned'",[rid])).rows[0].count),1);
 console.log('OK PostgreSQL real: devoluções simultâneas preservam condição e manutenção');
}
const watchdog=setTimeout(()=>{console.error('PostgreSQL de teste não concluiu no prazo.');process.exit(1);},120000);
const db=new LocalPostgres();
try { await runModulesDbTests({db,concurrentCases}); } finally { await db.close(); clearTimeout(watchdog); }
