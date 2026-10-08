import { Component } from '@angular/core';
import { RouterLink } from '@angular/router';

const FAQ: { q: string; a: string }[] = [
  { q: 'Como funciona a sequência (🔥)?', a: 'A sequência conta os dias seguidos em que você fez algo no app: marcou um hábito, fez o check-in, concluiu uma tarefa ou finalizou um treino. Se hoje ainda não teve atividade, a sequência de ontem continua valendo até o fim do dia.' },
  { q: 'O que é o quadro "Seu progresso" da Home?', a: 'Cada quadradinho é um dia das últimas 16 semanas. Quanto mais laranja, mais coisas você fez naquele dia. Toque em um quadradinho para ver o detalhe.' },
  { q: 'Como crio um hábito só para alguns dias da semana?', a: 'Em Hábitos, toque no + e marque as letras dos dias (D S T Q Q S S). Sem nenhum dia marcado, o hábito vale para todos os dias. Depois você pode ajustar tocando nas letras dentro do card do hábito.' },
  { q: 'Como o desempenho dos hábitos é calculado?', a: 'É a porcentagem de hábitos concluídos entre os que estavam programados, a partir do dia em que cada hábito foi criado. Dá para ver por dia, por semana (domingo a sábado) ou por mês.' },
  { q: 'Como planejo uma tarefa?', a: 'Ao criar ou editar uma tarefa, defina a Data alvo. Na Home você vê quantas estão atrasadas, são para hoje ou para os próximos 7 dias, e ao tocar abre a lista já filtrada. Em Tarefas você alterna a visão por Status ou por Categoria.' },
  { q: 'Como registro um treino e vejo minha evolução?', a: 'Em Exercícios, monte o treino de cada dia (nome, séries e observação). Toque em Iniciar treino, preencha repetições e carga de cada série e finalize. Na aba Evolução você acompanha carga, volume e séries de cada exercício.' },
  { q: 'Esqueci minha senha. E agora?', a: 'A recuperação por e-mail ainda não está disponível. Se você estiver conectado, troque a senha em Configurações. Se não estiver, fale com a gente pelo e-mail de contato abaixo.' },
  { q: 'Como meus dados são protegidos?', a: 'Sua senha é guardada apenas como hash, exigimos senhas fortes e limitamos as tentativas de login. Os detalhes estão nos Termos de Uso e na Política de Privacidade.' },
  { q: 'Como excluo minha conta?', a: 'Em Configurações, na Zona de perigo, informe sua senha e digite EXCLUIR. Perfil, hábitos, tarefas, check-ins e treinos são apagados de forma definitiva.' },
];

@Component({
  selector: 'app-help',
  imports: [RouterLink],
  template: `
    <section class="space-y-3 p-5">
      <div class="pb-1"><h1 class="text-4xl font-extrabold tracking-tight">Ajuda</h1><p class="text-slate-500">Dúvidas frequentes sobre o Atha.</p></div>
      @for (f of FAQ; track f.q) {
        <details class="card">
          <summary class="cursor-pointer font-bold">{{ f.q }}</summary>
          <p class="mt-2 text-sm leading-relaxed text-slate-500">{{ f.a }}</p>
        </details>
      }
      <div class="card space-y-1">
        <p class="font-bold">Não achou o que procurava?</p>
        <p class="text-sm text-slate-500">Fale com a gente: [E-MAIL DE CONTATO]</p>
        <a routerLink="/termos" class="text-sm font-bold text-brand">Termos de Uso e Privacidade</a>
      </div>
    </section>`,
})
export class Help { FAQ = FAQ; }
