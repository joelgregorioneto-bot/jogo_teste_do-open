# Aventura 2D Co-op — GDD compacto (v1)

## Pilares
1. Explorar sempre recompensa (item, atalho, lore ou moeda).
2. Combate legível: telegrafia ≥ 350 ms, sempre evitável.
3. Habilidade > número: progressão por ferramentas, sem grind.
4. Cooperação sem dependência: todo obstáculo tem rota solo (lenta) e rota em dupla (rápida).

**Escopo:** 4 biomas · 8 salas · 4 inimigos-assinatura · 1 chefe · 2 kits · 3 ferramentas · 30–45 min.

## Loop
`Explorar → obstáculo → resolver (combate/ferramenta/dupla) → recompensa → nova rota`
Sala comum: 20–40 s. Chefe: 60–90 s com 1–2 mortes.

## Movimento e combate
| Item | Valor |
|---|---|
| Resolução / tile / tick | 320×180 · 16 px · 60 Hz |
| Vanguarda | 95 px/s · 20 HP (5 corações) · arco 2 de dano · escudo |
| Batedora | 130 px/s · 12 HP (3 corações) · adaga 2 de dano · marca (+50% para a Vanguarda) |
| Dash | 360 px/s por 0,16 s · i-frames 0,12 s · recarga 0,45–0,55 s |
| Dano inimigo | 4 (1 coração) · investida 8 · chefe 6 |
| Feedback | hitstop 70 ms · flash · screenshake · som por material |

Inimigos com poise; máx. 4 atacando ao mesmo tempo (2 por jogador). Sem friendly fire.

## Vida em dupla
Caído: 20 s de sangramento · reanimar segurando **E por 3 s** · volta com 50% de vida · 2 s de invulnerabilidade para quem reviveu · morte → checkpoint em 6 s · os dois caídos → reset em 4 s.

## Progressão
| Ferramenta | Resolve |
|---|---|
| **Bomba** (Bosque) | Parede rachada, grupo de inimigos |
| **Gancho** (Grutas) | Abismos e travessia longa |
| **Lanterna** (Dunas) | Névoa do pântano e visão |

Ferramenta é pessoal, **emprestável** (1,5 s) e passa automaticamente ao parceiro se o dono cair. Chave Grande é compartilhada e abre o portão do chefe.

## Biomas
| Bioma | Cores | Inimigo | Contra-jogada em dupla | Ensina |
|---|---|---|---|---|
| **Bosque Ancestral** | verde + dourado | Sentinela de Musgo (8 HP) | Atrai o golpe → outro bate nas **costas** (×2 + stun) | Timing de esquiva |
| **Grutas de Ametista** | roxo + ciano | Olho de Cristal (4 HP) | Escudo frontal: só entra dano **por trás** | Cobertura |
| **Dunas Rubras** | âmbar + oásis frio | Escaravelho Couraça (6 HP) | Isca a investida na parede → **ventre exposto** 1,2 s | Esquiva lateral |
| **Pântano das Brumas** | verde-cinza + ácido | Sapo Bubônico (5 HP) | Língua agarra um → o outro **corta a língua** | Gestão de área |

**Chefe — Coração do Pântano:** 50 HP, 2 fases em 50%, alterna língua, onda de choque e spread de ácido; fase 2 deixa veneno no chão.
**Escalonamento 2P:** vida ×1,7 · **dano ×1,0**.
**Leitura:** inimigo sempre mais escuro e saturado que o fundo; validar em cinza e daltonismo.

## Identidade visual
Vanguarda: ciano `#4FC3F7`, silhueta larga com escudo. Batedora: laranja `#FF8A4C`, silhueta esguia com capuz. Sempre **cor + forma + ícone**.

## Câmera e level design
Câmera única no midpoint · zoom 1,0 → 0,72 (120 → 220 px) · coleira máxima 260 px · salas de 1,5–2 telas · duas rotas convergentes que se reencontram em 10–20 s · porta só fecha com os dois dentro · janelas de timing de 6 s · reset de puzzle sempre visível.

## Online
| Item | Decisão |
|---|---|
| Modelo | Servidor autoritativo + predição/reconciliação |
| Rede | 60 Hz sim · 20 Hz snapshots · ~6–12 KB/s |
| Justiça | Rewind 100 ms · **favorecer o defensor** (i-frames até 120 ms) |
| Pausa | **Não existe**: menus em tempo real |
| Reconexão | Token + 120 s de carência |
| Segurança | Só o servidor concede item · ledger com UUID · two-phase commit |

## Inventário individual
2 slots rápidos + 8 de mochila + 1 ferramenta · **moedas pessoais**, **chaves compartilhadas** · drops com reserva de 2 s para quem matou · troca atômica só fora de combate · inventário do parceiro somente leitura · auto-pickup de moedas · gestão de mochila nos checkpoints.

## Comunicação e acessibilidade
Ping radial (Olha aqui / Me ajuda / Vai / Item) · seta para parceiro fora da tela · aviso sonoro de caído · HUD duplo · remapeamento · sem screenshake · alto contraste · dificuldade 50/100/150%.

## Marcos
1. Movimento + dash + câmera dupla.
2. Combate + reanimação.
3. Salas de 2 telas + 2 rotas + puzzles.
4. 4 biomas + 4 inimigos + chefe.
5. Lobby + reconexão + save de sessão.

## Regra que resume
> **Servidor manda, cliente prediz; vida escala, dano não; todo obstáculo tem dois caminhos; menu nunca pausa; ferramenta nunca bloqueia a dupla.**
