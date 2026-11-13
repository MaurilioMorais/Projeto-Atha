import { Component, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Api, Auth, EMAIL_RE, PW_RULES } from '../core';

interface Msg { ok: boolean; t: string }
interface Tok { id: number; name: string; prefix: string; scopes: string; created_at: string | null; last_used_at: string | null; expires_at: string | null; revoked_at: string | null }
const fail = (e: any): Msg => ({ ok: false, t: e.error?.error || 'Não foi possível concluir. Tente de novo.' });
const SCOPES: [string, string][] = [
  ['habits:read', 'Hábitos · ler'], ['habits:write', 'Hábitos · gravar'],
  ['tasks:read', 'Tarefas · ler'], ['tasks:write', 'Tarefas · gravar'],
  ['checkins:read', 'Check-ins · ler'], ['checkins:write', 'Check-ins · gravar'],
  ['workouts:read', 'Treinos · ler'], ['workouts:write', 'Treinos · gravar'],
  ['dashboard:read', 'Painel · ler'],
];
const DEFAULT_SCOPES = ['habits:read', 'habits:write', 'tasks:read', 'tasks:write', 'dashboard:read'];

@Component({
  selector: 'app-settings',
  imports: [FormsModule],
  template: `
    <section class="space-y-4 p-5">
      <div><h1 class="text-4xl font-extrabold tracking-tight">Configurações</h1><p class="text-slate-500">Sua conta no Atha.</p></div>

      <form class="card space-y-2" (ngSubmit)="saveProfile()">
        <p class="lbl !mb-1">Perfil</p>
        <label class="block text-xs text-slate-400">Nome<input class="field mt-1" name="n" maxlength="60" [(ngModel)]="name" autocomplete="name" /></label>
        <label class="block text-xs text-slate-400">E-mail<input class="field mt-1" name="e" type="email" [(ngModel)]="email" autocomplete="email" inputmode="email" autocapitalize="off" [class.border-red-500]="emailBad()" /></label>
        @if (emailBad()) { <p class="text-xs font-semibold text-red-500">E-mail inválido. Use o formato nome@exemplo.com.</p> }
        @if (emailChanged()) {
          <label class="block text-xs text-slate-400">Senha atual (para confirmar a troca de e-mail)<input class="field mt-1" name="pc" type="password" [(ngModel)]="profPw" autocomplete="current-password" /></label>
        }
        @if (profMsg(); as m) { <p class="text-sm font-semibold" [class]="m.ok ? 'text-emerald-600' : 'text-red-600'">{{ m.t }}</p> }
        <button class="btn w-full disabled:opacity-50" type="submit" [disabled]="!profileDirty() || emailBad() || (emailChanged() && !profPw)">Salvar alterações</button>
      </form>

      <form class="card space-y-2" (ngSubmit)="savePassword()">
        <div class="flex items-center justify-between"><p class="lbl !mb-0">Alterar senha</p><button type="button" class="text-xs font-bold text-slate-400" (click)="show.set(!show())">{{ show() ? 'Ocultar' : 'Mostrar' }}</button></div>
        <input class="field" name="c" placeholder="Senha atual" [type]="show() ? 'text' : 'password'" [(ngModel)]="cur" autocomplete="current-password" />
        <input class="field" name="x" placeholder="Nova senha" [type]="show() ? 'text' : 'password'" [(ngModel)]="next" autocomplete="new-password" />
        <input class="field" name="a" placeholder="Repita a nova senha" [type]="show() ? 'text' : 'password'" [(ngModel)]="again" autocomplete="new-password" />
        @if (next) {
          <ul class="space-y-0.5 text-xs">
            @for (r of RULES; track r.label) { <li [class]="r.ok(next, ctx()) ? 'text-emerald-600' : 'text-slate-400'">{{ r.ok(next, ctx()) ? '✓' : '○' }} {{ r.label }}</li> }
          </ul>
        }
        @if (again && next !== again) { <p class="text-xs font-semibold text-red-500">As senhas não conferem</p> }
        @if (pwMsg(); as m) { <p class="text-sm font-semibold" [class]="m.ok ? 'text-emerald-600' : 'text-red-600'">{{ m.t }}</p> }
        <button class="btn w-full disabled:opacity-50" type="submit" [disabled]="!pwValid()">Alterar senha</button>
      </form>

      <div class="card space-y-2">
        <p class="lbl !mb-1">Integrações</p>
        <p class="text-sm text-slate-500">Tokens para agentes e outras ferramentas. O valor completo aparece só uma vez, na criação.</p>
        @if (fresh(); as token) {
          <div class="space-y-2 rounded-xl border border-line bg-paper p-3">
            <p class="text-xs font-bold text-emerald-600">Copie o token agora. Ele não será mostrado de novo.</p>
            <input class="field font-mono text-xs" readonly [value]="token" (focus)="$any($event.target).select()" />
            <div class="flex gap-2">
              <button type="button" class="btn flex-1" (click)="copy(token)">{{ copied() ? 'Copiado' : 'Copiar' }}</button>
              <button type="button" class="btn btn-ghost" (click)="fresh.set(null)">Ocultar</button>
            </div>
          </div>
        }
        <form class="space-y-2" (ngSubmit)="createToken()">
          <input class="field" name="tn" maxlength="80" placeholder="Nome (ex.: Agente do Notion)" [(ngModel)]="tokName" autocomplete="off" />
          <input class="field" name="td" type="number" min="1" max="3650" placeholder="Expira em dias (opcional)" [(ngModel)]="tokDays" />
          <div class="grid grid-cols-2 gap-x-2 gap-y-1">
            @for (s of SCOPES; track s[0]) {
              <label class="flex items-center gap-2 text-xs text-slate-500"><input type="checkbox" [checked]="hasScope(s[0])" (change)="toggleScope(s[0])" />{{ s[1] }}</label>
            }
          </div>
          <input class="field" name="tp" type="password" placeholder="Sua senha (para confirmar)" [(ngModel)]="tokPw" autocomplete="current-password" />
          @if (tokMsg(); as m) { <p class="text-sm font-semibold" [class]="m.ok ? 'text-emerald-600' : 'text-red-600'">{{ m.t }}</p> }
          <button class="btn w-full disabled:opacity-50" type="submit" [disabled]="!tokName.trim() || !tokPw || !tokScopes().length">Criar token</button>
        </form>
        @if (tokens().length) {
          <div class="space-y-2 pt-1">
            @for (t of tokens(); track t.id) {
              <div class="rounded-xl border border-line p-3" [class.opacity-60]="t.revoked_at">
                <div class="flex items-start justify-between gap-2">
                  <div class="min-w-0">
                    <p class="font-bold">{{ t.name }} <span class="font-mono text-xs font-normal text-slate-400">{{ t.prefix }}…</span></p>
                    <p class="mt-0.5 text-xs text-slate-400">{{ t.scopes }}</p>
                    <p class="text-xs text-slate-400">criado {{ short(t.created_at) }}@if (t.last_used_at) { · usado {{ short(t.last_used_at) }} }@if (t.expires_at) { · expira {{ short(t.expires_at) }} }@if (t.revoked_at) { · revogado }</p>
                  </div>
                  @if (!t.revoked_at) { <button type="button" class="shrink-0 text-xs font-bold text-red-500" (click)="revoke(t)">Revogar</button> }
                </div>
              </div>
            }
          </div>
        } @else { <p class="text-xs text-slate-400">Nenhum token criado.</p> }
      </div>

      <div class="card space-y-2 !border-red-500/40">
        <p class="lbl !mb-1 !text-red-500">Zona de perigo</p>
        <p class="text-sm text-slate-500">Excluir a conta apaga para sempre seu perfil, hábitos, tarefas, check-ins, treinos e tokens de integração. Não dá para desfazer.</p>
        @if (!confirmDel()) {
          <button class="btn btn-ghost w-full !border-red-500/40 !text-red-500" (click)="confirmDel.set(true)">Excluir minha conta</button>
        } @else {
          <input class="field" type="password" placeholder="Sua senha" [(ngModel)]="delPw" autocomplete="current-password" />
          <input class="field" placeholder="Digite EXCLUIR para confirmar" [(ngModel)]="delText" autocomplete="off" />
          @if (delMsg(); as m) { <p class="text-sm font-semibold text-red-600">{{ m.t }}</p> }
          <div class="flex gap-2">
            <button class="btn flex-1 !bg-red-600 !text-[#fff] disabled:opacity-50" [disabled]="delText !== 'EXCLUIR' || !delPw" (click)="remove()">Excluir definitivamente</button>
            <button class="btn btn-ghost" (click)="cancelDel()">Cancelar</button>
          </div>
        }
      </div>
    </section>`,
})
export class Settings {
  private api = inject(Api);
  private auth = inject(Auth);
  RULES = PW_RULES;
  SCOPES = SCOPES;
  me = signal<{ name: string; email: string } | null>(null);
  show = signal(false);
  confirmDel = signal(false);
  profMsg = signal<Msg | null>(null);
  pwMsg = signal<Msg | null>(null);
  delMsg = signal<Msg | null>(null);
  tokens = signal<Tok[]>([]);
  tokScopes = signal<string[]>([...DEFAULT_SCOPES]);
  fresh = signal<string | null>(null);
  copied = signal(false);
  tokMsg = signal<Msg | null>(null);
  name = ''; email = ''; profPw = ''; cur = ''; next = ''; again = ''; delPw = ''; delText = '';
  tokName = ''; tokPw = ''; tokDays: number | null = null;

  ngOnInit() {
    this.api.get<{ name: string; email: string }>('/me').subscribe(m => { this.me.set(m); this.name = m.name; this.email = m.email; });
    this.loadTokens();
  }
  loadTokens() { this.api.get<Tok[]>('/me/tokens').subscribe({ next: t => this.tokens.set(t), error: e => this.tokMsg.set(fail(e)) }); }
  hasScope(s: string) { return this.tokScopes().includes(s); }
  toggleScope(s: string) { this.tokScopes.update(l => l.includes(s) ? l.filter(x => x !== s) : [...l, s]); }
  short(v: string | null) { return v ? v.slice(0, 16).replace('T', ' ') : ''; }
  copy(value: string) {
    navigator.clipboard.writeText(value).then(() => this.copied.set(true), () => this.tokMsg.set({ ok: false, t: 'Não foi possível copiar. Selecione o token e copie manualmente.' }));
  }
  createToken() {
    if (!this.tokName.trim() || !this.tokPw || !this.tokScopes().length) return;
    this.tokMsg.set(null);
    const body: Record<string, unknown> = { name: this.tokName.trim(), password: this.tokPw, scopes: this.tokScopes() };
    if (this.tokDays != null && `${this.tokDays}` !== '') body.expires_days = Number(this.tokDays);
    this.api.post<Tok & { token: string }>('/me/tokens', body).subscribe({
      next: r => {
        this.fresh.set(r.token); this.copied.set(false); this.tokName = ''; this.tokPw = ''; this.tokDays = null;
        this.tokMsg.set({ ok: true, t: 'Token criado. Copie agora — ele não aparece de novo.' });
        this.loadTokens();
      },
      error: e => this.tokMsg.set(fail(e)),
    });
  }
  revoke(t: Tok) {
    this.api.del('/me/tokens/' + t.id).subscribe({
      next: () => this.tokens.update(l => l.map(x => x.id === t.id ? { ...x, revoked_at: new Date().toISOString() } : x)),
      error: e => this.tokMsg.set(fail(e)),
    });
  }
  ctx() { return { email: this.me()?.email ?? '', name: this.me()?.name ?? '' }; }
  emailBad() { return !!this.email.trim() && !EMAIL_RE.test(this.email.trim()); }
  emailChanged() { const m = this.me(); return !!m && this.email.trim().toLowerCase() !== m.email; }
  profileDirty() { const m = this.me(); return !!m && (this.name.trim() !== m.name || this.emailChanged()); }
  pwValid() { return !!this.cur && PW_RULES.every(r => r.ok(this.next, this.ctx())) && this.next === this.again && this.next !== this.cur; }

  saveProfile() {
    if (!this.profileDirty()) return;
    this.profMsg.set(null);
    this.api.patch<{ name: string; email: string }>('/me/profile', { name: this.name, email: this.email, password: this.profPw }).subscribe({
      next: m => { this.me.set(m); this.name = m.name; this.email = m.email; this.profPw = ''; this.profMsg.set({ ok: true, t: 'Dados atualizados.' }); },
      error: e => this.profMsg.set(fail(e)),
    });
  }
  savePassword() {
    if (!this.pwValid()) return;
    this.pwMsg.set(null);
    this.api.post<{ token: string }>('/me/password', { current: this.cur, next: this.next }).subscribe({
      next: r => { this.auth.setToken(r.token); this.cur = this.next = this.again = ''; this.pwMsg.set({ ok: true, t: 'Senha alterada. Os outros aparelhos conectados foram desconectados.' }); },
      error: e => this.pwMsg.set(fail(e)),
    });
  }
  cancelDel() { this.confirmDel.set(false); this.delPw = ''; this.delText = ''; this.delMsg.set(null); }
  remove() {
    if (this.delText !== 'EXCLUIR' || !this.delPw) return;
    this.api.post('/me/delete', { password: this.delPw }).subscribe({ next: () => this.auth.logout(), error: e => this.delMsg.set(fail(e)) });
  }
}
