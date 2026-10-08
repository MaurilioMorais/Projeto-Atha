# Atha — login, contas e caminho para produção

Status: **[feito]** já está no código · **[plano]** só desenhado, ainda não implementado.

## 1. Política de senha [feito]
- Mínimo de 10 caracteres, com minúscula, maiúscula, número e símbolo; sem nome/e-mail dentro da senha; sem senhas comuns. Máximo de 128.
- A mesma regra roda no front (checklist ao vivo em `src/app/core.ts`) e no servidor (`server/index.ts`), que é quem vale.
- Vale para novos cadastros. Quem já tem conta mantém a senha atual.
- Login: 5 erros por IP + e-mail bloqueiam por 15 min (em memória; com mais de uma instância, trocar por Redis). Mesma mensagem e mesmo custo de tempo para e-mail inexistente ou senha errada.
- Próximos passos: checar a senha contra vazamentos (API Pwned Passwords, k-anonymity) e migrar o hash de scrypt para argon2id.

## 2. Ativação de conta por e-mail [plano]
**Fluxo**
1. `POST /auth/register` cria o usuário com `email_verified_at = NULL` (a coluna já existe) e envia um e-mail com link `https://app/verificar?token=...`.
2. A tela `/verificar` chama `POST /auth/verify {token}`; o servidor marca `email_verified_at` e entra no app.
3. Enquanto não verificado, `/me` devolve `emailVerified: false` e o guard do Angular mostra "Confirme seu e-mail" (com **Reenviar**), do mesmo jeito que já faz com os termos.

**Tabela nova**: `email_tokens(id, user_id, token_hash, purpose, expires_at, used_at, created_at)`
- Token = 32 bytes aleatórios; guardar só o **hash SHA-256** (se o banco vazar, os links não funcionam).
- `purpose` = `verify` ou `reset`, então a **recuperação de senha** reaproveita a mesma estrutura.
- Validade de 24 h (reset: 1 h), uso único, reenvio limitado (ex.: 3 por hora).

**Cuidados**
- Cadastro com resposta neutra ("se o e-mail for novo, enviamos um link"), para não revelar quem já tem conta. Hoje devolve 409.
- Envio: Nodemailer com um provedor transacional (Resend, Postmark ou Amazon SES); configurar SPF, DKIM e DMARC no domínio. Em desenvolvimento, imprimir o link no console.
- Contas antigas: marcar como verificadas na migração.
- Feature flag `REQUIRE_EMAIL_VERIFICATION` para ligar quando o envio estiver pronto.

## 3. Login com Google [plano]
**Fluxo (Google Identity Services + ID token)**
1. O front mostra o botão do Google (script `accounts.google.com/gsi/client`) e recebe um `credential` (ID token).
2. `POST /auth/google {credential}`. O servidor valida com `google-auth-library` (`verifyIdToken`, `audience = GOOGLE_CLIENT_ID`) e exige `email_verified = true`.
3. Se já existe `identities(provider='google', provider_user_id=sub)`, faz login. Se não, procura o usuário pelo e-mail: **se já tem conta com senha, pede o login normal antes de vincular** (evita sequestro de conta); se não existe, cria o usuário. A conta do Google já vale como e-mail verificado.
4. O servidor devolve o mesmo JWT de hoje; o resto do app não muda.

**Banco**: `identities(id, user_id, provider, provider_user_id, email, created_at, UNIQUE(provider, provider_user_id))` e `users.hash` passa a aceitar NULL (usuário só com Google; exige recriar a tabela no SQLite).
**Configuração**: projeto no Google Cloud, tela de consentimento, Client ID Web, origens autorizadas (localhost:4200 e o domínio final), variável `GOOGLE_CLIENT_ID`. O aceite dos termos continua obrigatório no primeiro acesso.

## 4. Termos e privacidade [feito, texto é rascunho]
- Cadastro exige o aceite; ficam gravados `terms_version` e `terms_accepted_at`. Se a versão (`TERMS_VERSION` no servidor) mudar, todos veem a tela de aceite no próximo acesso.
- O texto em `src/app/pages/terms.ts` é um rascunho: preencher `[NOME DA EMPRESA]` e `[E-MAIL DE CONTATO]` e **revisar com advogado** (LGPD) antes de publicar. Foi escrito só com o que o app realmente faz hoje.
- Falta: exclusão de conta pelo app e exportação dos dados (direitos da LGPD).

## 5. Área de admin [plano]
- `users.role` (`user` | `admin`) e um middleware `requireAdmin` no servidor. Esconder o link não protege, a regra é de servidor.
- Rota própria (ex.: `/admin`, sem link no app), de preferência em outro subdomínio, com login separado, **2FA obrigatório**, limite de tentativas e, se possível, lista de IPs permitidos.
- Só dados **agregados**: cadastros por dia, usuários ativos (DAU/WAU/MAU), retenção, uso por módulo (nº de check-ins, hábitos marcados, treinos, tarefas), erros. Nada de nomes de hábitos, tarefas, observações ou cargas, e nada de senha/token.
- Fonte: tabela `events(id, ts, user_hash, type)` com identificador anonimizado, ou consultas agregadas no próprio banco.
- Log de auditoria de tudo o que o admin consulta; a ação precisa constar nos termos.

## 6. Antes de abrir ao público
HTTPS obrigatório · `JWT_SECRET` forte (o servidor já recusa subir em produção sem ele) · `TRUST_PROXY=1` atrás de proxy · backup diário do banco (`atha.db` ou volume) · avaliar PostgreSQL se houver várias instâncias · cabeçalhos de segurança (helmet + CSP) · logs e monitoramento · página de contato/suporte.

## 7. Configurações da conta [feito]
- Menu ☰ → **Configurações**: alterar nome, e-mail e senha, e excluir a conta. **Ajuda** traz um FAQ.
- Trocar e-mail ou senha exige a **senha atual** (com limite de tentativas). Ao trocar a senha, as sessões dos outros aparelhos são encerradas.
- Excluir a conta pede a senha e a palavra EXCLUIR, e apaga em cascata perfil, hábitos, tarefas, check-ins e treinos.
- Falta: confirmar o novo e-mail por link (depende do item 2) e exportar os dados antes de excluir.
