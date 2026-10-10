# Atha — rotina, hábitos, tarefas e treinos

Angular + TailwindCSS (`src/`) e API Node/Express (`server/`) com banco PostgreSQL.
No Vercel, o front é servido como site estático e a API roda como Vercel Function (`api/index.ts`). O banco é externo (Supabase, Neon...), e as tabelas são criadas automaticamente no primeiro acesso.

## Subir no Vercel (resumo)
1. **Banco:** crie um projeto no Supabase (ou um Postgres pelo Vercel Storage/Neon) e copie a string de conexão do **pooler** (Supabase: *Connect > Transaction pooler*, porta 6543).
2. **Vercel > Settings > Environment Variables** (marque Production, Preview e Development):
   - `DATABASE_URL` = a string de conexão (se a senha tiver `@`, `#` etc., codifique: `@` vira `%40`)
   - `JWT_SECRET` = texto longo e aleatório: `node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"`
3. Faça o deploy (ou *Redeploy*). O `vercel.json` já define build, pasta de saída e o roteamento de `/api`.
4. Abra `https://SEU-APP.vercel.app/api/health`: deve responder `{"ok":true}`. Se não, a resposta diz o que falta.

## Rodar localmente
```bash
cp .env.example .env     # preencha DATABASE_URL e JWT_SECRET (pode ser o mesmo banco do Supabase ou outro, só para testes)
npm install
npm run dev
```
- App: http://localhost:4200 · API: http://localhost:3000 (o `ng serve` já repassa `/api` para a API)
- No celular (mesmo Wi-Fi): `http://IP-DO-SEU-PC:4200`

## Estrutura
- `api/index.ts` — entrada da Function no Vercel (exporta o app Express)
- `server/app.ts` — rotas, JWT, regras de senha, limite de tentativas (no banco)
- `server/db.ts` e `server/schema.ts` — conexão Postgres e tabelas (criadas automaticamente)
- `server/index.ts` — servidor local (dev)
- `src/app` — `core.ts` (API, auth), `shell.ts` (barra inferior), `pages/*`
- `docs/PRODUTO-AUTH.md` — plano de ativação por e-mail, login com Google, termos e área de admin
