// Exercita tokens de integração e os upserts idempotentes.
// Precisa de DATABASE_URL (Postgres local) e usa JWT_SECRET só desta execução.
// Não rode contra o banco de produção: o script cria e apaga um usuário de teste.
import type { AddressInfo } from 'node:net';
import postgres from 'postgres';
import app from '../server/app.ts';
import { ensureSchema } from '../server/db.ts';

const url = process.env.DATABASE_URL || process.env.POSTGRES_URL;
if (!url) {
  console.error('Defina DATABASE_URL para um Postgres de teste e rode de novo.');
  process.exit(1);
}
process.env.JWT_SECRET ||= 'smoke-integrations-secret';

const assert = (cond: unknown, msg: string) => {
  if (!cond) throw new Error(msg);
};

const DT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/;

async function main() {
  await ensureSchema();
  // simula um banco já em produção (sem as colunas/tabela novas) e reaplica o schema
  const admin = postgres(url, { ssl: false, max: 1, prepare: false, onnotice: () => {} });
  await admin.unsafe(`
    DROP TABLE IF EXISTS api_tokens;
    ALTER TABLE habits DROP COLUMN IF EXISTS source, DROP COLUMN IF EXISTS external_id, DROP COLUMN IF EXISTS updated_at;
    ALTER TABLE tasks DROP COLUMN IF EXISTS source, DROP COLUMN IF EXISTS external_id, DROP COLUMN IF EXISTS updated_at;
  `);
  await ensureSchema();
  const cols = await admin`select table_name, column_name from information_schema.columns
    where table_schema = 'public' and column_name in ('source', 'external_id', 'updated_at', 'token_hash')`;
  const has = (table: string, column: string) => cols.some(c => c.table_name === table && c.column_name === column);
  assert(has('habits', 'source') && has('habits', 'external_id') && has('habits', 'updated_at'), 'migração de habits');
  assert(has('tasks', 'source') && has('tasks', 'external_id') && has('tasks', 'updated_at'), 'migração de tasks');
  assert(has('api_tokens', 'token_hash'), 'tabela api_tokens');
  const indexes = await admin`select indexname from pg_indexes where indexname in ('idx_api_tokens_user', 'idx_habits_external', 'idx_tasks_external')`;
  assert(indexes.length === 3, 'índices novos');
  const [rls] = await admin`select relrowsecurity from pg_class where relname = 'api_tokens'`;
  assert(rls.relrowsecurity === true, 'RLS em api_tokens');
  await admin.end();

  const server = app.listen(0, '127.0.0.1');
  await new Promise<void>(resolve => server.once('listening', () => resolve()));
  const port = (server.address() as AddressInfo).port;
  const base = `http://127.0.0.1:${port}/api`;
  const email = `i${Date.now()}@example.com`;
  const password = 'Integra#2026x';
  let jwt = '';

  const api = async (method: string, path: string, body?: unknown, token?: string) => {
    const res = await fetch(base + path, {
      method,
      headers: {
        ...(body !== undefined ? { 'content-type': 'application/json' } : {}),
        ...(token ? { authorization: `Bearer ${token}` } : {}),
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    const text = await res.text();
    let json: any = null;
    if (text) { try { json = JSON.parse(text); } catch { json = text; } }
    return { status: res.status, json };
  };

  try {
    const reg = await api('POST', '/auth/register', { name: 'Smoke', email, password, acceptTerms: true });
    assert(reg.status === 201 && reg.json.token, `cadastro falhou: ${reg.status} ${JSON.stringify(reg.json)}`);
    jwt = reg.json.token;

    const empty = await api('GET', '/me/tokens', undefined, jwt);
    assert(empty.status === 200 && Array.isArray(empty.json) && empty.json.length === 0, 'lista inicial de tokens');

    const badPw = await api('POST', '/me/tokens', { name: 'x', password: 'errada' }, jwt);
    assert(badPw.status === 403, 'senha errada ao criar token');

    const created = await api('POST', '/me/tokens', { name: 'Agente', password, expires_days: 7 }, jwt);
    assert(created.status === 201, `criar token: ${created.status} ${JSON.stringify(created.json)}`);
    const raw = created.json.token as string;
    assert(raw.startsWith('atha_') && raw.length > 20, 'formato atha_');
    assert(created.json.prefix === raw.slice(0, 8), 'prefixo são os 8 primeiros caracteres');
    assert(!('token_hash' in created.json), 'hash não volta na resposta');

    const listed = await api('GET', '/me/tokens', undefined, jwt);
    assert(listed.status === 200 && listed.json.length === 1, 'lista com 1 token');
    assert(listed.json[0].prefix === created.json.prefix && !JSON.stringify(listed.json).includes(raw), 'lista não devolve o token cru');
    assert(listed.json[0].scopes === 'habits:read,habits:write,tasks:read,tasks:write,dashboard:read', 'escopos padrão');

    const agent = raw;
    assert((await api('GET', '/tasks', undefined, agent)).status === 200, 'agente lê tarefas');
    assert((await api('GET', '/dashboard', undefined, agent)).status === 200, 'agente lê o painel');
    assert((await api('GET', '/checkins', undefined, agent)).status === 403, 'escopo padrão não inclui check-in');
    assert((await api('GET', '/workouts', undefined, agent)).status === 403, 'escopo padrão não inclui treino');
    for (const path of ['/me/profile', '/me/password', '/me/delete', '/me/tokens']) {
      const method = path === '/me/profile' ? 'PATCH' : path === '/me/tokens' ? 'GET' : 'POST';
      const blocked = await api(method, path, method === 'GET' ? undefined : { password }, agent);
      assert(blocked.status === 403, `agente bloqueado em ${path} (${blocked.status})`);
    }
    assert((await api('DELETE', '/me/tokens/' + created.json.id, undefined, agent)).status === 403, 'agente não revoga token');

    const narrow = await api('POST', '/me/tokens', { name: 'Só ler hábitos', password, scopes: ['habits:read'] }, jwt);
    assert(narrow.status === 201, 'token com escopo reduzido');
    assert((await api('GET', '/habits', undefined, narrow.json.token)).status === 200, 'habits:read');
    assert((await api('POST', '/habits', { name: 'X' }, narrow.json.token)).status === 403, 'sem habits:write');
    assert((await api('GET', '/tasks', undefined, narrow.json.token)).status === 403, 'sem tasks:read');

    const habit = await api('PUT', '/habits/external/notion/h1', { name: 'Ler', weekdays: [1, 3], date: '2024-02-01' }, agent);
    assert(habit.status === 200 && habit.json.id, `upsert hábito: ${habit.status} ${JSON.stringify(habit.json)}`);
    const habit2 = await api('PUT', '/habits/external/notion/h1', { name: 'Ler de novo', time: '07:30', date: '2020-01-01' }, agent);
    assert(habit2.status === 200 && habit2.json.id === habit.json.id, 'segundo upsert reaproveita o id');
    assert(habit2.json.created_at === '2024-02-01', 'created_at não é sobrescrito');
    assert(habit2.json.name === 'Ler de novo' && habit2.json.time === '07:30', 'dados atualizados');
    assert(Array.isArray(habit2.json.weekdays) && habit2.json.weekdays.length === 0, 'dias omitidos viram todos os dias');
    assert(habit2.json.updated_at && habit2.json.updated_at !== habit.json.updated_at, 'updated_at muda no upsert');
    const habits = await api('GET', '/habits', undefined, agent);
    assert(habits.json.filter((h: any) => h.external_id === 'h1').length === 1, 'um único hábito externo');

    const day = '2024-02-02';
    assert((await api('PUT', `/habits/${habit.json.id}/logs/02-02-2024`, undefined, agent)).status === 400, 'data inválida');
    assert((await api('PUT', `/habits/999999/logs/${day}`, undefined, agent)).status === 404, 'hábito de outro dono');
    const mark1 = await api('PUT', `/habits/${habit.json.id}/logs/${day}`, undefined, agent);
    const mark2 = await api('PUT', `/habits/${habit.json.id}/logs/${day}`, undefined, agent);
    assert(mark1.status === 200 && mark1.json.done === true && mark2.json.done === true, 'marcar é idempotente');
    const unmarked = await api('DELETE', `/habits/${habit.json.id}/logs/${day}`, undefined, agent);
    const unmarked2 = await api('DELETE', `/habits/${habit.json.id}/logs/${day}`, undefined, agent);
    assert(unmarked.json.done === false && unmarked2.json.done === false, 'desmarcar é idempotente');
    const tog = await api('POST', `/habits/${habit.json.id}/toggle`, { date: day }, jwt);
    assert(tog.status === 200 && tog.json.done === true, 'toggle do front continua funcionando');

    const task = await api('PUT', '/tasks/external/notion/t1', { name: 'Entregar', status: 'FINALIZADA', date: '2024-03-04' }, agent);
    assert(task.status === 200 && DT.test(task.json.finished_at) && task.json.finished_at.startsWith('2024-03-04T'), `finished_at automático: ${task.json.finished_at}`);
    assert(task.json.updated_at, 'updated_at na tarefa');
    const task2 = await api('PUT', '/tasks/external/notion/t1', { name: 'Entregar', status: 'FINALIZADA', description: 'ok' }, agent);
    assert(task2.json.id === task.json.id && task2.json.finished_at === task.json.finished_at, 'finished_at estável no upsert repetido');
    const task3 = await api('PUT', '/tasks/external/notion/t1', { name: 'Entregar', status: 'FINALIZADA', finished_at: '2024-03-05T09:15' }, agent);
    assert(task3.json.finished_at === '2024-03-05T09:15', 'finished_at explícito prevalece');

    const posted = await api('POST', '/tasks', { name: 'Pelo app', status: 'NAO_INICIADA' }, jwt);
    assert(posted.status === 201 && posted.json.finished_at == null && posted.json.updated_at, 'POST de tarefa segue sem finished_at');
    const patched = await api('PATCH', '/tasks/' + posted.json.id, { status: 'FINALIZADA' }, jwt);
    assert(patched.status === 200 && DT.test(patched.json.finished_at), `PATCH preenche finished_at: ${patched.json.finished_at}`);
    const dated = await api('POST', '/tasks', { name: 'Com data', status: 'FINALIZADA', date: '2021-06-07' }, jwt);
    assert(dated.status === 201 && String(dated.json.finished_at).startsWith('2021-06-07T'), `POST aceita date: ${dated.json.finished_at}`);
    assert((await api('PUT', '/checkins/2024-01-09', { tags: ['ok'] }, jwt)).status === 200, 'check-in segue no JWT');
    const sess = await api('POST', '/sessions', { label: 'Treino', exercises: [{ name: 'Agachamento', sets: [{ reps: 5, load: 20 }] }], date: '2024-01-09' }, jwt);
    assert(sess.status === 201, `sessão com date: ${sess.status} ${JSON.stringify(sess.json)}`);

    const dash = await api('GET', '/dashboard?date=2024-05-01', undefined, jwt);
    assert(dash.status === 200 && dash.json.heatmap.at(-1).date === '2024-05-01', 'dashboard aceita date');

    const sql = postgres(url, { ssl: false, max: 1, prepare: false });
    try {
      const [row] = await sql`select last_used_at from api_tokens where id = ${created.json.id}`;
      assert(row.last_used_at, 'last_used_at gravado');
      const frozen = new Date().toISOString();
      await sql`update api_tokens set last_used_at = ${frozen} where id = ${created.json.id}`;
      assert((await api('GET', '/habits', undefined, agent)).status === 200, 'uso dentro da janela');
      const [same] = await sql`select last_used_at from api_tokens where id = ${created.json.id}`;
      assert(same.last_used_at === frozen, 'last_used_at não atualiza antes de 5 min');
      await sql`update api_tokens set last_used_at = ${new Date(Date.now() - 6 * 60_000).toISOString()} where id = ${created.json.id}`;
      assert((await api('GET', '/habits', undefined, agent)).status === 200, 'uso depois da janela');
      const [fresh] = await sql`select last_used_at from api_tokens where id = ${created.json.id}`;
      assert(fresh.last_used_at !== frozen && Date.parse(fresh.last_used_at) > Date.now() - 60_000, 'last_used_at atualiza depois de 5 min');

      await sql`update api_tokens set expires_at = ${new Date(Date.now() - 1000).toISOString()} where id = ${created.json.id}`;
      assert((await api('GET', '/habits', undefined, agent)).status === 401, 'token expirado');
      await sql`update api_tokens set expires_at = null, revoked_at = ${new Date().toISOString()} where id = ${created.json.id}`;
      assert((await api('GET', '/habits', undefined, agent)).status === 401, 'token revogado');
    } finally {
      await sql.end();
    }

    assert((await api('GET', '/tasks', undefined, jwt)).status === 200, 'JWT segue válido');
    const gone = await api('POST', '/me/delete', { password }, jwt);
    assert(gone.status === 204, `apagar conta: ${gone.status}`);
    jwt = '';
    console.log('ok');
  } finally {
    if (jwt) await api('POST', '/me/delete', { password }, jwt).catch(() => {});
    await new Promise<void>(resolve => server.close(() => resolve()));
  }
}

main().catch(e => { console.error(e); process.exit(1); });
