// @ts-nocheck
// API do Atha (Express). Roda de duas formas com o mesmo código:
//  - no Vercel, como Function (api/index.ts exporta este app);
//  - localmente, com `npm run dev` (server/index.ts faz o listen).
import express from 'express';
import jwt from 'jsonwebtoken';
import { randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';
import { ConfigError, ensureSchema, getSql, hasDbUrl } from './db';

declare global { namespace Express { interface Request { uid: number } } }

// `sql` é só um atalho: abre a conexão no primeiro uso. Use como tagged template: sql`select ... ${valor}`
const sql: any = Object.assign((...a: any[]) => getSql()(...a), { begin: (fn: any) => getSql().begin(fn) });

const DAYS = ['Domingo', 'Segunda', 'Terça', 'Quarta', 'Quinta', 'Sexta', 'Sábado'];
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const STATUSES = ['SEM_PLANEJAMENTO', 'NAO_INICIADA', 'INICIADA', 'FINALIZADA'];

// ---------- configuração ----------
const isProd = () => process.env.NODE_ENV === 'production' || !!process.env.VERCEL;
const secret = () => {
  const s = process.env.JWT_SECRET;
  if (s) return s;
  if (isProd()) throw new ConfigError('JWT_SECRET não definida: crie essa variável de ambiente');
  return 'dev-secret-somente-para-desenvolvimento-local';
};

// ---------- utilidades de data (strings YYYY-MM-DD, sem fuso) ----------
const iso = (d = new Date()) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const addDays = (s: string, n: number) => { const d = new Date(s + 'T12:00'); d.setDate(d.getDate() + n); return iso(d); };
const dateOr = (v: unknown, fallback: string) => (DATE_RE.test(String(v ?? '')) ? String(v) : fallback);

// dias da semana do hábito: '' = todos os dias, senão "1,3,5" (0 = domingo)
const wkStr = (a: unknown) => { const u = [...new Set((Array.isArray(a) ? a : []).map(Number).filter(n => Number.isInteger(n) && n >= 0 && n <= 6))].sort(); return u.length === 7 ? '' : u.join(','); };
const wkArr = (s: string) => (s ? s.split(',').map(Number) : []);

// ---------- senhas e sessão ----------
const hash = (p: string) => { const s = randomBytes(16).toString('hex'); return s + ':' + scryptSync(p, s, 32).toString('hex'); };
const check = (p: string, h: string) => {
  try { const [s, k] = h.split(':'); const a = scryptSync(p, s, 32), b = Buffer.from(k, 'hex'); return a.length === b.length && timingSafeEqual(a, b); } catch { return false; }
};
let dummy: string | undefined;
const DUMMY = () => (dummy ??= hash('senha-ficticia-para-igualar-o-tempo')); // mesmo custo de tempo com ou sem usuário
const sign = (id: number) => jwt.sign({ id }, secret(), { expiresIn: '30d' });

// versão vigente dos Termos/Privacidade: ao mudar, todos precisam aceitar de novo
const TERMS_VERSION = '2026-10';

// política de senha (mesmas regras do front, em src/app/core.ts)
const COMMON = ['123456', '12345678', '123456789', '1234567890', 'password', 'password1!', 'senha123', 'senha123!', 'senha@123', 'qwerty123', 'qwerty123!', 'abc12345', 'admin123', 'admin@123', 'minhasenha', 'iloveyou', 'mudar123', 'mudar@123', 'atha1234', 'atha@1234'];
type Ctx = { email: string; name: string };
const PW_RULES: [string, (p: string, c: Ctx) => boolean][] = [
  ['Mínimo de 10 caracteres', p => p.length >= 10],
  ['Uma letra minúscula', p => /[a-z]/.test(p)],
  ['Uma letra maiúscula', p => /[A-Z]/.test(p)],
  ['Um número', p => /\d/.test(p)],
  ['Um símbolo (ex.: ! @ # $)', p => /[^A-Za-z0-9]/.test(p)],
  ['Sem seu nome ou e-mail e sem senhas comuns', (p, c) => {
    const l = p.toLowerCase(), u = c.email.split('@')[0].toLowerCase();
    return !(COMMON.includes(l) || /^(.)\1+$/.test(p) || (u.length >= 3 && l.includes(u)) || c.name.toLowerCase().split(/\s+/).some(w => w.length >= 3 && l.includes(w)));
  }],
];
const pwProblems = (p: string, email: string, name: string) =>
  p.length > 128 ? ['Máximo de 128 caracteres'] : PW_RULES.filter(([, ok]) => !ok(p, { email, name })).map(([label]) => label);

// ---------- limite de tentativas (no banco: no Vercel a memória não é compartilhada entre instâncias) ----------
// 5 erros por IP + e-mail bloqueiam por 15 min.
const WINDOW = 15 * 60_000, MAX_FAILS = 5;
const locked = async (k: string) => (await sql`select 1 from rate_limits where key = ${k} and n >= ${MAX_FAILS} and window_start > ${Date.now() - WINDOW}`).length > 0;
const failed = async (k: string) => {
  const now = Date.now(), from = now - WINDOW;
  await sql`delete from rate_limits where window_start < ${from}`;
  await sql`insert into rate_limits(key, n, window_start) values (${k}, 1, ${now})
    on conflict (key) do update set
      n = case when rate_limits.window_start > ${from} then rate_limits.n + 1 else 1 end,
      window_start = case when rate_limits.window_start > ${from} then rate_limits.window_start else ${now} end`;
};
const clearFails = (k: string) => sql`delete from rate_limits where key = ${k}`;
const ipOf = (req: any) =>
  String(req.headers['x-vercel-forwarded-for'] || req.headers['x-forwarded-for'] || req.socket?.remoteAddress || 'ip').split(',')[0].trim();

// Express 4 não captura erros de funções async: este wrapper manda para o error handler.
const A = (fn: any) => (req: any, res: any, next: any) => Promise.resolve(fn(req, res, next)).catch(next);

// pronto = configuração ok + tabelas criadas (feito uma vez por instância; se falhar, tenta de novo na próxima requisição)
let ready: Promise<void> | null = null;
const ensureReady = () => (ready ??= (async () => {
  const missing = [!process.env.JWT_SECRET && isProd() && 'JWT_SECRET', !hasDbUrl() && 'DATABASE_URL'].filter(Boolean);
  if (missing.length) throw new ConfigError(`Faltam variáveis de ambiente: ${missing.join(' e ')}. Crie-as no painel do Vercel (Settings > Environment Variables) e faça um novo deploy.`);
  await ensureSchema();
})().catch(e => { ready = null; throw e; }));

const app = express();
app.disable('x-powered-by');
app.use(express.json({ limit: '1mb' }));
app.use('/api', (_req, res, next) => { res.setHeader('Cache-Control', 'no-store'); next(); });

// Diagnóstico: abra /api/health no navegador para ver se o servidor e o banco estão ok depois do deploy.
app.get('/api/health', A(async (_req: any, res: any) => {
  try {
    await ensureReady();
    await sql`select 1`;
    res.json({ ok: true });
  } catch (e: any) {
    console.error('health:', e);
    res.status(503).json({ ok: false, error: e instanceof ConfigError ? e.message : 'Não foi possível conectar ao banco de dados', code: e?.code });
  }
}));

app.use('/api', A(async (_req: any, _res: any, next: any) => { await ensureReady(); next(); }));

// ---------- autenticação ----------
app.post('/api/auth/register', A(async (req: any, res: any) => {
  const name = String(req.body?.name ?? '').trim(), email = String(req.body?.email ?? '').trim().toLowerCase(), password = String(req.body?.password ?? '');
  if (name.length < 2 || name.length > 60) return res.status(400).json({ error: 'Informe seu nome (2 a 60 caracteres)' });
  if (email.length > 254 || !EMAIL_RE.test(email)) return res.status(400).json({ error: 'E-mail inválido' });
  const rules = pwProblems(password, email, name);
  if (rules.length) return res.status(400).json({ error: 'A senha não atende aos requisitos de segurança', rules });
  if (req.body?.acceptTerms !== true) return res.status(400).json({ error: 'É preciso aceitar os Termos de Uso e a Política de Privacidade' });
  const now = new Date().toISOString();
  try {
    const [u] = await sql`insert into users(name, email, hash, terms_version, terms_accepted_at, created_at)
      values (${name}, ${email}, ${hash(password)}, ${TERMS_VERSION}, ${now}, ${now.slice(0, 10)}) returning id`;
    res.status(201).json({ token: sign(u.id) });
  } catch (e: any) {
    if (e?.code === '23505') return res.status(409).json({ error: 'E-mail já cadastrado' });
    throw e;
  }
}));

app.post('/api/auth/login', A(async (req: any, res: any) => {
  const email = String(req.body?.email ?? '').trim().toLowerCase(), password = String(req.body?.password ?? '').slice(0, 200);
  const k = `${ipOf(req)}|${email}`;
  if (await locked(k)) return res.status(429).json({ error: 'Muitas tentativas. Aguarde alguns minutos e tente de novo.' });
  const [u] = await sql`select id, hash from users where email = ${email}`;
  const ok = check(password, u ? u.hash : DUMMY()); // não revela quais e-mails existem
  if (!u || !ok) { await failed(k); return res.status(401).json({ error: 'E-mail ou senha inválidos' }); }
  await clearFails(k);
  await sql`update users set last_login_at = ${new Date().toISOString()} where id = ${u.id}`;
  res.json({ token: sign(u.id) });
}));

// ---------- rotas autenticadas ----------
const r = express.Router();
r.use(A(async (req: any, res: any, next: any) => {
  try {
    const tk: any = jwt.verify((req.headers.authorization || '').slice(7), secret());
    const [u] = await sql`select token_valid_after::float8 as tva from users where id = ${Number(tk.id)}`;
    // sem usuário = conta excluída ou token de outro banco; sessões anteriores a uma troca de senha também caem
    if (!u || (u.tva && tk.iat * 1000 < u.tva)) throw new Error('sessão inválida');
    req.uid = Number(tk.id);
  } catch (e: any) {
    if (e instanceof ConfigError || e?.code) throw e; // erro de infraestrutura não vira "não autorizado"
    return res.status(401).json({ error: 'Não autorizado' });
  }
  next();
}));

const idOf = (v: unknown) => (Number.isInteger(Number(v)) ? Number(v) : -1);

r.get('/me', A(async (req: any, res: any) => {
  const [u] = await sql`select name, email, terms_version from users where id = ${req.uid}`;
  res.json({ id: req.uid, name: u.name, email: u.email, termsOk: u.terms_version === TERMS_VERSION });
}));
r.post('/me/terms', A(async (req: any, res: any) => {
  await sql`update users set terms_version = ${TERMS_VERSION}, terms_accepted_at = ${new Date().toISOString()} where id = ${req.uid}`;
  res.json({ ok: true });
}));

// ---- conta. Senha errada responde 403 (não 401) para o front não confundir com sessão expirada.
const confirmPassword = async (uid: number, password: unknown, res: any) => {
  const k = `pw|${uid}`;
  if (await locked(k)) { res.status(429).json({ error: 'Muitas tentativas. Aguarde alguns minutos.' }); return false; }
  const [u] = await sql`select hash from users where id = ${uid}`;
  if (!u || !check(String(password ?? '').slice(0, 200), u.hash)) { await failed(k); res.status(403).json({ error: 'Senha atual incorreta' }); return false; }
  await clearFails(k);
  return true;
};
r.patch('/me/profile', A(async (req: any, res: any) => {
  const [cur] = await sql`select name, email from users where id = ${req.uid}`;
  const name = String(req.body?.name ?? cur.name).trim(), email = String(req.body?.email ?? cur.email).trim().toLowerCase();
  if (name.length < 2 || name.length > 60) return res.status(400).json({ error: 'Informe seu nome (2 a 60 caracteres)' });
  if (email.length > 254 || !EMAIL_RE.test(email)) return res.status(400).json({ error: 'E-mail inválido' });
  if (email !== cur.email && !(await confirmPassword(req.uid, req.body?.password, res))) return; // trocar o e-mail exige a senha
  try {
    await sql`update users set name = ${name}, email = ${email},
      email_verified_at = case when email = ${email} then email_verified_at else null end where id = ${req.uid}`;
    res.json({ name, email });
  } catch (e: any) {
    if (e?.code === '23505') return res.status(409).json({ error: 'Este e-mail já está em uso' });
    throw e;
  }
}));
r.post('/me/password', A(async (req: any, res: any) => {
  const [u] = await sql`select name, email from users where id = ${req.uid}`;
  const current = String(req.body?.current ?? ''), next = String(req.body?.next ?? '');
  if (!(await confirmPassword(req.uid, current, res))) return;
  const rules = pwProblems(next, u.email, u.name);
  if (rules.length) return res.status(400).json({ error: 'A nova senha não atende aos requisitos de segurança', rules });
  if (next === current) return res.status(400).json({ error: 'A nova senha deve ser diferente da atual' });
  await sql`update users set hash = ${hash(next)}, token_valid_after = ${Math.floor(Date.now() / 1000) * 1000} where id = ${req.uid}`;
  res.json({ token: sign(req.uid) }); // novo token para este aparelho; os outros são desconectados
}));
r.post('/me/delete', A(async (req: any, res: any) => {
  if (!(await confirmPassword(req.uid, req.body?.password, res))) return;
  await sql`delete from users where id = ${req.uid}`; // hábitos, tarefas, check-ins e treinos saem em cascata
  res.sendStatus(204);
}));

// ---------- dashboard ----------
r.get('/dashboard', A(async (req: any, res: any) => {
  const uid = req.uid, t = dateOr(req.query.today, iso()), w = addDays(t, 7), wd = new Date(t + 'T12:00').getDay();
  const [[u], acts, tkRows, [tp], habitRows, exRows, [ci]] = await Promise.all([
    sql`select name from users where id = ${uid}`,
    // atividade por dia e tipo (hábito, check-in, tarefa concluída, treino): base do heatmap e da sequência
    sql`select date, kind, count(*)::int as n from (
          select l.date as date, 'h'::text as kind from habit_logs l join habits h on h.id = l.habit_id where h.user_id = ${uid}
          union all select date, 'c' from checkins where user_id = ${uid}
          union all select substr(finished_at, 1, 10), 't' from tasks where user_id = ${uid} and status = 'FINALIZADA' and finished_at is not null
          union all select date, 'w' from sessions where user_id = ${uid}
        ) x where date >= ${addDays(t, -400)} group by date, kind`,
    sql`select status, count(*)::int as n from tasks where user_id = ${uid} group by status`,
    sql`select
          count(*) filter (where status <> 'FINALIZADA' and due_date < ${t})::int as overdue,
          count(*) filter (where status <> 'FINALIZADA' and due_date = ${t})::int as today,
          count(*) filter (where status = 'FINALIZADA' and due_date = ${t})::int as "todayDone",
          count(*) filter (where status <> 'FINALIZADA' and due_date > ${t} and due_date <= ${w})::int as week
        from tasks where user_id = ${uid} and due_date is not null`,
    sql`select h.id, h.name, h."time", h.weekdays,
          exists(select 1 from habit_logs l where l.habit_id = h.id and l.date = ${t}) as done
        from habits h where h.user_id = ${uid} order by h."time" nulls first, h.id`,
    sql`select name from workout_exercises where user_id = ${uid} and weekday = ${wd} order by id`,
    sql`select count(*)::int as n from checkins where user_id = ${uid}`,
  ]);

  const act = new Map<string, { h: number; c: number; t: number; w: number }>();
  for (const x of acts) {
    const a = act.get(x.date) ?? act.set(x.date, { h: 0, c: 0, t: 0, w: 0 }).get(x.date)!;
    a[x.kind] = x.n;
  }
  let d = act.has(t) ? t : addDays(t, -1), streak = 0; // se hoje ainda não teve atividade, a sequência de ontem segue valendo
  while (act.has(d)) { streak++; d = addDays(d, -1); }
  const heatmap = Array.from({ length: 112 }, (_, i) => {
    const date = addDays(t, i - 111), a = act.get(date);
    return { date, score: a ? a.h + a.c + a.t + a.w : 0, h: a?.h ?? 0, c: a?.c ?? 0, t: a?.t ?? 0, w: a?.w ?? 0 };
  });
  const tk: Record<string, number> = {};
  for (const x of tkRows) tk[x.status] = x.n;
  const habits = habitRows
    .filter((h: any) => !h.weekdays || wkArr(h.weekdays).includes(wd))
    .map(({ weekdays, ...h }: any) => ({ ...h, done: !!h.done }));
  res.json({
    name: u.name, streak, heatmap, checkins: ci.n, habits,
    taskPlan: { overdue: tp?.overdue || 0, today: tp?.today || 0, todayDone: tp?.todayDone || 0, week: tp?.week || 0 },
    tasks: { pending: (tk.SEM_PLANEJAMENTO || 0) + (tk.NAO_INICIADA || 0), started: tk.INICIADA || 0, done: tk.FINALIZADA || 0 },
    workout: exRows.length ? { label: 'Treino de ' + DAYS[wd], exercises: exRows.map((e: any) => e.name) } : null,
  });
}));

// ---------- hábitos ----------
r.get('/habits', A(async (req: any, res: any) => {
  const habits = await sql`select id, name, "time", weekdays, created_at from habits where user_id = ${req.uid} order by "time" nulls first, id`;
  const logs = await sql`select habit_id, date from habit_logs where habit_id in (select id from habits where user_id = ${req.uid})`;
  const byHabit = new Map<number, string[]>();
  for (const l of logs) (byHabit.get(l.habit_id) ?? byHabit.set(l.habit_id, []).get(l.habit_id)!).push(l.date);
  res.json(habits.map((h: any) => ({ ...h, weekdays: wkArr(h.weekdays), logs: byHabit.get(h.id) ?? [] })));
}));
r.post('/habits', A(async (req: any, res: any) => {
  const { name, time, weekdays, date } = req.body ?? {};
  if (!name || String(name).length > 100) return res.status(400).json({ error: 'Nome obrigatório (até 100 caracteres)' });
  const w = wkStr(weekdays), created = dateOr(date, iso());
  const [h] = await sql`insert into habits(user_id, name, "time", weekdays, created_at)
    values (${req.uid}, ${String(name).trim()}, ${time || null}, ${w}, ${created}) returning id, name, "time", created_at`;
  res.status(201).json({ ...h, weekdays: wkArr(w), logs: [] });
}));
r.patch('/habits/:id', A(async (req: any, res: any) => {
  const id = idOf(req.params.id), b = req.body ?? {};
  if ('weekdays' in b) await sql`update habits set weekdays = ${wkStr(b.weekdays)} where id = ${id} and user_id = ${req.uid}`;
  if (b.name) await sql`update habits set name = ${String(b.name).trim()} where id = ${id} and user_id = ${req.uid}`;
  if ('time' in b) await sql`update habits set "time" = ${b.time || null} where id = ${id} and user_id = ${req.uid}`;
  const [h] = await sql`select id, name, "time", weekdays from habits where id = ${id} and user_id = ${req.uid}`;
  if (!h) return res.sendStatus(404);
  res.json({ ...h, weekdays: wkArr(h.weekdays) });
}));
r.delete('/habits/:id', A(async (req: any, res: any) => {
  await sql`delete from habits where id = ${idOf(req.params.id)} and user_id = ${req.uid}`;
  res.sendStatus(204);
}));
r.post('/habits/:id/toggle', A(async (req: any, res: any) => {
  const id = idOf(req.params.id), date = dateOr(req.body?.date, iso());
  const own = await sql`select 1 from habits where id = ${id} and user_id = ${req.uid}`;
  if (!own.length) return res.sendStatus(404);
  const del = await sql`delete from habit_logs where habit_id = ${id} and date = ${date}`;
  if (!del.count) await sql`insert into habit_logs(habit_id, date) values (${id}, ${date}) on conflict do nothing`;
  res.json({ done: !del.count });
}));

// ---------- tarefas ----------
const TF = ['name', 'description', 'category', 'status', 'started_at', 'finished_at', 'due_date'];
r.get('/tasks', A(async (req: any, res: any) => {
  res.json(await sql`select id, name, description, category, status, started_at, finished_at, due_date from tasks where user_id = ${req.uid} order by id desc`);
}));
r.post('/tasks', A(async (req: any, res: any) => {
  const b = req.body ?? {};
  if (!b.name || String(b.name).length > 200) return res.status(400).json({ error: 'Nome obrigatório (até 200 caracteres)' });
  const status = STATUSES.includes(b.status) ? b.status : 'NAO_INICIADA';
  const [t] = await sql`insert into tasks(user_id, name, description, category, status, started_at, finished_at, due_date)
    values (${req.uid}, ${String(b.name).trim()}, ${b.description || null}, ${b.category || 'Geral'}, ${status},
            ${b.started_at || null}, ${b.finished_at || null}, ${DATE_RE.test(b.due_date || '') ? b.due_date : null})
    returning id, name, description, category, status, started_at, finished_at, due_date`;
  res.status(201).json(t);
}));
r.patch('/tasks/:id', A(async (req: any, res: any) => {
  const id = idOf(req.params.id), b = req.body ?? {}, cols = TF.filter(k => k in b);
  if ('name' in b && !b.name) return res.status(400).json({ error: 'Nome obrigatório' });
  if ('status' in b && !STATUSES.includes(b.status)) return res.status(400).json({ error: 'Status inválido' });
  if (cols.length) {
    const vals: Record<string, any> = {};
    for (const k of cols) vals[k] = k === 'due_date' ? (DATE_RE.test(b[k] || '') ? b[k] : null) : b[k] || null;
    await sql`update tasks set ${sql(vals, ...cols)} where id = ${id} and user_id = ${req.uid}`;
  }
  const [t] = await sql`select id, name, description, category, status, started_at, finished_at, due_date from tasks where id = ${id} and user_id = ${req.uid}`;
  if (!t) return res.sendStatus(404);
  res.json(t);
}));
r.delete('/tasks/:id', A(async (req: any, res: any) => {
  await sql`delete from tasks where id = ${idOf(req.params.id)} and user_id = ${req.uid}`;
  res.sendStatus(204);
}));

// ---------- check-ins ----------
r.get('/checkins', A(async (req: any, res: any) => {
  const rows = await sql`select date, tags, notes from checkins where user_id = ${req.uid} order by date desc limit 30`;
  res.json(rows.map((c: any) => { let tags: string[] = []; try { tags = JSON.parse(c.tags); } catch {} return { ...c, tags }; }));
}));
r.put('/checkins/:date', A(async (req: any, res: any) => {
  const date = req.params.date;
  if (!DATE_RE.test(date)) return res.status(400).json({ error: 'Data inválida' });
  const tags = (Array.isArray(req.body?.tags) ? req.body.tags : []).map(String).slice(0, 20);
  const notes = req.body?.notes ? String(req.body.notes).slice(0, 5000) : null;
  await sql`insert into checkins(user_id, date, tags, notes) values (${req.uid}, ${date}, ${JSON.stringify(tags)}, ${notes})
    on conflict (user_id, date) do update set tags = excluded.tags, notes = excluded.notes`;
  res.json({ ok: true });
}));

// ---------- treinos (dia -> exercícios) e sessões (execução -> séries) ----------
r.get('/workouts', A(async (req: any, res: any) => {
  res.json(await sql`select id, weekday, name, sets, obs from workout_exercises where user_id = ${req.uid} order by weekday, id`);
}));
r.post('/workouts', A(async (req: any, res: any) => {
  const b = req.body ?? {}, weekday = Number(b.weekday);
  if (!b.name || !Number.isInteger(weekday) || weekday < 0 || weekday > 6) return res.status(400).json({ error: 'Dia e nome obrigatórios' });
  const sets = Math.min(50, Math.max(1, Math.round(+b.sets || 3)));
  const [w] = await sql`insert into workout_exercises(user_id, weekday, name, sets, obs)
    values (${req.uid}, ${weekday}, ${String(b.name).trim()}, ${sets}, ${b.obs || null}) returning id, weekday, name, sets, obs`;
  res.status(201).json(w);
}));
r.delete('/workouts/:id', A(async (req: any, res: any) => {
  await sql`delete from workout_exercises where id = ${idOf(req.params.id)} and user_id = ${req.uid}`;
  res.sendStatus(204);
}));

r.post('/sessions', A(async (req: any, res: any) => {
  const b = req.body ?? {};
  if (!Array.isArray(b.exercises) || b.exercises.length > 100) return res.status(400).json({ error: 'Exercícios obrigatórios' });
  const date = dateOr(b.date, iso());
  const id = await sql.begin(async (tx: any) => {
    const [s] = await tx`insert into sessions(user_id, date, label, started_at, finished_at, duration_sec)
      values (${req.uid}, ${date}, ${String(b.label || 'Treino').slice(0, 100)}, ${b.started_at || null}, ${b.finished_at || null}, ${Math.max(0, Math.round(+b.duration_sec || 0))}) returning id`;
    const rows: any[] = [];
    for (const e of b.exercises) {
      (Array.isArray(e.sets) ? e.sets.slice(0, 100) : []).forEach((st: any, i: number) =>
        rows.push({ session_id: s.id, exercise: String(e.name || 'Exercício').slice(0, 100), set_number: i + 1, reps: Math.max(0, Math.round(+st.reps || 0)), load_kg: Math.max(0, +st.load || 0) }));
    }
    if (rows.length) await tx`insert into session_sets ${tx(rows)}`;
    return s.id;
  });
  res.status(201).json({ id });
}));

// evolução: todas as séries (reps x carga) por exercício e sessão + resumo das sessões
r.get('/progress', A(async (req: any, res: any) => {
  const [sets, sessions] = await Promise.all([
    sql`select ss.exercise, s.id as session_id, s.date, ss.set_number, ss.reps, ss.load_kg
        from session_sets ss join sessions s on s.id = ss.session_id
        where s.user_id = ${req.uid} order by s.date, s.id, ss.set_number`,
    sql`select s.id, s.date, s.label, s.duration_sec, coalesce(sum(ss.reps * ss.load_kg), 0)::float8 as volume
        from sessions s left join session_sets ss on ss.session_id = s.id
        where s.user_id = ${req.uid} group by s.id order by s.date`,
  ]);
  res.json({ sessions, sets });
}));

app.use('/api', r);
app.use('/api', (_req: any, res: any) => res.status(404).json({ error: 'Rota não encontrada' }));

// erros: JSON inválido -> 400; configuração faltando -> 503 com dica; o resto -> 500 (detalhes só no log)
app.use((err: any, _req: any, res: any, _next: any) => {
  if (err?.type === 'entity.parse.failed') return res.status(400).json({ error: 'JSON inválido' });
  if (err instanceof ConfigError) { console.error(err.message); return res.status(503).json({ error: 'Servidor não configurado', hint: err.message }); }
  console.error(err);
  res.status(500).json({ error: 'Erro interno. Tente novamente em instantes.' });
});

export default app;
