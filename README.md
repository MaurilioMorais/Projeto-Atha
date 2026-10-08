# Atha — rotina, hábitos, tarefas e treinos

Uma pasta só: Angular + TailwindCSS (`src/`) e Node + Express + SQLite (`server/`, banco no arquivo `atha.db`).

## Rodar localmente (um comando)
```bash
npm install
npm run dev
```
- App: http://localhost:4200 (o `ng serve` do Angular 20 já roda sobre o Vite) · API: http://localhost:3000
- No celular (mesmo Wi-Fi): abra `http://IP-DO-SEU-PC:4200`.
- Crie sua conta na primeira tela. Seus dados ficam em `atha.db` (faça backup desse arquivo).

## Produção (app + API + banco em um só serviço)
```bash
npm run build && JWT_SECRET=um-segredo-longo npm start     # tudo em http://localhost:3000
# ou
docker build -t atha . && docker run -p 3000:3000 -v atha-data:/data -e JWT_SECRET=um-segredo-longo atha
```
Em Render, Railway ou Fly.io: use o Dockerfile, monte um volume em `/data` e defina `JWT_SECRET`.

## Variáveis de ambiente (produção)
- `JWT_SECRET` — obrigatória quando `NODE_ENV=production` (use um valor longo e aleatório)
- `TRUST_PROXY=1` — se estiver atrás de proxy/PaaS (Render, Railway, Fly...), para o limite de tentativas de login usar o IP real
- `DB_FILE`, `PORT`

Planejamento de login, ativação por e-mail, Google, termos e área de admin: `docs/PRODUTO-AUTH.md`.

## Estrutura
- `server/index.ts` — rotas, JWT e SQLite (usuários, hábitos com dias da semana, tarefas, check-ins, treinos, sessões/séries, atividade/streak)
- `src/app` — `core.ts` (API, auth), `shell.ts` (barra inferior), `pages/*`
