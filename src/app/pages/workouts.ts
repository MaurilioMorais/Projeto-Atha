import { Component, DestroyRef, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Api, DAYS, iso } from '../core';

interface Ex { id: number; weekday: number; name: string; sets: number; obs: string | null }
interface Active { start: number; label: string; weekday: number; ex: { name: string; obs: string; sets: { reps: number; load: number }[] }[] }
interface Prog {
  sessions: { id: number; date: string; label: string; duration_sec: number; volume: number }[];
  sets: { exercise: string; session_id: number; date: string; set_number: number; reps: number; load_kg: number }[];
}
const KEY = 'atha.active';
const pad = (n: number) => String(n).padStart(2, '0');

@Component({
  selector: 'app-workouts',
  imports: [FormsModule],
  template: `
    <section class="space-y-4 p-5">
      @if (active(); as a) {
        <div>
          <h1 class="text-3xl font-extrabold tracking-tight">{{ a.label }}</h1>
          <p class="text-5xl font-extrabold tabular-nums">{{ elapsed() }}</p>
        </div>
        @for (e of a.ex; track $index) {
          <div class="card space-y-2">
            <div><b>{{ e.name }}</b>@if (e.obs) { <p class="text-sm text-slate-500">{{ e.obs }}</p> }</div>
            <div class="grid grid-cols-[3.5rem_1fr_1fr] items-center gap-2 text-xs text-slate-400"><span></span><span>Repetições</span><span>Carga (kg)</span></div>
            @for (s of e.sets; track $index; let j = $index) {
              <div class="grid grid-cols-[3.5rem_1fr_1fr] items-center gap-2">
                <span class="text-sm font-semibold">Série {{ j + 1 }}</span>
                <input class="field" type="number" inputmode="numeric" [(ngModel)]="s.reps" (change)="persist()" />
                <input class="field" type="number" inputmode="decimal" step="0.5" [(ngModel)]="s.load" (change)="persist()" />
              </div>
            }
            <button class="btn btn-ghost w-full" (click)="addSet(e)">+ Série</button>
          </div>
        }
        <div class="card flex gap-2"><input class="field" placeholder="Adicionar exercício" [(ngModel)]="extra" /><button class="btn btn-ghost" (click)="addExtra()">Adicionar</button></div>
        <div class="flex gap-2"><button class="btn btn-or flex-1" (click)="finish()">Finalizar treino</button><button class="btn btn-ghost" (click)="cancel()">Cancelar</button></div>
      } @else {
        <div class="flex items-start justify-between">
          <h1 class="text-4xl font-extrabold tracking-tight">Exercícios</h1>
          <div class="flex overflow-hidden rounded-xl border border-line text-sm font-bold">
            <button class="px-3 py-2" [class.bg-ink]="tab() === 'treino'" [class.text-white]="tab() === 'treino'" (click)="tab.set('treino')">Treino</button>
            <button class="px-3 py-2" [class.bg-ink]="tab() === 'evo'" [class.text-white]="tab() === 'evo'" (click)="tab.set('evo')">Evolução</button>
          </div>
        </div>
        @if (tab() === 'treino') {
          <div class="flex gap-1.5">
            @for (k of ORDER; track k) {
              <button (click)="day.set(k)" class="flex-1 rounded-2xl border py-2 text-center text-[10px] font-bold" [class]="k === day() ? 'border-ink bg-ink text-white' : 'border-line bg-surface text-slate-400'">
                {{ DAYS[k].slice(0, 3).toUpperCase() }}<b class="block text-lg" [class.text-ink]="k !== day()">{{ count(k) || '·' }}</b>
              </button>
            }
          </div>
          <div class="card space-y-2">
            <p class="text-base font-extrabold">Treino de {{ DAYS[day()] }}</p>
            @for (e of dayEx(); track e.id) {
              <div class="flex items-center justify-between py-1">
                <div><b>{{ e.name }}</b><p class="text-xs text-slate-500">{{ e.sets }} séries@if (e.obs) { · {{ e.obs }} }</p></div>
                <button (click)="removeEx(e)" aria-label="Remover" class="px-2 text-xl text-slate-400">×</button>
              </div>
            } @empty { <p class="text-sm text-slate-400">Nenhum exercício neste dia.</p> }
            <div class="space-y-2 border-t border-line pt-3">
              <input class="field" placeholder="Nome do exercício" [(ngModel)]="n.name" />
              <input class="field" type="number" min="1" placeholder="Séries (meta)" [(ngModel)]="n.sets" />
              <input class="field" placeholder="Observação (ex.: focar na cadência)" [(ngModel)]="n.obs" />
              <button class="btn btn-ghost w-full" (click)="addEx()">Adicionar exercício</button>
            </div>
          </div>
          <button class="btn btn-or w-full" (click)="start()">{{ dayEx().length ? 'Iniciar treino' : 'Treino livre' }}</button>
        } @else {
          <div class="grid grid-cols-3 gap-3">
            <div class="card"><p class="text-2xl font-extrabold">{{ stats().n }}</p><p class="text-xs text-slate-500">treinos</p></div>
            <div class="card"><p class="text-2xl font-extrabold">{{ stats().avg }}<small class="text-sm"> min</small></p><p class="text-xs text-slate-500">duração média</p></div>
            <div class="card"><p class="text-2xl font-extrabold">{{ stats().vol }}</p><p class="text-xs text-slate-500">kg movidos</p></div>
          </div>
          @if (exs().length) {
            <div class="flex overflow-hidden rounded-xl border border-line text-sm font-bold">
              @for (m of METRICS; track m[0]) {
                <button class="flex-1 py-2" [class.bg-ink]="metric() === m[0]" [class.text-white]="metric() === m[0]" (click)="metric.set(m[0])">{{ m[1] }}</button>
              }
            </div>
            <div class="grid gap-4 md:grid-cols-2">
              @for (e of exs(); track e.name) {
                <div class="card space-y-2">
                  <div class="flex items-baseline justify-between gap-2"><b>{{ e.name }}</b><span class="text-xs text-slate-500">recorde <b class="text-brand">{{ e.pr }} kg</b></span></div>
                  <svg viewBox="0 0 300 100" class="w-full text-ink">
                    <polyline [attr.points]="e.pts" fill="none" stroke="#f97316" stroke-width="3" stroke-linejoin="round" stroke-linecap="round" />
                    @for (p of e.dots; track p.date + $index) { <circle [attr.cx]="p.x" [attr.cy]="p.y" r="4.5" fill="currentColor" /> }
                  </svg>
                  <p class="text-sm text-slate-500">
                    {{ r1(e.first) }} → <b class="text-ink">{{ r1(e.last) }} {{ unit() }}</b>
                    <span [class]="e.delta >= 0 ? 'font-bold text-emerald-600' : 'font-bold text-red-500'">({{ e.delta > 0 ? '+' : '' }}{{ r1(e.delta) }})</span> · {{ e.n }} treinos
                  </p>
                  <div class="space-y-1 border-t border-line pt-2 text-xs">
                    @for (s of e.recent; track s.id) {
                      <div class="flex justify-between gap-3"><span class="shrink-0 text-slate-400">{{ s.date.slice(8) }}/{{ s.date.slice(5, 7) }}</span><span class="text-right">{{ s.txt }}</span></div>
                    }
                  </div>
                </div>
              }
            </div>
            <div class="card">
              <p class="lbl">Frequência (treinos por semana, últimas 8)</p>
              <div class="flex h-24 items-end gap-1.5">
                @for (v of freq(); track $index) { <div class="min-h-1 flex-1 rounded-t bg-ink" [style.height.%]="(v / maxF()) * 100"></div> }
              </div>
            </div>
          } @else {
            <p class="text-sm text-slate-400">Finalize um treino para começar a ver sua evolução.</p>
          }
        }
      }
    </section>`,
})
export class Workouts {
  private api = inject(Api);
  DAYS = DAYS;
  ORDER = [1, 2, 3, 4, 5, 6, 0];
  all = signal<Ex[]>([]);
  day = signal(new Date().getDay());
  tab = signal<'treino' | 'evo'>('treino');
  prog = signal<Prog | null>(null);
  evo = signal('');
  now = signal(Date.now());
  extra = '';
  n = { name: '', sets: 3, obs: '' };
  active = signal<Active | null>(JSON.parse(localStorage.getItem(KEY) || 'null'));

  dayEx = computed(() => this.all().filter(e => e.weekday === this.day()));
  elapsed = computed(() => { const a = this.active(); if (!a) return ''; const s = Math.floor((this.now() - a.start) / 1000); return `${pad(Math.floor(s / 3600))}:${pad(Math.floor(s / 60) % 60)}:${pad(s % 60)}`; });
  METRICS: ['load' | 'volume' | 'sets', string][] = [['load', 'Carga'], ['volume', 'Volume'], ['sets', 'Séries']];
  metric = signal<'load' | 'volume' | 'sets'>('load');
  unit = computed(() => ({ load: 'kg', volume: 'kg', sets: 'séries' })[this.metric()]);
  r1 = (n: number) => Math.round(n * 10) / 10;
  // por exercício: uma entrada por treino (melhor carga, volume, nº de séries) + texto das séries "10×20kg · 8×22.5kg"
  exs = computed(() => {
    const m = this.metric(), by = new Map<string, Map<number, { id: number; date: string; sets: { reps: number; load: number }[] }>>();
    for (const r of this.prog()?.sets ?? []) {
      const e = by.get(r.exercise) ?? by.set(r.exercise, new Map()).get(r.exercise)!;
      const s = e.get(r.session_id) ?? e.set(r.session_id, { id: r.session_id, date: r.date, sets: [] }).get(r.session_id)!;
      s.sets.push({ reps: r.reps, load: r.load_kg });
    }
    return [...by].map(([name, ss]) => {
      const list = [...ss.values()].map(s => ({ ...s, max: Math.max(...s.sets.map(x => x.load)), vol: s.sets.reduce((a, x) => a + x.reps * x.load, 0), n: s.sets.length, txt: s.sets.map(x => `${x.reps}×${x.load}kg`).join(' · ') }));
      const val = (s: (typeof list)[number]) => (m === 'load' ? s.max : m === 'volume' ? s.vol : s.n);
      const v = list.map(val), min = Math.min(...v), max = Math.max(...v), rng = max - min || 1;
      const dots = list.map((s, i) => ({ x: list.length === 1 ? 150 : 10 + (i * 280) / (list.length - 1), y: 85 - ((val(s) - min) / rng) * 70, date: s.date }));
      return { name, pr: Math.max(...list.map(s => s.max)), first: v[0], last: v[v.length - 1], delta: v[v.length - 1] - v[0], n: list.length, pts: dots.map(d => d.x + ',' + d.y).join(' '), dots, recent: list.slice(-5).reverse() };
    }).sort((a, b) => a.name.localeCompare(b.name));
  });
  stats = computed(() => {
    const ss = this.prog()?.sessions ?? [], n = ss.length;
    return { n, vol: Math.round(ss.reduce((a, s) => a + s.volume, 0)), avg: n ? Math.round(ss.reduce((a, s) => a + (s.duration_sec || 0), 0) / n / 60) : 0 };
  });
  freq = computed(() => {
    const t = new Date(iso() + 'T12:00').getTime(), b = Array(8).fill(0);
    for (const s of this.prog()?.sessions ?? []) { const w = Math.floor((t - new Date(s.date + 'T12:00').getTime()) / 6048e5); if (w >= 0 && w < 8) b[7 - w]++; }
    return b as number[];
  });
  maxF = computed(() => Math.max(1, ...this.freq()));

  constructor() {
    const id = setInterval(() => this.now.set(Date.now()), 1000);
    inject(DestroyRef).onDestroy(() => clearInterval(id));
  }
  ngOnInit() { this.api.get<Ex[]>('/workouts').subscribe(l => this.all.set(l)); this.loadProg(); }
  loadProg() { this.api.get<Prog>('/progress').subscribe(p => this.prog.set(p)); }
  count(k: number) { return this.all().filter(e => e.weekday === k).length; }
  addEx() {
    if (!this.n.name.trim()) return;
    this.api.post<Ex>('/workouts', { weekday: this.day(), ...this.n, name: this.n.name.trim() }).subscribe(e => { this.all.update(l => [...l, e]); this.n = { name: '', sets: 3, obs: '' }; });
  }
  removeEx(e: Ex) { this.api.del('/workouts/' + e.id).subscribe(() => this.all.update(l => l.filter(x => x.id !== e.id))); }
  start() {
    this.active.set({ start: Date.now(), weekday: this.day(), label: 'Treino de ' + DAYS[this.day()],
      ex: this.dayEx().map(e => ({ name: e.name, obs: e.obs || '', sets: Array.from({ length: e.sets }, () => ({ reps: 10, load: 0 })) })) });
    this.persist();
  }
  persist() { const a = this.active(); a ? localStorage.setItem(KEY, JSON.stringify(a)) : localStorage.removeItem(KEY); }
  addSet(e: Active['ex'][number]) { const l = e.sets[e.sets.length - 1]; e.sets.push({ reps: l?.reps ?? 10, load: l?.load ?? 0 }); this.persist(); }
  addExtra() { if (!this.extra.trim()) return; this.active.update(a => a && { ...a, ex: [...a.ex, { name: this.extra.trim(), obs: '', sets: [{ reps: 10, load: 0 }] }] }); this.extra = ''; this.persist(); }
  cancel() { this.active.set(null); this.persist(); }
  finish() {
    const a = this.active(); if (!a) return;
    const end = Date.now();
    this.api.post('/sessions', {
      date: iso(new Date(a.start)), weekday: a.weekday, label: a.label,
      started_at: new Date(a.start).toISOString(), finished_at: new Date(end).toISOString(), duration_sec: Math.round((end - a.start) / 1000),
      exercises: a.ex.map(e => ({ name: e.name, sets: e.sets })),
    }).subscribe(() => { this.cancel(); this.loadProg(); this.tab.set('evo'); });
  }
}
