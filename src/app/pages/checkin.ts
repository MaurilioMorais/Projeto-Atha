import { Component, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Api, iso } from '../core';

const TAGS = ['Produtivo', 'Exaustivo', 'Procrastinei', 'Organizei minhas ideias', 'Focado', 'Ansioso', 'Grato', 'Energizado'];

@Component({
  selector: 'app-checkin',
  imports: [FormsModule],
  template: `
    <section class="space-y-4 p-5">
      <div><h1 class="text-4xl font-extrabold tracking-tight">Check-in</h1><p class="text-slate-500">Como foi o seu dia?</p></div>
      <div class="flex flex-wrap gap-2">
        @for (t of TAGS; track t) {
          <button (click)="toggle(t)" class="rounded-full border border-line px-4 py-2 font-semibold"
            [class.bg-ink]="tags().includes(t)" [class.text-white]="tags().includes(t)" [class.bg-surface]="!tags().includes(t)">{{ t }}</button>
        }
      </div>
      <textarea class="field" rows="5" placeholder="Observações e reflexões do dia" [(ngModel)]="notes"></textarea>
      <button class="btn btn-or w-full" (click)="save()">{{ saved() ? 'Check-in salvo ✓' : 'Salvar check-in' }}</button>
      <p class="lbl pt-4">Últimos check-ins</p>
      @for (c of list(); track c.date) {
        <div class="card"><b>{{ c.date.split('-').reverse().join('/') }}</b><p class="text-sm text-slate-500">{{ c.tags.join(', ') || '—' }}</p>@if (c.notes) { <p class="mt-1">{{ c.notes }}</p> }</div>
      }
    </section>`,
})
export class Checkin {
  private api = inject(Api);
  TAGS = TAGS;
  tags = signal<string[]>([]);
  notes = '';
  saved = signal(false);
  list = signal<{ date: string; tags: string[]; notes: string | null }[]>([]);
  ngOnInit() {
    this.api.get<any[]>('/checkins').subscribe((l: any) => {
      this.list.set(l);
      const t = l.find((c: any) => c.date === iso());
      if (t) { this.tags.set(t.tags); this.notes = t.notes || ''; this.saved.set(true); }
    });
  }
  toggle(t: string) { this.saved.set(false); this.tags.update(a => a.includes(t) ? a.filter(x => x !== t) : [...a, t]); }
  save() { this.api.put('/checkins/' + iso(), { tags: this.tags(), notes: this.notes }).subscribe(() => this.ngOnInit()); }
}
