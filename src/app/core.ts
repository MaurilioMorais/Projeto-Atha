import { Injectable, inject, signal } from '@angular/core';
import { HttpClient, HttpInterceptorFn } from '@angular/common/http';
import { CanActivateFn, Router } from '@angular/router';
import { catchError, map, of, tap, throwError } from 'rxjs';

export const iso = (d = new Date()) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
export const addDays = (s: string, n: number) => { const d = new Date(s + 'T12:00'); d.setDate(d.getDate() + n); return iso(d); };
export const DAYS = ['Domingo', 'Segunda', 'Terça', 'Quarta', 'Quinta', 'Sexta', 'Sábado'];
export const MONTHS = ['Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho', 'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro'];

@Injectable({ providedIn: 'root' })
export class Api {
  private http = inject(HttpClient);
  get = <T>(u: string) => this.http.get<T>('/api' + u);
  post = <T>(u: string, b: unknown = {}) => this.http.post<T>('/api' + u, b);
  put = <T>(u: string, b: unknown) => this.http.put<T>('/api' + u, b);
  patch = <T>(u: string, b: unknown) => this.http.patch<T>('/api' + u, b);
  del = <T>(u: string) => this.http.delete<T>('/api' + u);
}

@Injectable({ providedIn: 'root' })
export class Auth {
  private http = inject(HttpClient);
  private router = inject(Router);
  get token() { return localStorage.getItem('atha.token'); }
  enter(mode: 'login' | 'register', body: object) {
    return this.http.post<{ token: string }>('/api/auth/' + mode, body).pipe(tap(r => localStorage.setItem('atha.token', r.token)));
  }
  setToken(t: string) { localStorage.setItem('atha.token', t); }
  logout() { localStorage.removeItem('atha.token'); this.router.navigateByUrl('/login'); }
}

export const authInterceptor: HttpInterceptorFn = (req, next) => {
  const auth = inject(Auth);
  const t = auth.token;
  return next(t ? req.clone({ setHeaders: { Authorization: `Bearer ${t}` } }) : req).pipe(
    catchError(e => { if (e.status === 401 && !req.url.includes('/auth/')) auth.logout(); return throwError(() => e); }),
  );
};
// só entra no app com sessão válida e termos aceitos (token antigo / usuário inexistente -> login)
export const authGuard: CanActivateFn = () => {
  const router = inject(Router), http = inject(HttpClient);
  if (!inject(Auth).token) return router.parseUrl('/login');
  return http.get<{ termsOk: boolean }>('/api/me').pipe(
    map(m => (m.termsOk ? true : router.parseUrl('/termos?aceitar=1'))),
    catchError(e => { if (e.status === 401) localStorage.removeItem('atha.token'); return of(e.status === 401 ? router.parseUrl('/login') : true); }),
  );
};

export const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/; // igual ao do servidor

// política de senha (mesmas regras do servidor, em server/index.ts)
const COMMON = ['123456', '12345678', '123456789', '1234567890', 'password', 'password1!', 'senha123', 'senha123!', 'senha@123', 'qwerty123', 'qwerty123!', 'abc12345', 'admin123', 'admin@123', 'minhasenha', 'iloveyou', 'mudar123', 'mudar@123', 'atha1234', 'atha@1234'];
export const PW_RULES: { label: string; ok: (p: string, c: { email: string; name: string }) => boolean }[] = [
  { label: 'Mínimo de 10 caracteres', ok: p => p.length >= 10 },
  { label: 'Uma letra minúscula', ok: p => /[a-z]/.test(p) },
  { label: 'Uma letra maiúscula', ok: p => /[A-Z]/.test(p) },
  { label: 'Um número', ok: p => /\d/.test(p) },
  { label: 'Um símbolo (ex.: ! @ # $)', ok: p => /[^A-Za-z0-9]/.test(p) },
  { label: 'Sem seu nome ou e-mail e sem senhas comuns', ok: (p, c) => {
    const l = p.toLowerCase(), u = c.email.split('@')[0].toLowerCase();
    return !(COMMON.includes(l) || /^(.)\1+$/.test(p) || (u.length >= 3 && l.includes(u)) || c.name.toLowerCase().split(/\s+/).some(w => w.length >= 3 && l.includes(w)));
  } },
];

@Injectable({ providedIn: 'root' })
export class Theme {
  dark = signal(document.documentElement.classList.contains('dark'));
  toggle() {
    const d = !this.dark();
    this.dark.set(d);
    document.documentElement.classList.toggle('dark', d);
    try { localStorage.setItem('atha.theme', d ? 'dark' : 'light'); } catch {}
    document.querySelector('meta[name=theme-color]')?.setAttribute('content', d ? '#0b0f17' : '#0f172a');
  }
}
