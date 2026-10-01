# Backlog das rotinas (PO ↔ Devs)

Fila de trabalho entre a rotina diária da PO e a rotina dos devs da Build Labs.
As duas leem e escrevem só aqui para conversar. Backlog próprio do repositório
(roadmap, débitos `DT-…`, `KNOWN-ISSUES`) continua valendo: o item daqui cita o
de lá em vez de copiar.

```
backlog/
  README.md                         este formato, resumido
  INDEX.md                          tabela de todos os itens
  itens/<ID>-<slug>.md              um arquivo por item
  evidencias/<ID>/*.png|*.svg|*.txt prints, mockups, logs
  relatorios/po/AAAA-MM-DD.md       relatório diário da PO
  relatorios/dev/AAAA-MM-DD.md      relatório diário dos devs
```

## IDs

Prefixo do projeto + 4 dígitos, sem reaproveitar: `CF-` cogniflow · `LR-`
lilian-rosa · `FQ-` fragiq · `MH-` motorhub. Próximo = maior em `itens/` + 1.

## Item

Frontmatter: `id`, `titulo`, `projeto`, `tipo` (bug | melhoria | feature |
seguranca | ux | performance | divida | observabilidade | decisao),
`prioridade` (P0 crucial | P1 importante | P2 legal ter), `status`, `esforco`
(P horas | M um dia | G quebrar antes), `area`, `criado_por`, `criado_em`,
`atualizado_em`, `commits`, `relacionados`.

Seções: Problema · Evidências · Ilustração · Critérios de aceite
(Dado/Quando/Então + teste E2E) · Notas técnicas · Conversa · Entrega.

## Status

| Status | Quem põe | Significa |
|---|---|---|
| `pronto` | PO | Pode ser feito. Critérios claros e testáveis |
| `em-andamento` | Dev | Um dev pegou |
| `precisa-po` | Dev | Dev avaliou e não fez; motivo em Conversa |
| `precisa-humano` | PO ou Dev | Depende do Murilo |
| `feito` | Dev | Na `main` com testes e evidências; falta a PO validar |
| `validado` | PO | Conferido em produção. Fim |
| `descartado` | PO | Não vale a pena; motivo em Conversa |

Fluxo: `pronto → em-andamento → feito → validado`, com `→ precisa-po → pronto |
descartado` e `→ precisa-humano`. `feito` que falha na validação volta a
`pronto` com a evidência.

## Conversa

Mensagens no fim de `## Conversa`, com `### AAAA-MM-DD · PO` ou
`### AAAA-MM-DD · Dev`. Nunca apagar nem reescrever mensagem antiga. Quem muda
o status explica por quê na mesma mensagem.

## INDEX.md

Ordem: `em-andamento`, `pronto`, `precisa-po`, `precisa-humano`, `feito`;
depois prioridade; depois ID. `validado` e `descartado` no fim.

## Evidências

PNG da viewport (1280x800 desktop, 390x844 celular), < 400 KB, nome que diz o
que mostra. Logs e saídas em `.txt`, só o trecho que importa. Nunca capturar
segredo, token, e-mail ou telefone de cliente real.
