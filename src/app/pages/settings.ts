import { Component, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Api, Auth, EMAIL_RE, PW_RULES } from '../core';

interface Msg { ok: boolean; t: string }
const fail = (e: any): Msg => ({ ok: false, t: e.error?.error || 'Não foi possível concluir. Tente de novo.' });

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

      <div class="card space-y-2 !border-red-500/40">
        <p class="lbl !mb-1 !text-red-500">Zona de perigo</p>
        <p class="text-sm text-slate-500">Excluir a conta apaga para sempre seu perfil, hábitos, tarefas, check-ins e treinos. Não dá para desfazer.</p>
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
  me = signal<{ name: string; email: string } | null>(null);
  show = signal(false);
  confirmDel = signal(false);
  profMsg = signal<Msg | null>(null);
  pwMsg = signal<Msg | null>(null);
  delMsg = signal<Msg | null>(null);
  name = ''; email = ''; profPw = ''; cur = ''; next = ''; again = ''; delPw = ''; delText = '';

  ngOnInit() { this.api.get<{ name: string; email: string }>('/me').subscribe(m => { this.me.set(m); this.name = m.name; this.email = m.email; }); }
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
