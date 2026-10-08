import { Component, computed, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { Api, iso } from '../core';

interface Dash {
  name: string; streak: number; checkins: number;
  heatmap: { date: string; score: number; h: number; c: number; t: number; w: number }[];
  taskPlan: { overdue: number; today: number; todayDone: number; week: number };
  tasks: { pending: number; started: number; done: number };
  habits: { id: number; name: string; time: string | null; done: boolean }[];
  workout: { label: string; exercises: string[] } | null;
}

@Component({
  selector: 'app-home',
  imports: [RouterLink],
  template: `
    @if (d(); as d) {
      <section class="space-y-4 px-5 py-6">
        <div>
          <h1 class="text-4xl font-extrabold tracking-tight">Olá, {{ d.name }}</h1>
          <p class="text-slate-500">Faça o hoje valer a pena.</p>
        </div>
        <div class="card flex items-center gap-4">
          <span class="text-4xl">🔥</span>
          <div>
            <p class="text-2xl font-extrabold">{{ d.streak }} {{ d.streak === 1 ? 'dia seguido' : 'dias seguidos' }}</p>
            <p class="text-sm text-slate-500">Continue assim, não quebre a sequência!</p>
          </div>
        </div>
        <div class="card">
          <p class="lbl !mb-1">Seu progresso</p>
          <p class="mb-3 text-xs text-slate-500">Cada quadradinho é um dia (últimas 16 semanas). Conta tudo o que você fez: hábitos marcados, check-in, tarefas concluídas e treinos. Quanto mais laranja, mais você fez. Toque em um dia para ver o detalhe.</p>
          <div class="grid grid-flow-col grid-rows-7 gap-1 overflow-x-auto">
            @for (p of pad(); track $index) { <i class="size-3.5"></i> }
            @for (c of d.heatmap; track c.date) {
              <button class="size-3.5 rounded-sm" [class]="cell(c.score)" [class.ring-1]="c.date === pickedDate()" [class.ring-ink]="c.date === pickedDate()"
                (click)="pick.set(c.date)" [attr.aria-label]="c.date + ': ' + detail(c)"></button>
            }
          </div>
          <div class="mt-2 flex items-center justify-end gap-1 text-[10px] text-slate-400">menos <i class="size-3 rounded-sm bg-heat"></i><i class="size-3 rounded-sm bg-orange-200"></i><i class="size-3 rounded-sm bg-orange-400"></i><i class="size-3 rounded-sm bg-brand"></i> mais</div>
          @if (picked(); as p) { <p class="mt-2 border-t border-line pt-2 text-sm"><b>{{ label(p.date) }}</b> · {{ detail(p) }}</p> }
        </div>
        @let hs = hstat();
        @let tp = d.taskPlan;
        <div class="grid gap-3 md:grid-cols-2">
          <div class="card md:col-span-2">
            <div class="flex items-center justify-between"><p class="lbl !mb-0">Tarefas</p><a routerLink="/tarefas" class="text-xs font-bold text-brand">Ver todas</a></div>
            <div class="mt-3 grid grid-cols-3 gap-2 text-center">
              <a routerLink="/tarefas" [queryParams]="{ filtro: 'atrasadas' }" class="rounded-xl p-3" [class]="tp.overdue ? 'bg-red-500/10' : 'bg-chip'">
                <p class="text-2xl font-extrabold" [class.text-red-500]="tp.overdue">{{ tp.overdue }}</p><p class="text-[11px] font-semibold text-slate-500">Atrasadas</p></a>
              <a routerLink="/tarefas" [queryParams]="{ filtro: 'hoje' }" class="rounded-xl bg-chip p-3">
                <p class="text-2xl font-extrabold">{{ tp.today }}</p><p class="text-[11px] font-semibold text-slate-500">Hoje</p></a>
              <a routerLink="/tarefas" [queryParams]="{ filtro: 'semana' }" class="rounded-xl bg-chip p-3">
                <p class="text-2xl font-extrabold">{{ tp.week }}</p><p class="text-[11px] font-semibold text-slate-500">Próx. 7 dias</p></a>
            </div>
            @if (tp.today + tp.todayDone > 0) {
              <div class="mt-3">
                <p class="mb-1 text-xs font-bold">Hoje: {{ tp.todayDone }} de {{ tp.today + tp.todayDone }} concluídas</p>
                <div class="h-2 overflow-hidden rounded-full bg-chip"><div class="h-full rounded-full bg-brand transition-all" [style.width.%]="(tp.todayDone / (tp.today + tp.todayDone)) * 100"></div></div>
              </div>
            }
            <p class="mt-3 text-sm text-slate-500">{{ taskMsg() }}</p>
          </div>
          <a routerLink="/habitos" class="card">
            <div class="flex items-center justify-between"><p class="lbl !mb-0">Hábitos</p><p class="text-sm font-bold">{{ hs.done }}/{{ hs.total }} hoje</p></div>
            <div class="my-2 h-2 overflow-hidden rounded-full bg-chip"><div class="h-full rounded-full bg-brand transition-all" [style.width.%]="hs.total ? (hs.done / hs.total) * 100 : 0"></div></div>
            @if (!hs.total) { <p class="text-sm text-slate-400">Nenhum hábito programado para hoje.</p> }
            @else if (hs.next) { <p class="flex flex-wrap items-baseline gap-x-1.5 text-sm"><span class="text-slate-500">Próximo:</span><b>{{ hs.next.name }}</b>@if (hs.next.time) { <span class="text-slate-400">às {{ hs.next.time }}</span> }</p> }
            @else { <p class="text-sm font-bold text-brand">Tudo concluído hoje 🎉</p> }
          </a>
          <a routerLink="/checkin" class="card">
            <p class="lbl !mb-1">Check-ins</p>
            <p class="text-sm"><b class="text-xl font-extrabold">{{ d.checkins }}</b> <span class="ml-1 text-slate-500">feitos</span></p>
            <p class="mt-1 text-sm" [class]="d.heatmap.at(-1)?.c ? 'font-bold text-emerald-600' : 'text-slate-500'">{{ d.heatmap.at(-1)?.c ? '✓ Check-in de hoje feito' : 'Falta o check-in de hoje' }}</p>
          </a>
        </div>
        <div class="card">
          <p class="lbl">Hábitos de hoje</p>
          @for (h of d.habits; track h.id) {
            <div class="flex items-center justify-between py-2">
              <span [class.line-through]="h.done">{{ h.name }} @if (h.time) { <small class="ml-1.5 text-slate-400">{{ h.time }}</small> }</span>
              <button (click)="toggle(h.id)" [attr.aria-label]="'Marcar ' + h.name" class="grid size-8 place-items-center rounded-full border-2"
                [class]="h.done ? 'border-brand bg-brand' : 'border-slate-300'">@if (h.done) { <svg viewBox="0 0 24 24" class="size-4 fill-none stroke-[#fff] stroke-[3]" stroke-linecap="round" stroke-linejoin="round"><path d="m5 12.5 4.5 4.5L19 7.5" /></svg> }</button>
            </div>
          } @empty { <p class="text-sm text-slate-400">Nenhum hábito ainda. Crie o primeiro em Hábitos.</p> }
        </div>
        <a routerLink="/exercicios" class="block rounded-2xl border border-line bg-[#0f172a] p-4 text-[#fff]">
          <p class="text-xs font-bold tracking-widest text-orange-400">TREINO DE HOJE</p>
          <p class="text-xl font-extrabold">{{ d.workout ? d.workout.label : 'Dia livre' }}</p>
          <p class="text-sm text-[#cbd5e1]">{{ d.workout ? d.workout.exercises.join(' · ') : 'Nenhum treino programado.' }}</p>
        </a>
      </section>
    }`,
})
export class Home {
  private api = inject(Api);
  d = signal<Dash | null>(null);
  pad = computed(() => Array(this.d() ? new Date(this.d()!.heatmap[0].date + 'T12:00').getDay() : 0).fill(0));
  taskMsg = computed(() => {
    const d = this.d(); if (!d) return '';
    const p = d.taskPlan, fin = d.heatmap.at(-1)?.t ?? 0;
    if (p.overdue) return `Você tem ${p.overdue} ${p.overdue > 1 ? 'tarefas atrasadas' : 'tarefa atrasada'}. Que tal resolver uma agora?`;
    if (p.today) return `Faltam ${p.today} para fechar o dia. Você consegue! 💪`;
    if (fin) return `Você concluiu ${fin} ${fin > 1 ? 'tarefas' : 'tarefa'} hoje. Excelente! 🎉`;
    return p.week ? `Nada urgente hoje. ${p.week} para os próximos 7 dias.` : 'Tudo em dia. Planeje a próxima tarefa com uma data alvo.';
  });
  pick = signal('');
  pickedDate = computed(() => this.pick() || this.d()?.heatmap.at(-1)?.date || '');
  picked = computed(() => this.d()?.heatmap.find(c => c.date === this.pickedDate()) ?? null);
  label(date: string) { return date === iso() ? 'Hoje' : date.slice(8) + '/' + date.slice(5, 7); }
  detail(c: Dash['heatmap'][number]) {
    const p = [c.h && `${c.h} ${c.h > 1 ? 'hábitos' : 'hábito'}`, c.c && 'check-in', c.t && `${c.t} ${c.t > 1 ? 'tarefas concluídas' : 'tarefa concluída'}`, c.w && `${c.w} ${c.w > 1 ? 'treinos' : 'treino'}`].filter(Boolean);
    return p.length ? p.join(', ') : 'sem atividade';
  }
  hstat = computed(() => {
    const h = this.d()?.habits ?? [], left = h.filter(x => !x.done), n = new Date(), now = String(n.getHours()).padStart(2, '0') + ':' + String(n.getMinutes()).padStart(2, '0');
    return { total: h.length, done: h.length - left.length, next: left.find(x => x.time && x.time >= now) ?? left[0] ?? null };
  });
  ngOnInit() { this.load(); }
  load() { this.api.get<Dash>('/dashboard?today=' + iso()).subscribe(v => this.d.set(v)); }
  toggle(id: number) { this.api.post(`/habits/${id}/toggle`, { date: iso() }).subscribe(() => this.load()); }
  cell(s: number) { return s >= 4 ? 'bg-brand' : s >= 2 ? 'bg-orange-400' : s >= 1 ? 'bg-orange-200' : 'bg-heat'; }
}
