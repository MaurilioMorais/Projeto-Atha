// Servidor LOCAL (npm run dev / npm start). No Vercel este arquivo não é usado: quem responde é api/index.ts.
import fs from 'node:fs';
import path from 'node:path';
import express from 'express';
import app from './app';

// carrega o .env da raiz do projeto (DATABASE_URL, JWT_SECRET). As variáveis são lidas só no primeiro uso, então a ordem dos imports não importa.
try { process.loadEnvFile('.env'); } catch { /* sem .env: usa as variáveis do ambiente */ }

// se o front já foi compilado (npm run build), serve tudo em uma porta só
const web = path.resolve(__dirname, '../dist/atha/browser');
if (fs.existsSync(web)) {
  app.use(express.static(web));
  app.get(/^(?!\/api).*/, (_q, res) => res.sendFile(path.join(web, 'index.html')));
}

const port = Number(process.env.PORT) || 3000;
app.listen(port, () => {
  console.log(`Atha API em http://localhost:${port}`);
  if (!process.env.DATABASE_URL && !process.env.POSTGRES_URL) console.warn('Atenção: DATABASE_URL não definida. Copie .env.example para .env e preencha.');
});
