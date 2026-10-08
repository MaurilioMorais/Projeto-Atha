import { Component, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute } from '@angular/router';
import { Api, addDays, iso } from '../core';

interface Task { id: number; name: string; description: string | null; category: string; status: string; started_at: string | null; finished_at: string | null; due_date: string | null }
type Filter = 'all' | 'overdue' | 'today' | 'week';
const STATUS: [string, string][] = [['SEM_PLANEJAMENTO', 'Sem planejamento'], ['NAO_INICIADA', 'Não iniciada'], ['INICIADA', 'Iniciada'], ['FINALIZADA', 'Finalizada']];
const FILTERS: [Filter, string][] = [['all', 'Todas'], ['overdue', 'Atrasadas'], ['today', 'Hoje'], ['week', '7 dias']];
const Q: Record<string, Filter> = { atrasadas: 'overdue', hoje: 'today', semana: 'week' };
const nowL = () => { const d = new Date(); return iso(d) + 'T' + String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0'); };
const blank = () => ({ name: '', description: '', category: '', status: 'NAO_INICIADA', due_date: '' });

@Component({
  selector: 'app-tasks',
  imports: [FormsModule],
  template: `
    <section class="space-y-4 p-5">
      <div class="flex items-start justify-between">
        <h1 class="text-4xl font-extrabold tracking-tight">Tarefas</h1>
        <button (click)="open.set(true)" aria-label="Nova tarefa" class="grid size-10 place-items-center rounded-full bg-ink text-white">
          <svg viewBox="0 0 24 24" class="size-5 fill-none stroke-current stroke-[2.5]" stroke-linecap="round"><path d="M12 5v14M5 12h14" /></svg>
        </button>
      </div>
      <div class="-mx-5 flex gap-2 overflow-x-auto px-5">
        @for (x of FILTERS; track x[0]) {
          <button (click)="filter.set(x[0])" class="shrink-0 rounded-full border px-4 py-2 text-sm font-bold"
            [class]="filter() === x[0] ? 'border-ink bg-ink text-white' : 'border-line bg-surface text-slate-500'">{{ x[1] }}@if (x[0] !== 'all') { · {{ counts()[x[0]] }} }</button>
        }
      </div>
      <div class="inline-flex overflow-hidden rounded-xl border border-line text-sm font-bold">
        <button class="px-3 py-2" [class.bg-ink]="view() === 'status'" [class.text-white]="view() === 'status'" (click)="view.set('status')">Por status</button>
        <button class="px-3 py-2" [class.bg-ink]="view() === 'cat'" [class.text-white]="view() === 'cat'" (click)="view.set('cat')">Por categoria</button>
      </div>
      <!-- celular: lista agrupada, cards compactos (toque no título para editar; círculo conclui) -->
      <div class="space-y-5 md:hidden">
        @for (c of cols(); track c.key) {
          @if (c.items.length) {
            <div>
              <p class="lbl">{{ c.label }} · {{ c.items.length }}</p>
              <div class="space-y-2">
                @for (t of c.items; track t.id) {
                  <div class="card !p-3">
                    <div class="flex items-start gap-3">
                      <button (click)="toggleDone(t)" [attr.aria-label]="t.status === 'FINALIZADA' ? 'Reabrir tarefa' : 'Concluir tarefa'" class="mt-0.5 grid size-6 shrink-0 place-items-center rounded-full border-2"
                        [class]="t.status === 'FINALIZADA' ? 'border-brand bg-brand' : 'border-slate-300'">
                        @if (t.status === 'FINALIZADA') { <svg viewBox="0 0 24 24" class="size-4 fill-none stroke-[#fff] stroke-[3]" stroke-linecap="round" stroke-linejoin="round"><path d="m5 12.5 4.5 4.5L19 7.5" /></svg> }
                      </button>
                      <button class="flex min-w-0 flex-1 items-start gap-2 text-left" (click)="openId.set(openId() === t.id ? null : t.id)">
                        <div class="min-w-0 flex-1">
                          <p class="font-bold" [class.line-through]="t.status === 'FINALIZADA'" [class.text-slate-400]="t.status === 'FINALIZADA'">{{ t.name }}</p>
                          <p class="mt-0.5 flex flex-wrap items-center gap-x-2 text-xs text-slate-400">
                            @if (dueInfo(t); as di) { <span [class]="di.cls">📅 {{ di.text }}</span> }
                            <span>{{ view() === 'status' ? t.category : label(t.status) }}</span>
                          </p>
                        </div>
                        <svg viewBox="0 0 24 24" class="mt-1 size-4 shrink-0 fill-none stroke-slate-400 stroke-2 transition-transform" [class.rotate-180]="openId() === t.id" stroke-linecap="round" stroke-linejoin="round"><path d="m6 9 6 6 6-6" /></svg>
                      </button>
                    </div>
                    @if (openId() === t.id) {
                      <div class="mt-3 space-y-2 border-t border-line pt-3">
                        @if (t.description) { <p class="text-sm text-slate-500">{{ t.description }}</p> }
                        <label class="block text-xs text-slate-400">Status
                          <select class="field mt-1" [value]="t.status" (change)="setStatus(t, $any($event.target).value)">
                            @for (s of STATUS; track s[0]) { <option [value]="s[0]" [selected]="s[0] === t.status">{{ s[1] }}</option> }
                          </select>
                        </label>
                        <label class="block text-xs text-slate-400">Data alvo
                          <div class="ph-wrap mt-1" [class.empty]="!t.due_date" data-ph="dd/mm/aaaa"><input type="date" class="field" [value]="t.due_date || ''" (change)="patch(t, { due_date: $any($event.target).value })" /></div>
                        </label>
                        <label class="block text-xs text-slate-400">Início
                          <div class="ph-wrap mt-1" [class.empty]="!t.started_at" data-ph="dd/mm/aaaa --:--"><input type="datetime-local" class="field" [value]="t.started_at || ''" (change)="patch(t, { started_at: $any($event.target).value })" /></div>
                        </label>
                        <label class="block text-xs text-slate-400">Finalização
                          <div class="ph-wrap mt-1" [class.empty]="!t.finished_at" data-ph="dd/mm/aaaa --:--"><input type="datetime-local" class="field" [value]="t.finished_at || ''" (change)="patch(t, { finished_at: $any($event.target).value })" /></div>
                        </label>
                        @if (spent(t); as s) { <p class="text-xs text-slate-400">Tempo gasto: {{ s }}</p> }
                        <button class="btn btn-ghost w-full !text-red-500" (click)="remove(t)">Excluir tarefa</button>
                      </div>
                    }
                  </div>
                }
              </div>
            </div>
          }
        }
        @if (!shown().length) { <p class="text-sm text-slate-400">Nenhuma tarefa por aqui.</p> }
      </div>
            <div class="hidden gap-4 md:grid md:grid-cols-[repeat(auto-fit,minmax(15rem,1fr))]">
        @for (c of cols(); track c.key) {
          <div>
            <p class="lbl">{{ c.label }} · {{ c.items.length }}</p>
            <div class="space-y-3">
              @for (t of c.items; track t.id) {
                <div class="card space-y-2">
                  <div class="flex items-start justify-between gap-2"><b>{{ t.name }}</b><button (click)="remove(t)" aria-label="Excluir" class="text-xl leading-none text-slate-400">×</button></div>
                  @if (t.description) { <p class="text-sm text-slate-500">{{ t.description }}</p> }
                  <p class="text-xs font-semibold text-slate-400">{{ view() === 'status' ? t.category : label(t.status) }}</p>
                  @if (dueInfo(t); as di) { <p class="text-xs" [class]="di.cls">📅 {{ di.text }}</p> }
                  <select class="field" [value]="t.status" (change)="setStatus(t, $any($event.target).value)">
                    @for (s of STATUS; track s[0]) { <option [value]="s[0]" [selected]="s[0] === t.status">{{ s[1] }}</option> }
                  </select>
                  <label class="block text-xs text-slate-400">Data alvo<input type="date" class="field mt-1" [value]="t.due_date || ''" (change)="patch(t, { due_date: $any($event.target).value })" /></label>
                  <label class="block text-xs text-slate-400">Início<input type="datetime-local" class="field mt-1" [value]="t.started_at || ''" (change)="patch(t, { started_at: $any($event.target).value })" /></label>
                  <label class="block text-xs text-slate-400">Finalização<input type="datetime-local" class="field mt-1" [value]="t.finished_at || ''" (change)="patch(t, { finished_at: $any($event.target).value })" /></label>
                  @if (spent(t); as s) { <p class="text-xs text-slate-400">Tempo gasto: {{ s }}</p> }
                </div>
              } @empty { <p class="text-sm text-slate-400">Vazio</p> }
            </div>
          </div>
        } @empty { <p class="text-sm text-slate-400">Nenhuma tarefa por aqui.</p> }
      </div>
    </section>
    @if (open()) {
      <div class="fixed inset-0 z-40 bg-black/50" (click)="open.set(false)"></div>
      <div class="fixed inset-x-0 bottom-0 z-50 mx-auto max-w-md space-y-2 rounded-t-3xl bg-surface p-5 pb-[calc(1.25rem+env(safe-area-inset-bottom))]">
        <p class="text-lg font-extrabold">Nova tarefa</p>
        <input class="field" placeholder="Nome da tarefa" [(ngModel)]="f.name" />
        <textarea class="field" rows="2" placeholder="Descrição" [(ngModel)]="f.description"></textarea>
        <input class="field" list="cats" placeholder="Categoria (ex.: Trabalho)" [(ngModel)]="f.category" />
        <datalist id="cats">@for (c of categories(); track c) { <option [value]="c"></option> }</datalist>
        <select class="field" [(ngModel)]="f.status">@for (s of STATUS; track s[0]) { <option [value]="s[0]">{{ s[1] }}</option> }</select>
        <p class="lbl !mb-1 pt-1">Data alvo (opcional)</p>
        <div class="flex gap-2">
          <div class="ph-wrap flex-1" [class.empty]="!f.due_date" data-ph="dd/mm/aaaa"><input type="date" class="field !mb-0" [(ngModel)]="f.due_date" /></div>
          <button class="btn btn-ghost" (click)="setDue(0)">Hoje</button>
          <button class="btn btn-ghost" (click)="setDue(1)">Amanhã</button>
        </div>
        <div class="flex gap-2 pt-1"><button class="btn btn-or flex-1" (click)="create()">Salvar tarefa</button><button class="btn btn-ghost" (click)="open.set(false)">Cancelar</button></div>
      </div>
    }`,
})
export class Tasks {
  private api = inject(Api);
  STATUS = STATUS; FILTERS = FILTERS;
  tasks = signal<Task[]>([]);
  view = signal<'status' | 'cat'>('status');
  filter = signal<Filter>(Q[inject(ActivatedRoute).snapshot.queryParamMap.get('filtro') ?? ''] ?? 'all');
  open = signal(false);
  openId = signal<number | null>(null);
  f = blank();
  categories = computed(() => [...new Set(this.tasks().map(t => t.category || 'Geral'))].sort());
  counts = computed(() => {
    const t = this.tasks();
    return { all: t.length, overdue: t.filter(x => this.match(x, 'overdue')).length, today: t.filter(x => this.match(x, 'today')).length, week: t.filter(x => this.match(x, 'week')).length } as Record<Filter, number>;
  });
  shown = computed(() => this.tasks().filter(t => this.match(t, this.filter())).sort((a, b) => (a.due_date || '9999').localeCompare(b.due_date || '9999')));
  cols = computed(() => this.view() === 'status'
    ? STATUS.map(([key, label]) => ({ key, label, items: this.shown().filter(t => t.status === key) }))
    : [...new Set(this.shown().map(t => t.category || 'Geral'))].sort().map(c => ({ key: c, label: c, items: this.shown().filter(t => (t.category || 'Geral') === c) })));
  ngOnInit() { this.api.get<Task[]>('/tasks').subscribe(t => this.tasks.set(t)); }
  // "hoje" inclui as já concluídas (para ver o progresso do dia); atrasadas e 7 dias só as em aberto
  match(t: Task, f: Filter) {
    if (f === 'all') return true;
    const d = t.due_date, n = iso();
    if (!d) return false;
    if (f === 'today') return d === n;
    if (t.status === 'FINALIZADA') return false;
    return f === 'overdue' ? d < n : d > n && d <= addDays(n, 7);
  }
  dueInfo(t: Task) {
    if (!t.due_date) return null;
    const n = iso(), d = t.due_date, dm = d.slice(8) + '/' + d.slice(5, 7);
    if (t.status === 'FINALIZADA') return { text: dm, cls: 'text-slate-400' };
    if (d < n) return { text: `Atrasada · ${dm}`, cls: 'font-bold text-red-500' };
    if (d === n) return { text: 'Hoje', cls: 'font-bold text-brand' };
    if (d === addDays(n, 1)) return { text: 'Amanhã', cls: 'font-bold text-slate-500' };
    return { text: dm, cls: 'text-slate-500' };
  }
  label(s: string) { return STATUS.find(x => x[0] === s)?.[1] ?? s; }
  spent(t: Task) {
    if (!t.started_at || !t.finished_at) return '';
    const m = Math.round((new Date(t.finished_at).getTime() - new Date(t.started_at).getTime()) / 60000);
    return m < 0 ? '' : m < 60 ? `${m} min` : `${Math.floor(m / 60)} h ${m % 60} min`;
  }
  setDue(n: number) { this.f.due_date = addDays(iso(), n); }
  create() {
    if (!this.f.name.trim()) return;
    const body: any = { ...this.f, category: this.f.category.trim() || 'Geral', due_date: this.f.due_date || null };
    if (body.status === 'INICIADA' || body.status === 'FINALIZADA') body.started_at = nowL();
    if (body.status === 'FINALIZADA') body.finished_at = nowL();
    this.api.post<Task>('/tasks', body).subscribe(t => { this.tasks.update(l => [t, ...l]); this.f = blank(); this.open.set(false); });
  }
  setStatus(t: Task, status: string) {
    const b: any = { status };
    if (status === 'INICIADA' && !t.started_at) b.started_at = nowL();
    if (status === 'FINALIZADA') { b.started_at = t.started_at || nowL(); b.finished_at = nowL(); }
    if (status !== 'FINALIZADA' && t.finished_at) b.finished_at = '';
    this.patch(t, b);
  }
  toggleDone(t: Task) { this.setStatus(t, t.status === 'FINALIZADA' ? 'NAO_INICIADA' : 'FINALIZADA'); }
  patch(t: Task, body: object) { this.api.patch<Task>('/tasks/' + t.id, body).subscribe(n => this.tasks.update(l => l.map(x => x.id === n.id ? n : x))); }
  remove(t: Task) { this.api.del('/tasks/' + t.id).subscribe(() => this.tasks.update(l => l.filter(x => x.id !== t.id))); }
}
