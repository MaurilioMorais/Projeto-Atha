import express from 'express';
import cors from 'cors';
import Database from 'better-sqlite3';
import jwt from 'jsonwebtoken';
import { randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

declare global { namespace Express { interface Request { uid: number } } }

const SECRET = process.env.JWT_SECRET || 'troque-este-segredo-em-producao';
if (process.env.NODE_ENV === 'production' && !process.env.JWT_SECRET) throw new Error('Defina JWT_SECRET em produção');
const DAYS = ['Domingo', 'Segunda', 'Terça', 'Quarta', 'Quinta', 'Sexta', 'Sábado'];
const db = new Database(process.env.DB_FILE || 'atha.db');
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');
db.exec(`
CREATE TABLE IF NOT EXISTS users(id INTEGER PRIMARY KEY, name TEXT NOT NULL, email TEXT UNIQUE NOT NULL, hash TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS habits(id INTEGER PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE, name TEXT NOT NULL, time TEXT, weekdays TEXT NOT NULL DEFAULT '', created_at TEXT);
CREATE TABLE IF NOT EXISTS habit_logs(habit_id INTEGER NOT NULL REFERENCES habits(id) ON DELETE CASCADE, date TEXT NOT NULL, PRIMARY KEY(habit_id, date));
CREATE TABLE IF NOT EXISTS tasks(id INTEGER PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE, name TEXT NOT NULL, description TEXT, category TEXT DEFAULT 'Geral', status TEXT NOT NULL DEFAULT 'NAO_INICIADA', started_at TEXT, finished_at TEXT);
CREATE TABLE IF NOT EXISTS checkins(user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE, date TEXT NOT NULL, tags TEXT NOT NULL DEFAULT '[]', notes TEXT, PRIMARY KEY(user_id, date));
CREATE TABLE IF NOT EXISTS workout_exercises(id INTEGER PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE, weekday INTEGER NOT NULL, name TEXT NOT NULL, sets INTEGER NOT NULL DEFAULT 3, obs TEXT);
CREATE TABLE IF NOT EXISTS sessions(id INTEGER PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE, date TEXT NOT NULL, label TEXT, started_at TEXT, finished_at TEXT, duration_sec INTEGER);
CREATE TABLE IF NOT EXISTS session_sets(id INTEGER PRIMARY KEY, session_id INTEGER NOT NULL REFERENCES sessions(id) ON DELETE CASCADE, exercise TEXT NOT NULL, set_number INTEGER NOT NULL, reps INTEGER NOT NULL, load_kg REAL NOT NULL);
CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id, date);
`);

const hcols = (db.prepare('PRAGMA table_info(habits)').all() as any[]).map(c => c.name);
if (!hcols.includes('weekdays')) db.exec("ALTER TABLE habits ADD COLUMN weekdays TEXT NOT NULL DEFAULT ''");
if (!hcols.includes('created_at')) {
  db.exec('ALTER TABLE habits ADD COLUMN created_at TEXT');
  db.exec("UPDATE habits SET created_at = COALESCE((SELECT MIN(date) FROM habit_logs WHERE habit_id = habits.id), date('now','localtime')) WHERE created_at IS NULL");
}
// migrações simples: adiciona colunas que ainda não existem (bancos antigos e novos chegam ao mesmo esquema)
const addCols = (table: string, cols: Record<string, string>) => {
  const have = (db.prepare(`PRAGMA table_info(${table})`).all() as any[]).map(c => c.name);
  for (const [c, type] of Object.entries(cols)) if (!have.includes(c)) db.exec(`ALTER TABLE ${table} ADD COLUMN ${c} ${type}`);
};
addCols('users', { terms_version: 'TEXT', terms_accepted_at: 'TEXT', email_verified_at: 'TEXT', created_at: 'TEXT', last_login_at: 'TEXT', token_valid_after: 'INTEGER' });
addCols('tasks', { due_date: 'TEXT' });
db.exec("UPDATE users SET created_at = date('now','localtime') WHERE created_at IS NULL");
// dias da semana do hábito: '' = todos os dias, senão "1,3,5" (0=domingo)
const wkStr = (a: unknown) => { const u = [...new Set((Array.isArray(a) ? a : []).map(Number).filter(n => n >= 0 && n <= 6))].sort(); return u.length === 7 ? '' : u.join(','); };
const wkArr = (s: string) => (s ? s.split(',').map(Number) : []);
const iso = (d = new Date()) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const addDays = (s: string, n: number) => { const d = new Date(s + 'T12:00'); d.setDate(d.getDate() + n); return iso(d); };
// Streak e heatmap vêm dos registros reais (hábitos, check-ins, tarefas concluídas e treinos), então desmarcar algo também remove o dia.

const hash = (p: string) => { const s = randomBytes(16).toString('hex'); return s + ':' + scryptSync(p, s, 32).toString('hex'); };
const check = (p: string, h: string) => { const [s, k] = h.split(':'); return timingSafeEqual(scryptSync(p, s, 32), Buffer.from(k, 'hex')); };
const sign = (id: number) => jwt.sign({ id }, SECRET, { expiresIn: '30d' });

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

// limite de tentativas de login (por IP + e-mail): 5 erros bloqueiam por 15 min. Em memória: com várias instâncias, mover para Redis.
const fails = new Map<string, { n: number; at: number }>();
const WINDOW = 15 * 60_000, MAX_FAILS = 5;
const locked = (k: string) => { const f = fails.get(k); return !!f && f.n >= MAX_FAILS && Date.now() - f.at < WINDOW; };
const failed = (k: string) => { const f = fails.get(k), now = Date.now(); fails.set(k, f && now - f.at < WINDOW ? { n: f.n + 1, at: f.at } : { n: 1, at: now }); };
setInterval(() => { const n = Date.now(); for (const [k, f] of fails) if (n - f.at > WINDOW) fails.delete(k); }, WINDOW).unref();
const DUMMY = hash('senha-ficticia-para-igualar-o-tempo');

const app = express();
app.disable('x-powered-by');
if (process.env.TRUST_PROXY) app.set('trust proxy', 1); // atrás de proxy/PaaS: usa o IP real no limite de tentativas
app.use(cors());
app.use(express.json({ limit: '1mb' }));

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
app.post('/api/auth/register', (req, res) => {
  const name = String(req.body?.name ?? '').trim(), email = String(req.body?.email ?? '').trim().toLowerCase(), password = String(req.body?.password ?? '');
  if (name.length < 2 || name.length > 60) return res.status(400).json({ error: 'Informe seu nome (2 a 60 caracteres)' });
  if (email.length > 254 || !EMAIL_RE.test(email)) return res.status(400).json({ error: 'E-mail inválido' });
  const rules = pwProblems(password, email, name);
  if (rules.length) return res.status(400).json({ error: 'A senha não atende aos requisitos de segurança', rules });
  if (req.body?.acceptTerms !== true) return res.status(400).json({ error: 'É preciso aceitar os Termos de Uso e a Política de Privacidade' });
  try {
    const now = new Date().toISOString();
    const id = Number(db.prepare('INSERT INTO users(name,email,hash,terms_version,terms_accepted_at,created_at) VALUES(?,?,?,?,?,?)')
      .run(name, email, hash(password), TERMS_VERSION, now, now.slice(0, 10)).lastInsertRowid);
    res.status(201).json({ token: sign(id) });
  } catch { res.status(409).json({ error: 'E-mail já cadastrado' }); }
});
app.post('/api/auth/login', (req, res) => {
  const email = String(req.body?.email ?? '').trim().toLowerCase(), password = String(req.body?.password ?? '').slice(0, 200);
  const k = `${req.ip}|${email}`;
  if (locked(k)) return res.status(429).json({ error: 'Muitas tentativas. Aguarde alguns minutos e tente de novo.' });
  const u = db.prepare('SELECT id,hash FROM users WHERE email=?').get(email) as any;
  const ok = check(password, u ? u.hash : DUMMY); // mesmo custo com ou sem usuário: não revela quais e-mails existem
  if (!u || !ok) { failed(k); return res.status(401).json({ error: 'E-mail ou senha inválidos' }); }
  fails.delete(k);
  db.prepare('UPDATE users SET last_login_at=? WHERE id=?').run(new Date().toISOString(), u.id);
  res.json({ token: sign(u.id) });
});

const r = express.Router();
r.use((req, res, next) => {
  try {
    const tk = jwt.verify((req.headers.authorization || '').slice(7), SECRET) as any;
    const u = db.prepare('SELECT token_valid_after FROM users WHERE id=?').get(tk.id) as any; // sem usuário = token de um banco antigo
    if (!u || (u.token_valid_after && tk.iat * 1000 < u.token_valid_after)) throw new Error('sessão inválida');
    req.uid = tk.id;
    next();
  }
  catch { res.status(401).json({ error: 'Não autorizado' }); }
});

r.get('/me', (req, res) => {
  const u = db.prepare('SELECT name,email,terms_version FROM users WHERE id=?').get(req.uid) as any;
  res.json({ id: req.uid, name: u.name, email: u.email, termsOk: u.terms_version === TERMS_VERSION });
});
r.post('/me/terms', (req, res) => {
  db.prepare('UPDATE users SET terms_version=?, terms_accepted_at=? WHERE id=?').run(TERMS_VERSION, new Date().toISOString(), req.uid);
  res.json({ ok: true });
});

// ---- conta. Senha errada responde 403 (não 401) para o front não confundir com sessão expirada.
const confirmPassword = (uid: number, password: unknown, res: express.Response) => {
  const k = `pw|${uid}`;
  if (locked(k)) { res.status(429).json({ error: 'Muitas tentativas. Aguarde alguns minutos.' }); return false; }
  const u = db.prepare('SELECT hash FROM users WHERE id=?').get(uid) as any;
  if (!check(String(password ?? '').slice(0, 200), u.hash)) { failed(k); res.status(403).json({ error: 'Senha atual incorreta' }); return false; }
  fails.delete(k);
  return true;
};
r.patch('/me/profile', (req, res) => {
  const cur = db.prepare('SELECT name,email FROM users WHERE id=?').get(req.uid) as any;
  const name = String(req.body?.name ?? cur.name).trim(), email = String(req.body?.email ?? cur.email).trim().toLowerCase();
  if (name.length < 2 || name.length > 60) return res.status(400).json({ error: 'Informe seu nome (2 a 60 caracteres)' });
  if (email.length > 254 || !EMAIL_RE.test(email)) return res.status(400).json({ error: 'E-mail inválido' });
  if (email !== cur.email && !confirmPassword(req.uid, req.body?.password, res)) return; // trocar o e-mail exige a senha
  try {
    db.prepare('UPDATE users SET name=?, email=?, email_verified_at = CASE WHEN email = ? THEN email_verified_at ELSE NULL END WHERE id=?').run(name, email, email, req.uid);
    res.json({ name, email });
  } catch { res.status(409).json({ error: 'Este e-mail já está em uso' }); }
});
r.post('/me/password', (req, res) => {
  const u = db.prepare('SELECT name,email FROM users WHERE id=?').get(req.uid) as any;
  const current = String(req.body?.current ?? ''), next = String(req.body?.next ?? '');
  if (!confirmPassword(req.uid, current, res)) return;
  const rules = pwProblems(next, u.email, u.name);
  if (rules.length) return res.status(400).json({ error: 'A nova senha não atende aos requisitos de segurança', rules });
  if (next === current) return res.status(400).json({ error: 'A nova senha deve ser diferente da atual' });
  db.prepare('UPDATE users SET hash=?, token_valid_after=? WHERE id=?').run(hash(next), Math.floor(Date.now() / 1000) * 1000, req.uid);
  res.json({ token: sign(req.uid) }); // novo token para este aparelho; os outros são desconectados
});
r.post('/me/delete', (req, res) => {
  if (!confirmPassword(req.uid, req.body?.password, res)) return;
  db.prepare('DELETE FROM users WHERE id=?').run(req.uid); // hábitos, tarefas, check-ins e treinos saem em cascata
  res.sendStatus(204);
});

r.get('/dashboard', (req, res) => {
  const t = String(req.query.today || iso()), uid = req.uid;
  const u = db.prepare('SELECT name FROM users WHERE id=?').get(uid) as any;
  const act = new Map<string, { h: number; c: number; t: number; w: number }>();
  for (const x of db.prepare(`SELECT date, kind, COUNT(*) AS n FROM (
      SELECT l.date AS date, 'h' AS kind FROM habit_logs l JOIN habits h ON h.id = l.habit_id WHERE h.user_id = @uid
      UNION ALL SELECT date, 'c' FROM checkins WHERE user_id = @uid
      UNION ALL SELECT substr(finished_at, 1, 10), 't' FROM tasks WHERE user_id = @uid AND status = 'FINALIZADA' AND finished_at IS NOT NULL
      UNION ALL SELECT date, 'w' FROM sessions WHERE user_id = @uid
    ) WHERE date >= @from GROUP BY date, kind`).all({ uid, from: addDays(t, -400) }) as any[]) {
    const a = act.get(x.date) ?? act.set(x.date, { h: 0, c: 0, t: 0, w: 0 }).get(x.date)!;
    (a as any)[x.kind] = x.n;
  }
  let d = act.has(t) ? t : addDays(t, -1), streak = 0;
  while (act.has(d)) { streak++; d = addDays(d, -1); }
  const heatmap = Array.from({ length: 112 }, (_, i) => {
    const date = addDays(t, i - 111), a = act.get(date);
    return { date, score: a ? a.h + a.c + a.t + a.w : 0, h: a?.h ?? 0, c: a?.c ?? 0, t: a?.t ?? 0, w: a?.w ?? 0 };
  });
  const tk: Record<string, number> = {};
  for (const x of db.prepare('SELECT status,COUNT(*) n FROM tasks WHERE user_id=? GROUP BY status').all(uid) as any[]) tk[x.status] = x.n;
  const tp = (db.prepare(`SELECT
      SUM(status != 'FINALIZADA' AND due_date < @t) AS overdue,
      SUM(status != 'FINALIZADA' AND due_date = @t) AS today,
      SUM(status = 'FINALIZADA' AND due_date = @t) AS todayDone,
      SUM(status != 'FINALIZADA' AND due_date > @t AND due_date <= @w) AS week
    FROM tasks WHERE user_id = @uid AND due_date IS NOT NULL`).get({ t, w: addDays(t, 7), uid }) as any) ?? {};
  const taskPlan = { overdue: tp.overdue || 0, today: tp.today || 0, todayDone: tp.todayDone || 0, week: tp.week || 0 };
  const wd = new Date(t + 'T12:00').getDay();
  const habits = (db.prepare(`SELECT h.id,h.name,h.time,h.weekdays,EXISTS(SELECT 1 FROM habit_logs l WHERE l.habit_id=h.id AND l.date=?) AS done
    FROM habits h WHERE h.user_id=? ORDER BY h.time,h.id`).all(t, uid) as any[])
    .filter(h => !h.weekdays || wkArr(h.weekdays).includes(wd))
    .map(({ weekdays, ...h }) => ({ ...h, done: !!h.done }));
  const ex = db.prepare('SELECT name FROM workout_exercises WHERE user_id=? AND weekday=? ORDER BY id').pluck().all(uid, wd) as string[];
  const checkins = (db.prepare('SELECT COUNT(*) n FROM checkins WHERE user_id=?').get(uid) as any).n;
  res.json({ name: u.name, streak, heatmap, checkins, habits, taskPlan,
    tasks: { pending: (tk.SEM_PLANEJAMENTO || 0) + (tk.NAO_INICIADA || 0), started: tk.INICIADA || 0, done: tk.FINALIZADA || 0 },
    workout: ex.length ? { label: 'Treino de ' + DAYS[wd], exercises: ex } : null });
});

// ---- hábitos
r.get('/habits', (req, res) => {
  const lg = db.prepare('SELECT date FROM habit_logs WHERE habit_id=?').pluck();
  res.json((db.prepare('SELECT id,name,time,weekdays,created_at FROM habits WHERE user_id=? ORDER BY time,id').all(req.uid) as any[]).map(h => ({ ...h, weekdays: wkArr(h.weekdays), logs: lg.all(h.id) })));
});
r.post('/habits', (req, res) => {
  const { name, time, weekdays, date } = req.body ?? {};
  if (!name) return res.status(400).json({ error: 'Nome obrigatório' });
  const w = wkStr(weekdays);
  const id = Number(db.prepare('INSERT INTO habits(user_id,name,time,weekdays,created_at) VALUES(?,?,?,?,?)').run(req.uid, name, time || null, w, date || iso()).lastInsertRowid);
  res.status(201).json({ id, name, time: time || null, weekdays: wkArr(w), created_at: date || iso(), logs: [] });
});
r.patch('/habits/:id', (req, res) => {
  const b = req.body ?? {};
  if ('weekdays' in b) db.prepare('UPDATE habits SET weekdays=? WHERE id=? AND user_id=?').run(wkStr(b.weekdays), req.params.id, req.uid);
  if (b.name) db.prepare('UPDATE habits SET name=? WHERE id=? AND user_id=?').run(b.name, req.params.id, req.uid);
  if ('time' in b) db.prepare('UPDATE habits SET time=? WHERE id=? AND user_id=?').run(b.time || null, req.params.id, req.uid);
  const h = db.prepare('SELECT id,name,time,weekdays FROM habits WHERE id=? AND user_id=?').get(req.params.id, req.uid) as any;
  if (!h) return res.sendStatus(404);
  res.json({ ...h, weekdays: wkArr(h.weekdays) });
});
r.delete('/habits/:id', (req, res) => { db.prepare('DELETE FROM habits WHERE id=? AND user_id=?').run(req.params.id, req.uid); res.sendStatus(204); });
r.post('/habits/:id/toggle', (req, res) => {
  const id = Number(req.params.id), date = String(req.body?.date || iso());
  if (!db.prepare('SELECT 1 FROM habits WHERE id=? AND user_id=?').get(id, req.uid)) return res.sendStatus(404);
  const del = db.prepare('DELETE FROM habit_logs WHERE habit_id=? AND date=?').run(id, date);
  if (!del.changes) { db.prepare('INSERT INTO habit_logs(habit_id,date) VALUES(?,?)').run(id, date); }
  res.json({ done: !del.changes });
});

// ---- tarefas
const TF = ['name', 'description', 'category', 'status', 'started_at', 'finished_at', 'due_date'];
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
r.get('/tasks', (req, res) => res.json(db.prepare('SELECT * FROM tasks WHERE user_id=? ORDER BY id DESC').all(req.uid)));
r.post('/tasks', (req, res) => {
  const b = req.body ?? {};
  if (!b.name) return res.status(400).json({ error: 'Nome obrigatório' });
  const id = Number(db.prepare('INSERT INTO tasks(user_id,name,description,category,status,started_at,finished_at,due_date) VALUES(?,?,?,?,?,?,?,?)')
    .run(req.uid, b.name, b.description || null, b.category || 'Geral', b.status || 'NAO_INICIADA', b.started_at || null, b.finished_at || null, DATE_RE.test(b.due_date || '') ? b.due_date : null).lastInsertRowid);
  res.status(201).json(db.prepare('SELECT * FROM tasks WHERE id=?').get(id));
});
r.patch('/tasks/:id', (req, res) => {
  const b = req.body ?? {}, f = TF.filter(k => k in b);
  if (f.length) db.prepare(`UPDATE tasks SET ${f.map(k => k + '=?').join(',')} WHERE id=? AND user_id=?`).run(...f.map(k => (k === 'due_date' ? (DATE_RE.test(b[k] || '') ? b[k] : null) : b[k] || null)), req.params.id, req.uid);
  res.json(db.prepare('SELECT * FROM tasks WHERE id=? AND user_id=?').get(req.params.id, req.uid));
});
r.delete('/tasks/:id', (req, res) => { db.prepare('DELETE FROM tasks WHERE id=? AND user_id=?').run(req.params.id, req.uid); res.sendStatus(204); });

// ---- check-ins
r.get('/checkins', (req, res) =>
  res.json((db.prepare('SELECT date,tags,notes FROM checkins WHERE user_id=? ORDER BY date DESC LIMIT 30').all(req.uid) as any[]).map(c => ({ ...c, tags: JSON.parse(c.tags) }))));
r.put('/checkins/:date', (req, res) => {
  const date = req.params.date;
  db.prepare('INSERT INTO checkins(user_id,date,tags,notes) VALUES(?,?,?,?) ON CONFLICT(user_id,date) DO UPDATE SET tags=excluded.tags, notes=excluded.notes')
    .run(req.uid, date, JSON.stringify(req.body?.tags ?? []), req.body?.notes || null);
  res.json({ ok: true });
});

// ---- treinos (dia -> exercícios) e sessões (execução -> séries)
r.get('/workouts', (req, res) => res.json(db.prepare('SELECT id,weekday,name,sets,obs FROM workout_exercises WHERE user_id=? ORDER BY weekday,id').all(req.uid)));
r.post('/workouts', (req, res) => {
  const b = req.body ?? {};
  if (!b.name || b.weekday == null) return res.status(400).json({ error: 'Dia e nome obrigatórios' });
  const id = Number(db.prepare('INSERT INTO workout_exercises(user_id,weekday,name,sets,obs) VALUES(?,?,?,?,?)').run(req.uid, b.weekday, b.name, Math.max(1, +b.sets || 3), b.obs || null).lastInsertRowid);
  res.status(201).json({ id, weekday: b.weekday, name: b.name, sets: Math.max(1, +b.sets || 3), obs: b.obs || null });
});
r.delete('/workouts/:id', (req, res) => { db.prepare('DELETE FROM workout_exercises WHERE id=? AND user_id=?').run(req.params.id, req.uid); res.sendStatus(204); });

r.post('/sessions', (req, res) => {
  const b = req.body ?? {};
  if (!Array.isArray(b.exercises)) return res.status(400).json({ error: 'Exercícios obrigatórios' });
  const date = b.date || iso();
  const id = db.transaction(() => {
    const sid = Number(db.prepare('INSERT INTO sessions(user_id,date,label,started_at,finished_at,duration_sec) VALUES(?,?,?,?,?,?)')
      .run(req.uid, date, b.label || 'Treino', b.started_at, b.finished_at, b.duration_sec || 0).lastInsertRowid);
    const ins = db.prepare('INSERT INTO session_sets(session_id,exercise,set_number,reps,load_kg) VALUES(?,?,?,?,?)');
    for (const e of b.exercises) (e.sets || []).forEach((s: any, i: number) => ins.run(sid, e.name, i + 1, +s.reps || 0, +s.load || 0));
    return sid;
  })();
  res.status(201).json({ id });
});

// evolução: todas as séries (reps x carga) por exercício e sessão + resumo das sessões
r.get('/progress', (req, res) => {
  const sets = db.prepare(`SELECT ss.exercise, s.id AS session_id, s.date, ss.set_number, ss.reps, ss.load_kg
    FROM session_sets ss JOIN sessions s ON s.id=ss.session_id WHERE s.user_id=? ORDER BY s.date, s.id, ss.set_number`).all(req.uid);
  const sessions = db.prepare(`SELECT s.id,s.date,s.label,s.duration_sec, COALESCE(SUM(ss.reps*ss.load_kg),0) AS volume
    FROM sessions s LEFT JOIN session_sets ss ON ss.session_id=s.id WHERE s.user_id=? GROUP BY s.id ORDER BY s.date`).all(req.uid);
  res.json({ sessions, sets });
});
app.use('/api', r);

// serve o Angular compilado (produção)
const web = path.resolve(__dirname, '../dist/atha/browser');
if (fs.existsSync(web)) {
  app.use(express.static(web));
  app.get(/^(?!\/api).*/, (_q, res) => res.sendFile(path.join(web, 'index.html')));
}
app.listen(Number(process.env.PORT) || 3000, () => console.log('Atha API em http://localhost:' + (process.env.PORT || 3000)));
