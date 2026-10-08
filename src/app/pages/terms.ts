import { Component, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { Api, Auth } from '../core';

const SECTIONS: { h: string; p: string[] }[] = [
  { h: '1. Sobre o Atha', p: ['O Atha é um aplicativo para organizar a rotina: hábitos, tarefas, check-ins diários e treinos. É operado por [NOME DA EMPRESA].'] },
  { h: '2. Sua conta', p: ['Você é responsável pelas informações da sua conta e por manter a senha em segredo. Use uma senha forte e exclusiva. Avise-nos se suspeitar de uso indevido.'] },
  { h: '3. Dados que coletamos', p: ['Nome, e-mail e senha (guardada apenas na forma de hash, nunca em texto). Também guardamos o que você registra: hábitos, tarefas, check-ins (inclusive suas observações), treinos com séries e cargas, além de datas de cadastro e de último acesso.'] },
  { h: '4. Como protegemos seus dados', p: ['As senhas são armazenadas com hash e salt (scrypt). Exigimos senhas fortes e limitamos tentativas de login. Sua sessão usa um token com validade de 30 dias, e em produção o acesso deve ser feito por HTTPS. Nenhum sistema é totalmente imune a falhas, e trabalhamos para reduzir riscos continuamente.'] },
  { h: '5. Como usamos seus dados', p: ['Usamos seus dados para fazer o app funcionar e para melhorá-lo, inclusive com estatísticas de uso agregadas, que não incluem o conteúdo dos seus registros. Não vendemos seus dados.'] },
  { h: '6. Seus direitos (LGPD)', p: ['Você pode pedir confirmação do tratamento, acesso, correção, portabilidade e eliminação dos seus dados em [E-MAIL DE CONTATO]. A exclusão da conta diretamente pelo app ainda está em desenvolvimento, e por enquanto é feita a pedido.'] },
  { h: '7. Saúde e treinos', p: ['O Atha não substitui orientação médica ou de profissionais de educação física. Treine dentro dos seus limites.'] },
  { h: '8. Mudanças', p: ['Estes termos têm versão (2026-10). Se mudarem de forma relevante, pediremos um novo aceite.'] },
];

@Component({
  selector: 'app-terms',
  imports: [FormsModule, RouterLink],
  template: `
    <main class="mx-auto max-w-2xl space-y-5 p-6 pb-40">
      <a routerLink="/" class="text-sm font-bold text-brand">← Voltar</a>
      <h1 class="text-3xl font-extrabold tracking-tight">Termos de Uso e Privacidade</h1>
      <p class="rounded-xl bg-chip p-3 text-xs text-slate-500">Rascunho: revise com um advogado e preencha [NOME DA EMPRESA] e [E-MAIL DE CONTATO] antes de publicar.</p>
      @for (s of SECTIONS; track s.h) {
        <section><h2 class="mb-1 text-base font-extrabold">{{ s.h }}</h2>@for (t of s.p; track t) { <p class="text-sm leading-relaxed text-slate-500">{{ t }}</p> }</section>
      }
    </main>
    @if (accept) {
      <div class="fixed inset-x-0 bottom-0 border-t border-line bg-surface p-4 pb-[calc(1rem+env(safe-area-inset-bottom))]">
        <div class="mx-auto max-w-2xl space-y-3">
          <label class="flex items-start gap-2 text-sm"><input type="checkbox" class="mt-1 size-4 accent-[#f97316]" [(ngModel)]="agreed" /> Li e aceito os Termos de Uso e a Política de Privacidade.</label>
          <div class="flex gap-2">
            <button class="btn btn-or flex-1 disabled:opacity-50" [disabled]="!agreed || busy()" (click)="confirm()">Aceitar e continuar</button>
            <button class="btn btn-ghost" (click)="auth.logout()">Sair</button>
          </div>
        </div>
      </div>
    }`,
})
export class Terms {
  private api = inject(Api);
  private router = inject(Router);
  auth = inject(Auth);
  SECTIONS = SECTIONS;
  accept = inject(ActivatedRoute).snapshot.queryParamMap.has('aceitar') && !!this.auth.token;
  agreed = false;
  busy = signal(false);
  confirm() { this.busy.set(true); this.api.post('/me/terms').subscribe({ next: () => this.router.navigateByUrl('/'), error: () => this.busy.set(false) }); }
}
