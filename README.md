# Aventura 2D — co-op online para 2 jogadores

Jogo de aventura 2D cooperativo, jogável no navegador. Dois jogadores, quatro biomas,
um inimigo próprio por bioma e um chefe no final. Servidor autoritativo em Node.js.

## Como rodar

```bash
npm install
npm start
```

Abra <http://localhost:8080> em duas abas (ou em duas máquinas da mesma rede, usando o
IP que o servidor imprime no terminal).

- **Criar sala:** um jogador cria e recebe um código de 5 caracteres.
- **Entrar:** o outro usa o mesmo código — ou o link `http://IP:8080/?sala=CODIGO`.
- **Kits:** Vanguarda (tanque, melee, escudo) e Batedora (rápida, à distância, marca alvos).
- **Inventário:** separado por jogador. Moedas são pessoais, chaves são compartilhadas.

## Controles

| Tecla | Ação |
|---|---|
| WASD / setas | mover |
| J / clique esquerdo | atacar |
| K / barra de espaço | dash |
| E | interagir / reanimar parceiro |
| I | inventário |
| Q | ping rápido |
| 1 / 2 | itens rápidos |

## Arquitetura

```
public/    cliente (Canvas 2D, predição local, render procedural)
shared/    constantes e simulação usadas pelos dois lados
server/    servidor autoritativo (60 Hz de simulação, 20 Hz de snapshots)
docs/      Game Design Document
```

O cliente nunca decide dano, item ou morte: envia intenção e desenha o que o servidor
confirma. O movimento usa predição + reconciliação sobre o mesmo `shared/sim.js`.

## Status

Primeira versão jogável em construção. O design completo está em
[`docs/GDD.md`](docs/GDD.md).

