import { Routes } from '@angular/router';
import { authGuard } from './core';

export const routes: Routes = [
  { path: 'login', loadComponent: () => import('./pages/login').then(m => m.Login) },
  { path: 'termos', loadComponent: () => import('./pages/terms').then(m => m.Terms) },
  {
    path: '', canActivate: [authGuard], loadComponent: () => import('./shell').then(m => m.Shell),
    children: [
      { path: '', pathMatch: 'full', redirectTo: 'home' },
      { path: 'checkin', loadComponent: () => import('./pages/checkin').then(m => m.Checkin) },
      { path: 'habitos', loadComponent: () => import('./pages/habits').then(m => m.Habits) },
      { path: 'home', loadComponent: () => import('./pages/home').then(m => m.Home) },
      { path: 'tarefas', loadComponent: () => import('./pages/tasks').then(m => m.Tasks) },
      { path: 'exercicios', loadComponent: () => import('./pages/workouts').then(m => m.Workouts) },
      { path: 'config', loadComponent: () => import('./pages/settings').then(m => m.Settings) },
      { path: 'ajuda', loadComponent: () => import('./pages/help').then(m => m.Help) },
    ],
  },
  { path: '**', redirectTo: '' },
];
