# ♞ Xadrez Multiverso

Site de xadrez feito em HTML, CSS e JavaScript puro (sem etapa de build), com:

- **Modos 2D e 3D** – tabuleiro em HTML/CSS ou cena 3D com [Three.js](https://threejs.org) (câmera orbital, sombras e animações). Dá para trocar no meio da partida.
- **Peças novas** – Arcebispo (Bispo + Cavalo), Chanceler (Torre + Cavalo), Amazona (Dama + Cavalo) e Camelo (salto 3 + 1).
- **Até 4 jogadores simultâneos** – tabuleiro em cruz 14×14, todos contra todos ou em equipes 2×2, com assentos vazios (3 jogadores) ou preenchidos pelo computador.
- **Tutorial inicial interativo** – 15 lições (movimento de cada peça, roque, xeque-mate, peças novas e regras do modo 4 jogadores), oferecido automaticamente na primeira visita.
- **Ranking Elo** – partidas com jogadores humanos atualizam a pontuação (partidas de 3–4 jogadores contam pela colocação final) e o histórico das últimas partidas.
- **Computador** – adversário simples (busca alfa-beta curta em 1×1; heurística gulosa em 3–4 jogadores).

## Modos de jogo

| Modo | Tabuleiro | Jogadores | Peças |
| --- | --- | --- | --- |
| Clássico | 8×8 | 2 | tradicionais |
| Novas Peças | 10×8 | 2 | + Arcebispo e Chanceler |
| Caos | 8×8 | 2 | Amazona, Arcebispo, Chanceler, Camelos e Torres |
| 4 Jogadores | 14×14 em cruz | 2–4 (opção equipes) | tradicionais ou com peças novas |

Regras do modo 4 jogadores: ordem Vermelho → Azul → Amarelo → Verde; quem leva xeque-mate ou fica sem lances é eliminado; um rei deixado em xeque pode ser capturado por outro jogador antes da vez do dono; peões promovem na linha central.

## Como rodar

Por usar módulos ES, abra o site por um servidor local (não pelo `file://`):

```bash
npm start            # ou: python3 -m http.server
```

Depois acesse o endereço mostrado (ex.: http://localhost:3000). O modo 3D carrega o Three.js via CDN (jsDelivr).

### Publicar no GitHub Pages

Em **Settings → Pages**, escolha *Deploy from a branch* → `main` / `(root)`. Não há build.

## Testes

```bash
npm test
```

Os testes cobrem o motor de regras (incluindo *perft* do xadrez clássico até profundidade 3 = 8.902 posições), roque, en passant, xeque-mate e eliminações no modo 4 jogadores.

## Estrutura

```
index.html          telas: jogar, partida, tutorial, peças e ranking
css/style.css       tema e layout responsivo
js/engine.js        motor de regras genérico (N jogadores, casas removidas, peças novas)
js/variants.js      definição dos modos de jogo
js/render2d.js      tabuleiro 2D
js/render3d.js      tabuleiro 3D (Three.js)
js/ai.js            jogador computador
js/game.js          configuração e controle da partida
js/tutorial.js      lições do tutorial e página das peças
js/ranking.js       ranking Elo (localStorage)
test/               testes do motor (node --test)
```

## Limitações e próximos passos

- O multijogador é **local** (todos no mesmo dispositivo). Jogo online exigiria um servidor (ex.: WebSocket ou Supabase Realtime).
- O ranking fica salvo **no navegador** (localStorage). Para um ranking global, dá para trocar `js/ranking.js` por um banco de dados (ex.: Supabase) com login.

## Licença

MIT
