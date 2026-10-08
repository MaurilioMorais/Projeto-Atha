import { Component, ElementRef, computed, effect, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Api, DAYS, MONTHS, addDays, iso } from '../core';

interface Habit { id: number; name: string; time: string | null; weekdays: number[]; created_at: string | null; logs: string[] }
type Range = 'day' | 'week' | 'month';
const ALL = [0, 1, 2, 3, 4, 5, 6];
const LETTER = ['D', 'S', 'T', 'Q', 'Q', 'S', 'S'];

@Component({
  selector: 'app-habits',
  imports: [FormsModule],
  template: `
    <section class="space-y-4 py-5">
      <div class="flex items-start justify-between px-5">
        <div><h1 class="text-4xl font-extrabold tracking-tight">Rastreador</h1><p class="text-slate-500">Consistência é a chave.</p></div>
        <div class="flex overflow-hidden rounded-xl border border-line text-sm font-bold">
          <button class="px-3 py-2" [class.bg-ink]="mode() === 'grid'" [class.text-white]="mode() === 'grid'" (click)="mode.set('grid')">Grade</button>
          <button class="px-3 py-2" [class.bg-ink]="mode() === 'cal'" [class.text-white]="mode() === 'cal'" (click)="mode.set('cal')">Mês</button>
        </div>
      </div>
      @if (mode() === 'grid') {
        <div class="flex gap-2 overflow-x-auto px-5 pb-1">
          @for (d of days(); track d) {
            <button (click)="sel.set(d)" [attr.data-on]="d === sel() ? '' : null"
              class="w-16 shrink-0 rounded-2xl border py-2.5 text-center text-[10px] font-bold"
              [class]="d === sel() ? 'border-ink bg-ink text-white' : d === today ? 'border-brand bg-surface text-slate-400' : 'border-line bg-surface text-slate-400'">
              {{ dow(d) }}<b class="block text-xl" [class.text-ink]="d !== sel()">{{ +d.slice(8) }}</b>
              <i class="mx-auto mt-0.5 block size-1.5 rounded-full" [class]="dot(d)"></i>
            </button>
          }
        </div>
      } @else {
        <div class="px-5">
          <p class="lbl">{{ month().title }}</p>
          <div class="grid grid-cols-7 gap-1 text-center text-sm">
            @for (p of month().lead; track $index) { <i></i> }
            @for (d of month().days; track d) {
              <button (click)="sel.set(d)" [attr.data-on]="d === sel() ? '' : null" class="aspect-square rounded-xl border border-line font-semibold"
                [class]="d === sel() ? 'bg-ink text-white' : frac(d) === 1 ? 'bg-brand text-[#fff]' : frac(d) > 0 ? 'bg-orange-200 text-[#0f172a]' : 'bg-surface'">{{ +d.slice(8) }}</button>
            }
          </div>
        </div>
      }
      <div class="space-y-3 px-5">
        <div class="flex items-center justify-between gap-2">
          <div class="min-w-0">
            <h2 class="text-base font-extrabold">{{ long(sel()) }}</h2>
            @if (sel() !== today) { <button class="text-xs font-bold text-brand" (click)="sel.set(today)">Voltar para hoje</button> }
          </div>
          <button (click)="adding() ? cancel() : adding.set(true)" [attr.aria-label]="adding() ? 'Cancelar' : 'Novo hábito'" class="grid size-10 place-items-center rounded-full bg-ink text-white"><svg viewBox="0 0 24 24" class="size-5 fill-none stroke-current stroke-[2.5] transition-transform" [class.rotate-45]="adding()" stroke-linecap="round"><path d="M12 5v14M5 12h14" /></svg></button>
        </div>
        @if (todays().length) {
          <div>
            <div class="mb-1 flex justify-between text-xs font-bold">
              <span>{{ dayDone() }} de {{ todays().length }} concluídos</span>
              @if (dayDone() === todays().length) { <span class="text-brand">Tudo concluído 🎉</span> }
            </div>
            <div class="h-2 overflow-hidden rounded-full bg-chip"><div class="h-full rounded-full bg-brand transition-all" [style.width.%]="(dayDone() / todays().length) * 100"></div></div>
          </div>
        }
        @if (adding()) {
          <div class="card space-y-2">
            <div class="flex items-center justify-between"><p class="font-extrabold">Novo hábito</p><button (click)="cancel()" aria-label="Cancelar" class="px-2 text-2xl leading-none text-slate-400">×</button></div>
            <input class="field" placeholder="Nome do hábito" [(ngModel)]="name" />
            <label class="block text-xs text-slate-400">Horário (opcional)
              <div class="ph-wrap mt-1" [class.empty]="!time" data-ph="--:--"><input class="field" type="time" [(ngModel)]="time" /></div>
            </label>
            <p class="lbl !mb-1 pt-1">Dias da semana <span class="font-normal normal-case">(nenhum marcado = todos os dias)</span></p>
            <div class="flex gap-1.5">
              @for (k of ALL; track k) {
                <button (click)="toggleNew(k)" [attr.aria-label]="DAYS[k]" class="size-9 rounded-full text-sm font-bold"
                  [class]="newDays().includes(k) ? 'bg-ink text-white' : 'bg-chip text-slate-400'">{{ LETTER[k] }}</button>
              }
            </div>
            <div class="flex gap-2"><button class="btn btn-or flex-1" (click)="add()">Salvar hábito</button><button class="btn btn-ghost" (click)="cancel()">Cancelar</button></div>
          </div>
        }
        @for (h of todays(); track h.id) {
          <div class="card flex items-center justify-between gap-3">
            <div class="min-w-0">
              <b>{{ h.name }}</b> @if (h.time) { <small class="ml-1.5 text-slate-400">às {{ h.time }}</small> }
              <p class="text-xs text-slate-500">{{ h.logs.length }} {{ h.logs.length === 1 ? 'dia concluído' : 'dias concluídos' }}</p>
              <div class="mt-2 flex gap-1">
                @for (k of ALL; track k) {
                  <button (click)="setDay(h, k)" [attr.aria-label]="DAYS[k]" class="size-6 rounded-full text-[10px] font-bold"
                    [class]="lit(h, k) ? 'bg-ink text-white' : 'bg-chip text-slate-400'">{{ LETTER[k] }}</button>
                }
              </div>
            </div>
            <div class="flex shrink-0 items-center gap-3">
              <button (click)="remove(h)" aria-label="Excluir" class="px-2 text-xl text-slate-400">×</button>
              <button (click)="toggle(h)" [attr.aria-label]="'Marcar ' + h.name" class="grid size-9 place-items-center rounded-full border-2"
                [class]="h.logs.includes(sel()) ? 'border-brand bg-brand' : 'border-slate-300'" [class.pop]="popId() === h.id">
                @if (h.logs.includes(sel())) { <svg viewBox="0 0 24 24" class="size-5 fill-none stroke-[#fff] stroke-[3]" stroke-linecap="round" stroke-linejoin="round"><path d="m5 12.5 4.5 4.5L19 7.5" /></svg> }
              </button>
            </div>
          </div>
        } @empty {
          <p class="text-sm text-slate-400">{{ habits().length ? 'Nenhum hábito programado para este dia.' : 'Toque em + para criar seu primeiro hábito.' }}</p>
        }
        <div class="card">
          <div class="mb-3 flex items-center justify-between">
            <p class="lbl !mb-0">Desempenho</p>
            <div class="flex overflow-hidden rounded-lg border border-line text-xs font-bold">
              @for (r of RANGES; track r[0]) {
                <button class="px-2.5 py-1.5" [class.bg-ink]="range() === r[0]" [class.text-white]="range() === r[0]" (click)="range.set(r[0])">{{ r[1] }}</button>
              }
            </div>
          </div>
          <div class="flex gap-1">
            @for (p of perf(); track $index) {
              <div class="flex min-w-0 flex-1 flex-col items-center gap-1">
                <span class="text-[9px] font-bold text-slate-400">{{ p.pct ?? '–' }}</span>
                <div class="flex h-24 w-full items-end"><div class="w-full rounded-t bg-brand" style="min-height: 3px" [class.opacity-30]="p.pct === null" [style.height.%]="p.pct ?? 0"></div></div>
                <span class="text-[9px] text-slate-400">{{ p.label }}</span>
              </div>
            }
          </div>
          <p class="mt-2 text-xs text-slate-400">Média: <b class="text-ink">{{ avg() }}%</b> · {{ HINT[range()] }}. Conta só os dias programados de cada hábito, a partir de quando ele foi criado.</p>
        </div>
      </div>
    </section>`,
})
export class Habits {
  private api = inject(Api);
  private host = inject(ElementRef);
  ALL = ALL; LETTER = LETTER; DAYS = DAYS;
  RANGES: [Range, string][] = [['day', 'Dia'], ['week', 'Semana'], ['month', 'Mês']];
  HINT: Record<Range, string> = { day: 'últimos 14 dias', week: 'últimas 12 semanas (dom–sáb)', month: 'últimos 6 meses' };
  today = iso();
  habits = signal<Habit[]>([]);
  sel = signal(iso());
  mode = signal<'grid' | 'cal'>('grid');
  range = signal<Range>('week');
  adding = signal(false);
  popId = signal(0);
  newDays = signal<number[]>([]);
  name = ''; time = '';
  days = computed(() => Array.from({ length: 27 }, (_, i) => addDays(iso(), i - 20)));
  todays = computed(() => this.habits().filter(h => this.sched(h, this.sel())));
  dayDone = computed(() => this.todays().filter(h => h.logs.includes(this.sel())).length);
  month = computed(() => {
    const o = new Date(this.sel() + 'T12:00'), y = o.getFullYear(), m = o.getMonth();
    return { title: `${MONTHS[m]} ${y}`, lead: Array(new Date(y, m, 1).getDay()).fill(0), days: Array.from({ length: new Date(y, m + 1, 0).getDate() }, (_, i) => iso(new Date(y, m, i + 1))) };
  });
  perf = computed(() => {
    const t = iso(), o = new Date(t + 'T12:00'), r = this.range(), out: { label: string; pct: number | null }[] = [];
    if (r === 'day') for (let i = 13; i >= 0; i--) { const d = addDays(t, -i); out.push({ label: String(+d.slice(8)), pct: this.rate(d, d) }); }
    else if (r === 'week') for (let i = 11; i >= 0; i--) { const s = addDays(t, -o.getDay() - 7 * i); out.push({ label: `${+s.slice(8)}/${+s.slice(5, 7)}`, pct: this.rate(s, addDays(s, 6)) }); }
    else for (let i = 5; i >= 0; i--) { const a = new Date(o.getFullYear(), o.getMonth() - i, 1); out.push({ label: MONTHS[a.getMonth()].slice(0, 3), pct: this.rate(iso(a), iso(new Date(a.getFullYear(), a.getMonth() + 1, 0))) }); }
    return out;
  });
  avg = computed(() => { const v = this.perf().filter(p => p.pct !== null).map(p => p.pct as number); return v.length ? Math.round(v.reduce((a, b) => a + b, 0) / v.length) : 0; });

  constructor() {
    // mantém o dia selecionado (hoje, ao abrir) visível na faixa de dias
    effect(() => {
      this.sel(); this.mode();
      setTimeout(() => (this.host.nativeElement as HTMLElement).querySelector('[data-on]')?.scrollIntoView({ inline: 'center', block: 'nearest' }));
    });
  }
  ngOnInit() { this.api.get<Habit[]>('/habits').subscribe(h => this.habits.set(h)); }

  sched(h: Habit, d: string) { return !h.weekdays.length || h.weekdays.includes(new Date(d + 'T12:00').getDay()); }
  start(h: Habit) { return [h.created_at, [...h.logs].sort()[0]].filter(Boolean).sort()[0] ?? '0000-00-00'; }
  counts(h: Habit, d: string) { return this.sched(h, d) && d >= this.start(h) && d <= this.today; }
  rate(from: string, to: string) {
    let k = 0, n = 0;
    for (let d = from; d <= to && d <= this.today; d = addDays(d, 1)) for (const h of this.habits()) if (this.counts(h, d)) { n++; if (h.logs.includes(d)) k++; }
    return n ? Math.round((k / n) * 100) : null;
  }
  lit(h: Habit, k: number) { return !h.weekdays.length || h.weekdays.includes(k); }
  dow(d: string) { return DAYS[new Date(d + 'T12:00').getDay()].slice(0, 3).toUpperCase(); }
  long(d: string) { const o = new Date(d + 'T12:00'); return `${DAYS[o.getDay()]}${o.getDay() % 6 ? '-Feira' : ''}, ${o.getDate()} De ${MONTHS[o.getMonth()]}`; }
  frac(d: string) { const hs = this.habits().filter(h => this.sched(h, d)); return hs.length ? hs.filter(h => h.logs.includes(d)).length / hs.length : 0; }
  dot(d: string) { const f = this.frac(d); return f === 1 ? 'bg-brand' : f > 0 ? 'bg-orange-300' : 'bg-transparent'; }
  toggleNew(k: number) { this.newDays.update(a => a.includes(k) ? a.filter(x => x !== k) : [...a, k].sort()); }
  cancel() { this.adding.set(false); this.name = ''; this.time = ''; this.newDays.set([]); }
  add() {
    if (!this.name.trim()) return;
    this.api.post<Habit>('/habits', { name: this.name.trim(), time: this.time || null, weekdays: this.newDays(), date: iso() }).subscribe(h => { this.habits.update(l => [...l, h]); this.cancel(); });
  }
  setDay(h: Habit, k: number) {
    const cur = h.weekdays.length ? h.weekdays : ALL;
    const nxt = cur.includes(k) ? cur.filter(x => x !== k) : [...cur, k].sort();
    if (!nxt.length) return;
    this.api.patch<Habit>(`/habits/${h.id}`, { weekdays: nxt.length === 7 ? [] : nxt })
      .subscribe(n => this.habits.update(l => l.map(x => x.id === h.id ? { ...x, weekdays: n.weekdays } : x)));
  }
  toggle(h: Habit) {
    const date = this.sel();
    this.api.post<{ done: boolean }>(`/habits/${h.id}/toggle`, { date }).subscribe(r => {
      this.habits.update(l => l.map(x => x.id === h.id ? { ...x, logs: r.done ? [...x.logs, date] : x.logs.filter(d => d !== date) } : x));
      if (r.done) { this.popId.set(h.id); setTimeout(() => this.popId.set(0), 500); }
    });
  }
  remove(h: Habit) { this.api.del(`/habits/${h.id}`).subscribe(() => this.habits.update(l => l.filter(x => x.id !== h.id))); }
}
