// @ts-nocheck
// Conexão com o PostgreSQL (Supabase, Neon ou qualquer outro) usando o pacote `postgres`.
// A conexão é criada só no primeiro uso (lazy) e fica guardada enquanto a instância da função estiver viva.
import postgres from 'postgres';
import { SCHEMA } from './schema.js';

// Erro de configuração (variável de ambiente faltando). A API responde 503 com uma mensagem clara.
export class ConfigError extends Error {}

// Aceita DATABASE_URL, POSTGRES_URL e também o nome que a integração Vercel+Supabase cria com prefixo (ex.: DATABASE_POSTGRES_URL).
// Nunca usa as variáveis *_NON_POOLING nem *_PRISMA_URL: a conexão certa para serverless é a "pooled".
const dbUrl = () => {
  const e = process.env;
  if (e.DATABASE_URL) return e.DATABASE_URL;
  if (e.POSTGRES_URL) return e.POSTGRES_URL;
  const k = Object.keys(e).find((n) => /POSTGRES_URL$/.test(n) && !/NON_POOLING|PRISMA/.test(n) && e[n]);
  return k ? e[k]! : '';
};
export const hasDbUrl = () => !!dbUrl();

let client: any = null;
export function getSql(): any {
  if (client) return client;
  const raw = dbUrl();
  if (!raw) throw new ConfigError('Banco de dados não configurado: defina a variável DATABASE_URL');
  let url: URL;
  try { url = new URL(raw); } catch { throw new ConfigError('DATABASE_URL inválida: confira o formato e se a senha tem caracteres especiais codificados (ex.: @ vira %40)'); }
  url.searchParams.delete('supa'); // parâmetro extra que a integração Supabase/Vercel adiciona e o Postgres rejeita
  const local = ['localhost', '127.0.0.1', '::1', '[::1]'].includes(url.hostname) || process.env.DATABASE_SSL === 'false';
  client = postgres(url.toString(), {
    ssl: local ? false : 'require',
    max: 1,              // serverless: uma conexão por instância; quem faz o pool é o pooler do provedor
    prepare: false,      // obrigatório com pooler em modo "transaction" (Supabase 6543, Neon pooled)
    idle_timeout: 20,
    connect_timeout: 10,
  });
  return client;
}

// Cria as tabelas se ainda não existirem. O lock evita corrida quando várias instâncias sobem juntas.
export async function ensureSchema() {
  await getSql().begin(async (tx: any) => {
    await tx.unsafe('SELECT pg_advisory_xact_lock(727274)');
    await tx.unsafe(SCHEMA);
  });
}
