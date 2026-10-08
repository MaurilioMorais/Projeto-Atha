import { Component, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { Auth, EMAIL_RE, PW_RULES } from '../core';

@Component({
  selector: 'app-login',
  imports: [FormsModule],
  template: `
    <form (ngSubmit)="go()" novalidate class="mx-auto flex min-h-dvh max-w-sm flex-col justify-center gap-3 p-6">
      <h1 class="text-5xl font-extrabold tracking-tight">Atha</h1>
      <p class="mb-4 text-slate-500">Faça o hoje valer a pena.</p>
      @if (reg()) { <input class="field" name="n" placeholder="Seu nome" maxlength="60" [(ngModel)]="name" autocomplete="name" /> }
      <input class="field" name="e" type="email" placeholder="E-mail" [(ngModel)]="email" autocomplete="email" inputmode="email" autocapitalize="off" (blur)="etouched.set(true)" [class.border-red-500]="emailBad()" />
      @if (emailBad()) { <p class="-mt-1 text-xs font-semibold text-red-500">E-mail inválido. Use o formato nome@exemplo.com.</p> }
      <div class="relative">
        <input class="field pr-20" name="p" placeholder="Senha" [type]="show() ? 'text' : 'password'" [(ngModel)]="password" [attr.autocomplete]="reg() ? 'new-password' : 'current-password'" />
        <button type="button" class="absolute inset-y-0 right-3 text-xs font-bold text-slate-400" (click)="show.set(!show())">{{ show() ? 'Ocultar' : 'Mostrar' }}</button>
      </div>
      @if (reg()) {
        <div class="h-1.5 overflow-hidden rounded-full bg-chip">
          <div class="h-full transition-all" [style.width.%]="(score() / RULES.length) * 100" [class]="score() === RULES.length ? 'bg-emerald-500' : 'bg-brand'"></div>
        </div>
        <ul class="space-y-0.5 text-xs">
          @for (r of RULES; track r.label) {
            <li [class]="r.ok(password, ctx()) ? 'text-emerald-600' : 'text-slate-400'">{{ r.ok(password, ctx()) ? '✓' : '○' }} {{ r.label }}</li>
          }
        </ul>
        <label class="flex items-start gap-2 text-sm">
          <input type="checkbox" name="t" class="mt-1 size-4 accent-[#f97316]" [(ngModel)]="terms" />
          <span>Li e aceito os <a href="/termos" target="_blank" rel="noopener" class="font-bold text-brand underline">Termos de Uso e a Política de Privacidade</a>.</span>
        </label>
      }
      @if (reg() && missing().length) { <p class="text-xs text-slate-500">Falta: {{ missing().join(', ') }}.</p> }
      @if (err()) { <p class="text-sm font-semibold text-red-600">{{ err() }}</p> }
      <button class="btn btn-or disabled:opacity-50" type="submit" [disabled]="busy() || (reg() && !valid())">{{ reg() ? 'Criar conta' : 'Entrar' }}</button>
      <button class="py-2 text-sm font-semibold text-slate-500" type="button" (click)="toggle()">{{ reg() ? 'Já tenho conta' : 'Criar uma conta' }}</button>
    </form>`,
})
export class Login {
  private auth = inject(Auth);
  private router = inject(Router);
  RULES = PW_RULES;
  reg = signal(false);
  show = signal(false);
  busy = signal(false);
  etouched = signal(false);
  err = signal('');
  name = ''; email = ''; password = ''; terms = false;
  ctx() { return { email: this.email, name: this.name }; }
  score() { return PW_RULES.filter(r => r.ok(this.password, this.ctx())).length; }
  emailOk() { return EMAIL_RE.test(this.email.trim()); }
  emailBad() { return this.etouched() && !!this.email.trim() && !this.emailOk(); }
  missing() {
    const m: string[] = [];
    if (this.name.trim().length < 2) m.push('seu nome');
    if (!this.emailOk()) m.push('um e-mail válido');
    if (this.score() < PW_RULES.length) m.push('uma senha que cumpra todos os requisitos');
    if (!this.terms) m.push('o aceite dos termos');
    return m;
  }
  valid() { return this.missing().length === 0; }
  toggle() { this.reg.set(!this.reg()); this.err.set(''); }
  go() {
    this.etouched.set(true);
    if (this.busy() || (this.reg() && !this.valid())) return;
    this.busy.set(true); this.err.set('');
    this.auth.enter(this.reg() ? 'register' : 'login', { name: this.name.trim(), email: this.email.trim(), password: this.password, acceptTerms: this.terms })
      .subscribe({
        next: () => this.router.navigateByUrl('/'),
        error: e => { this.busy.set(false); this.err.set(e.error?.error || 'Não foi possível conectar ao servidor'); },
      });
  }
}
