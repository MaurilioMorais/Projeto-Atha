import { Component, HostListener, inject, signal } from '@angular/core';
import { RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { Auth, Theme } from './core';

@Component({
  selector: 'app-shell',
  imports: [RouterOutlet, RouterLink, RouterLinkActive],
  template: `
    <header class="fixed inset-x-0 top-0 z-40 border-b border-line bg-surface">
      <div class="mx-auto flex h-14 max-w-md items-center justify-end px-3 md:max-w-5xl">
        <a routerLink="/config" routerLinkActive="text-brand" (click)="menu.set(false)"
           class="inline-flex h-12 items-center gap-2 rounded-full px-3 text-sm font-bold">
          <svg viewBox="0 0 24 24" class="size-5 fill-none stroke-current stroke-2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
            <circle cx="12" cy="12" r="3" />
            <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.6 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.6a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
          </svg>
          Configurações
        </a>
      </div>
    </header>
    <main class="mx-auto min-h-dvh max-w-md pt-14 pb-32 md:max-w-5xl"><router-outlet /></main>
    @if (menu()) {
      <button type="button" class="fixed inset-0 z-30 cursor-default" aria-label="Fechar menu" (click)="menu.set(false)"></button>
      <div id="menu-atalhos" role="menu" class="fixed right-4 bottom-40 z-50 w-48 rounded-2xl border border-line bg-surface p-2 shadow-lg">
        <a routerLink="/config" role="menuitem" (click)="menu.set(false)" class="block w-full rounded-xl px-3 py-2 text-left font-semibold">Configurações</a>
        <a routerLink="/ajuda" role="menuitem" (click)="menu.set(false)" class="block w-full rounded-xl px-3 py-2 text-left font-semibold">Ajuda</a>
        <button type="button" role="menuitem" (click)="theme.toggle()" class="w-full rounded-xl px-3 py-2 text-left font-semibold">{{ theme.dark() ? 'Modo claro' : 'Modo noturno' }}</button>
        <button type="button" role="menuitem" (click)="auth.logout()" class="w-full rounded-xl px-3 py-2 text-left font-semibold">Sair</button>
      </div>
    }
    <button type="button" (click)="menu.set(!menu())" [attr.aria-expanded]="menu()" aria-controls="menu-atalhos" aria-haspopup="menu"
            class="fixed right-4 bottom-24 z-50 inline-flex h-12 items-center gap-2 rounded-full bg-ink px-4 text-sm font-bold text-white shadow-lg">
      <span aria-hidden="true" class="text-lg leading-none">☰</span>
      Menu
    </button>
    <nav class="fixed inset-x-0 bottom-0 z-20 border-t border-line bg-surface pb-[env(safe-area-inset-bottom)]">
      <ul class="mx-auto grid h-16 max-w-md grid-cols-5 items-end">
        @for (i of items; track i.path) {
          <li>
            <a [routerLink]="i.path" routerLinkActive="text-ink" [attr.aria-label]="i.label"
               [class]="i.home ? 'mx-auto -mt-6 mb-2 grid size-14 place-items-center rounded-full bg-ink text-white ring-4 ring-surface' : 'flex flex-col items-center gap-0.5 pb-2 text-[10px] font-bold text-slate-400'">
              <svg viewBox="0 0 24 24" class="size-6 fill-none stroke-current stroke-2" stroke-linecap="round" stroke-linejoin="round"><path [attr.d]="i.d" /></svg>
              @if (!i.home) { <span>{{ i.label }}</span> }
            </a>
          </li>
        }
      </ul>
    </nav>`,
})
export class Shell {
  auth = inject(Auth);
  theme = inject(Theme);
  menu = signal(false);
  items = [
    { path: '/checkin', label: 'CHECK-IN', d: 'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18zm-4 9 3 3 5-6' },
    { path: '/habitos', label: 'HÁBITOS', d: 'M4 4h7v7H4zM13 4h7v7h-7zM4 13h7v7H4zM13 13h7v7h-7z' },
    { path: '/home', label: 'HOME', d: 'M4 11l8-7 8 7v9h-5v-6H9v6H4z', home: true },
    { path: '/tarefas', label: 'TAREFAS', d: 'M5 4h14v17H5zM9 4h6v3H9zM9 12h6M9 16h6' },
    { path: '/exercicios', label: 'EXERCÍCIOS', d: 'M3 8h11a3 3 0 1 0-3-3M3 12h16a3 3 0 1 1-3 3M3 16h8' },
  ];

  @HostListener('document:keydown.escape')
  closeMenu() { this.menu.set(false); }
}
