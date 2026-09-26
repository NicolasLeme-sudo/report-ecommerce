/* =========================================================================
   ECOM-FLUXO.JS — Fluxo de Processos E-commerce
   ---------------------------------------------------------------------
   Renderiza o fluxograma (retângulo=etapa, losango=decisão, pílula=início/
   fim) a partir do JSON salvo em dashboard_snapshots (pagina='ecom_fluxo')
   e, para quem tem perfil admin, liga um editor ao vivo por cima: clicar
   numa seta insere etapa/quebra/B.O.; clicar numa etapa ou losango abre o
   painel de edição de todos os campos; cadastro de setores; nova fase.

   Portado do gerador estático que criou e validou o desenho aprovado
   (nodes2.py + flow2.py + icons.py → build6.py, style2.css, script2.js):
   aqui a topologia deixou de ser "assada" em HTML na hora da build e passou
   a ser dado (JSON) lido e desenhado em tempo real — o mesmo motor de
   retângulo/losango/pílula e o mesmo motor de conectores SVG, só que agora
   reexecutáveis a cada edição, não uma vez só.

   Este arquivo só lê e desenha, e (só para admin) escreve. Trava dupla em
   toda ação de escrita, mesmo padrão da categoria do armazém em index.html:
   `if (perfilAtual !== 'admin') return;` no cliente, e a RLS
   `escrita_somente_admin` no banco — a interface esconder o botão não é a
   proteção real.

   Cópia do distr-fluxo.js (report-DISTR): mesmo motor, mesmo editor, mesmo
   visual. Diferenças daqui: pagina='ecom_fluxo'; o insert grava também
   tipo_snapshot/data_snapshot (NOT NULL na dashboard_snapshots do
   E-commerce); a tabela "Armazéns" só aparece se o payload tiver armazéns.
   ========================================================================= */
(function (global) {
"use strict";

/* ---------- ícones de linha, 24×24, stroke currentColor (herdado de icons.py) ---------- */
const ICONS = {"cal": "<rect x=\"3.5\" y=\"5\" width=\"17\" height=\"15\" rx=\"1.5\"/><path d=\"M3.5 9.5h17M8 3v4M16 3v4\"/><circle cx=\"8.2\" cy=\"13.5\" r=\"1\"/>", "mail": "<rect x=\"3\" y=\"5.5\" width=\"18\" height=\"13\" rx=\"1.5\"/><path d=\"M4 6.5l8 6.5 8-6.5\"/>", "truck": "<path d=\"M2.5 7h11v8h-11z\"/><path d=\"M13.5 10h3.7l3.3 3v2h-7z\"/><circle cx=\"6.3\" cy=\"17\" r=\"1.7\"/><circle cx=\"16.7\" cy=\"17\" r=\"1.7\"/>", "clip": "<rect x=\"5.5\" y=\"4.5\" width=\"13\" height=\"16\" rx=\"1.5\"/><rect x=\"9\" y=\"3\" width=\"6\" height=\"3\" rx=\"1\"/><path d=\"M8.5 11l2 2 4-4.5\"/>", "file": "<path d=\"M6 3h8l4 4v14H6z\"/><path d=\"M14 3v4h4\"/><path d=\"M9 13h6M9 16.5h6\"/>", "lupa": "<circle cx=\"10.5\" cy=\"10.5\" r=\"6.2\"/><path d=\"M15.2 15.2 20 20\"/>", "shake": "<path d=\"M3 15l4-4 3 3-4 4z\"/><path d=\"M14 8l4-4 3 3-4 4z\"/><path d=\"M10 11l3.3-3.3\"/><path d=\"M9 14l-1.5 4M6.5 12.5l-4 1.5\"/>", "lupaf": "<circle cx=\"10.5\" cy=\"10.5\" r=\"6.2\"/><path d=\"M15.2 15.2 20 20\"/><path d=\"M8 10.5h5\"/>", "gavel": "<path d=\"M14 3l6 6-2 2-6-6z\"/><path d=\"M12 5l-8 8\"/><path d=\"M10 13l3 3\"/><path d=\"M3 20h9\"/>", "boxx": "<path d=\"M3 8l6-4 6 4v7l-6 4-6-4z\"/><path d=\"M9 4v15M3 8l6 3 6-3\"/>", "boxes": "<path d=\"M2.5 9l4.5-3 4.5 3v5.5l-4.5 3-4.5-3z\"/><path d=\"M12.5 6l4.5-3 4.5 3v5.5l-4.5 3-4.5-3z\"/><path d=\"M7 6l4.5 3M7 14.5V9M16.5 3l-4.5 3M17 14.5V9\"/>", "unlock": "<rect x=\"5\" y=\"11\" width=\"14\" height=\"9\" rx=\"1.5\"/><path d=\"M8 11V7.5a4 4 0 0 1 7-2.6\"/><circle cx=\"12\" cy=\"15.3\" r=\"1.3\"/>", "tag": "<path d=\"M12 3h6a1 1 0 0 1 1 1v6l-9 9-8-8z\"/><circle cx=\"15.5\" cy=\"7.5\" r=\"1.3\"/>", "pin": "<path d=\"M12 21s7-6.5 7-11.5A7 7 0 0 0 5 9.5C5 14.5 12 21 12 21z\"/><circle cx=\"12\" cy=\"9.5\" r=\"2.3\"/>", "refresh": "<path d=\"M20 12a8 8 0 1 1-2.6-5.9\"/><path d=\"M20 3v5h-5\"/>", "fork1": "<circle cx=\"12\" cy=\"4.5\" r=\"1.6\"/><path d=\"M12 6v5\"/><path d=\"M12 11l-5 4M12 11l5 4\"/><circle cx=\"7\" cy=\"17\" r=\"1.6\"/><circle cx=\"17\" cy=\"17\" r=\"1.6\"/>", "shelf": "<path d=\"M3 4h18M3 12h18M3 20h18\"/><path d=\"M6 4v16M18 4v16\"/><rect x=\"8\" y=\"6.3\" width=\"3.4\" height=\"4\"/><rect x=\"12.6\" y=\"14.3\" width=\"3.4\" height=\"4\"/>", "report": "<path d=\"M6 3h8l4 4v14H6z\"/><path d=\"M14 3v4h4\"/><path d=\"M9 13l1.7 1.7L14.5 11\"/>", "pallet": "<path d=\"M3 8l6-4 6 4v7l-6 4-6-4z\"/><path d=\"M9 4v15M3 8l6 3 6-3\"/><path d=\"M15 6l4.5-2.5 4.5 2.5\"/>", "up": "<path d=\"M12 20V5\"/><path d=\"M6 11l6-6 6 6\"/>", "stardoc": "<path d=\"M6 3h8l4 4v14H6z\"/><path d=\"M14 3v4h4\"/><path d=\"M12 12.3l1 2 2.2.3-1.6 1.5.4 2.2-2-1-2 1 .4-2.2-1.6-1.5 2.2-.3z\"/>", "flag": "<path d=\"M6 3v18\"/><path d=\"M6 4.5h11l-2.5 3.5L17 11.5H6z\"/>", "hand": "<path d=\"M8 12V5.5a1.5 1.5 0 0 1 3 0V11\"/><path d=\"M11 11V4a1.5 1.5 0 0 1 3 0v7\"/><path d=\"M14 11.5V6a1.5 1.5 0 0 1 3 0v9\"/><path d=\"M8 12l-1.8-1.6a1.4 1.4 0 0 0-2 2L8.5 17c1 1.5 2.6 3 5.5 3 3.3 0 5-2.2 5-5v-3\"/>", "shirt": "<path d=\"M8 4l4 2 4-2 4 3-3 3-1-1v10H8V9l-1 1-3-3z\"/>", "shoe": "<path d=\"M3 17.5c0-3 2-5 4.5-6.5L13 7l2 2-2.5 2 5 1.5c1.5.5 2.5 1.7 2.5 3v2z\"/><path d=\"M3 17.5h18\"/>", "alert": "<path d=\"M12 3.5l9.3 16.5H2.7z\"/><path d=\"M12 10v4.2\"/><circle cx=\"12\" cy=\"17\" r=\"1\"/>", "grid": "<rect x=\"3.5\" y=\"3.5\" width=\"7\" height=\"7\" rx=\"1\"/><rect x=\"13.5\" y=\"3.5\" width=\"7\" height=\"7\" rx=\"1\"/><rect x=\"3.5\" y=\"13.5\" width=\"7\" height=\"7\" rx=\"1\"/><rect x=\"13.5\" y=\"13.5\" width=\"7\" height=\"7\" rx=\"1\"/>", "belt": "<rect x=\"2.5\" y=\"9\" width=\"19\" height=\"6\" rx=\"1\"/><circle cx=\"6.5\" cy=\"12\" r=\"1\"/><circle cx=\"12\" cy=\"12\" r=\"1\"/><circle cx=\"17.5\" cy=\"12\" r=\"1\"/>", "brush": "<path d=\"M17 3l4 4-8.5 8.5-4-4z\"/><path d=\"M9 14.5c0 3-2 4-5.5 5.5 1.5-3.5 1-6 4-7z\"/>", "invoice": "<path d=\"M6 3h12v18l-3-2-3 2-3-2-3 2z\"/><path d=\"M9 8h6M9 11.5h6M9 15h4\"/>", "clock": "<circle cx=\"12\" cy=\"12\" r=\"8.5\"/><path d=\"M12 7v5l3.5 2\"/>", "callock": "<rect x=\"3.5\" y=\"5\" width=\"17\" height=\"15\" rx=\"1.5\"/><path d=\"M3.5 9.5h17M8 3v4\"/><rect x=\"14.3\" y=\"12\" width=\"6\" height=\"5\" rx=\"1\"/><path d=\"M15.6 12v-1.6a1.7 1.7 0 0 1 3.4 0V12\"/>", "barcode": "<path d=\"M4 4v16M8 4v16M11 4v16M13.5 4v16M17 4v16M20 4v16\" stroke-width=\"1.6\"/>", "route": "<circle cx=\"6\" cy=\"6\" r=\"2.3\"/><circle cx=\"18\" cy=\"18\" r=\"2.3\"/><path d=\"M6 8.3V13a4 4 0 0 0 4 4h4\"/>", "listc": "<rect x=\"4.5\" y=\"4\" width=\"15\" height=\"16\" rx=\"1.5\"/><path d=\"M8 9l1.5 1.5L12.5 7.3\"/><path d=\"M8 15h8\" stroke-width=\"1.8\"/>", "ret": "<path d=\"M20 12a8 8 0 1 1-2.6-5.9\"/><path d=\"M20 3v5h-5\"/><rect x=\"9\" y=\"10\" width=\"6\" height=\"5\"/>", "boxin": "<path d=\"M3 8l6-4 6 4v7l-6 4-6-4z\"/><path d=\"M9 4v15M3 8l6 3 6-3\"/><path d=\"M22 10l-3 3 3 3M19 13h5\" stroke-width=\"1.6\"/>"};
const ICONE_PADRAO = "cal";

/* ---------- estado do módulo ---------- */
let SB = null;             // supabaseClient da página host
let PERFIL = null;         // perfilAtual da página host ('operador'|'gestor'|'admin')
let ROOT = null;           // elemento #dfRoot
let DADOS = null;          // payload carregado { lanes, nos, setores, armazens, pendencias }
let SNAP_INFO = null;      // { gerado_em } do snapshot carregado
let EDITADO = false;       // há alterações não salvas?
let EDGES = [];            // recalculado a cada renderTudo()

function esc(s) {
  return String(s == null ? "" : s).replace(/[&<>"]/g, function (c) {
    return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c];
  });
}
function svgIcon(key) {
  const d = ICONS[key] || ICONS[ICONE_PADRAO];
  return '<svg class="df-ic" viewBox="0 0 24 24" aria-hidden="true">' + d + "</svg>";
}
let _uid = 0;
function uid() { _uid += 1; return "df-g" + _uid; }
function safeId(s) { return String(s).replace(/\./g, "_").replace(/A/g, "-A").replace(/B/g, "-B"); }
function bidOf(fase, n) { return "df-n-" + fase + "-" + safeId(n); }
function nodeKey(fase, n) { return fase + ":" + n; }
function isAdmin() { return PERFIL === "admin"; }

/* ============================================================
   RENDERIZADOR — porta rect/pill/diamond/render_section/render_multi
   de build6.py. Em vez de escrever num arquivo uma vez, roda de novo a
   cada chamada de renderTudo(), lendo DADOS ao vivo.
   ============================================================ */
const TIPO_LBL = {
  principal: "Etapa principal", seq: "Subetapa sequencial", desvio: "Desvio / B.O.",
  bifurcacao: "Bifurcação", gate: "Regra do sistema",
};
// Prefixo "df-" é obrigatório: o CSS espera ".df-step.df-t-d" etc (regra
// #dfRoot .df-step.df-t-d { border-color: var(--df-red) }...). Sem o prefixo,
// a classe não batia com nada e toda caixa saía sem cor por tipo — mesma
// causa raiz do bug corrigido no PEND_MAP (commit d5f33ee).
const TIPO_CLS = { principal: "df-t-n", seq: "df-t-n", desvio: "df-t-d", bifurcacao: "df-t-b", gate: "df-t-g" };

function rect(fase, n, kind) {
  const e = DADOS.nos[nodeKey(fase, n)];
  if (!e) return '<span class="df-step-missing">?' + esc(n) + "</span>";
  const bid = bidOf(fase, n);
  const marks = [];
  if (e.alerta) marks.push('<i class="df-mk df-mk-al" title="Pendência a decidir">?</i>');
  if (e.marco) marks.push('<i class="df-mk df-mk-ms" title="Marco do processo">★</i>');
  if (e.loop) marks.push('<i class="df-mk df-mk-lp" title="Reinjeta no ciclo">↺</i>');
  // Selo "NOVO" e a seção "Etapa nova nesta revisão" no painel de detalhe
  // (mais abaixo, em openDetail) foram tirados de vista a pedido do usuário
  // -- "não temos necessidade disso no momento". O campo `e.novo`/`extraido_de`
  // continua vindo no payload (é dado histórico da migração da planilha),
  // só parou de ser desenhado. Reativar é só desfazer este comentário.
  const cls = kind === "gate" ? TIPO_CLS.gate : (TIPO_CLS[e.tipo] || "t-n");
  return (
    '<button type="button" class="df-box df-step ' + cls + '" id="' + bid +
    '" data-fase="' + esc(fase) + '" data-n="' + esc(n) + '">' +
    '<i class="df-s-num">' + esc(n) + "</i>" +
    '<span class="df-s-ico">' + svgIcon(e.icone) + marks.join("") + "</span>" +
    '<span class="df-s-t">' + esc(e.nome) + "</span></button>"
  );
}
function pillHtml(text, cls) {
  const bid = uid();
  return [bid, '<div class="df-box df-pill ' + cls + '" id="' + bid + '"><span>' + esc(text) + "</span></div>"];
}
function diamondHtml(question, guardType, fase, blocoIdx) {
  const bid = uid();
  return [bid, '<div class="df-box df-dia" id="' + bid + '" data-guardtype="' + esc(guardType) +
    '" data-fase="' + esc(fase) + '" data-bloco="' + blocoIdx +
    '"><span class="df-d-in">' + esc(question) + "</span></div>"];
}
function edge(a, b, kind, label, sem, meta) {
  EDGES.push({ a: a, b: b, kind: kind || "straight", label: label || "", sem: sem || "normal", meta: meta || null });
}

/* Renderiza um trecho do tronco (uma fase) dentro de uma lane já aberta.
   Retorna { prev, prevLabel, prevSem, pendingRejoin } para encadear com a
   próxima fase — mesma forma de render_section() em build6.py. */
/* Toda seta que pode receber um novo bloco carrega `meta`:
     {kind:'trunk', fase, blocoIdx}                              — insere um
       step novo na posição blocoIdx do tronco (empurra quem já estava lá).
     {kind:'chain', chainKind:'guard'|'fork', fase, blocoIdx,
      branch?, atPos}                                            — insere um
       item novo na cadeia (nExc do guard, ou lista do ramo do fork), na
       posição atPos (atPos === length da lista de hoje = "no fim").
   É essa meta que o clique na seta (onEdgeClick) lê pra saber o que oferecer
   no menu e onde exatamente mexer na topologia (ver "MOTOR DE NUMERAÇÃO"). */
function renderSection(faseId, blocos, out, prev, prevLabel, prevSem) {
  let pendingRejoin = [];
  function flushTo(nextBid, blocoIdx) {
    edge(prev, nextBid, "straight", prevLabel, prevSem, { kind: "trunk", fase: faseId, blocoIdx: blocoIdx });
    pendingRejoin.forEach(function (r) { edge(r[0], nextBid, "straight", "", r[1], r[2]); });
    pendingRejoin = [];
    prev = nextBid; prevLabel = ""; prevSem = "normal";
  }
  blocos.forEach(function (b, blocoIdx) {
    const kind = b[0];
    if (kind === "step" || kind === "gate") {
      const n = b[1], bid = bidOf(faseId, n);
      out.push(rect(faseId, n, kind));
      flushTo(bid, blocoIdx);
    } else if (kind === "guard") {
      const question = b[1], nExc = b[2], opts = b[3] || {};
      const rejoin = !!opts.rejoin, parallel = !!opts.parallel;
      const excLbl = opts.exc || "Sim", okLbl = opts.ok || "Não";
      const dia = diamondHtml(question, "guard", faseId, blocoIdx), did = dia[0];
      out.push('<div class="df-grow" data-bloco="' + blocoIdx + '" data-fase="' + esc(faseId) +
        '"><div class="df-gd">' + dia[1] + '</div><div class="df-gside">');
      edge(prev, did, "straight", prevLabel, prevSem, { kind: "trunk", fase: faseId, blocoIdx: blocoIdx });
      prev = did;
      let sidePrev = did;
      nExc.forEach(function (n, i) {
        const bid = bidOf(faseId, n);
        out.push(rect(faseId, n));
        const meta = { kind: "chain", chainKind: "guard", fase: faseId, blocoIdx: blocoIdx, atPos: i };
        if (i === 0) edge(sidePrev, bid, "right", excLbl, "exc", meta);
        else edge(sidePrev, bid, "straight", parallel ? "ou" : "", "exc", meta);
        sidePrev = bid;
      });
      const metaFim = { kind: "chain", chainKind: "guard", fase: faseId, blocoIdx: blocoIdx, atPos: nExc.length };
      if (rejoin) {
        pendingRejoin.push([sidePrev, "exc", metaFim]);
        out.push("</div></div>");
      } else {
        const fim = pillHtml("Fim deste caminho", "df-end df-pill-sub"), eid = fim[0];
        edge(sidePrev, eid, "straight", "", "exc", metaFim);
        out.push(fim[1] + "</div></div>");
      }
      // saída correta do losango: verde, para contrastar com o vermelho do B.O.
      prevLabel = okLbl; prevSem = "ok";
    } else if (kind === "fork") {
      const question = b[1], branches = b[2];
      const dia = diamondHtml(question, "fork", faseId, blocoIdx), did = dia[0];
      out.push(dia[1]);
      edge(prev, did, "straight", prevLabel, prevSem, { kind: "trunk", fase: faseId, blocoIdx: blocoIdx });
      prev = did; prevLabel = ""; prevSem = "normal";
      out.push('<div class="df-frow" data-bloco="' + blocoIdx + '" data-fase="' + esc(faseId) + '">');
      branches.forEach(function (br, bi) {
        const lab = br[0], ns = br[1];
        out.push('<div class="df-fcol">');
        let cprev = null;
        ns.forEach(function (n, i) {
          const bid = bidOf(faseId, n);
          out.push(rect(faseId, n));
          const meta = { kind: "chain", chainKind: "fork", fase: faseId, blocoIdx: blocoIdx, branch: bi, atPos: i };
          edge(i === 0 ? did : cprev, bid, "straight", i === 0 ? lab : "", "fork", meta);
          cprev = bid;
        });
        const metaFim = { kind: "chain", chainKind: "fork", fase: faseId, blocoIdx: blocoIdx, branch: bi, atPos: ns.length };
        pendingRejoin.push([cprev, "fork", metaFim]);
        out.push("</div>");
      });
      out.push("</div>");
    }
  });
  return { prev: prev, prevLabel: prevLabel, prevSem: prevSem, pendingRejoin: pendingRejoin, blocoIdxFim: blocos.length };
}

/* sections = [{id,titulo,blocos}, ...] — uma lane contínua com Início único,
   Fim único, e um divisor visível entre cada fase. Porta render_multi(). */
function renderMulti(lane) {
  const out = [
    '<section class="df-lane-wrap"><h2 class="df-lane-h"><span>' + esc(lane.titulo) + "</span></h2>" +
    '<p class="df-lane-sub">' + esc(lane.sub || "") + "</p>" +
    '<p class="df-drag-hint"><svg viewBox="0 0 24 24"><path d="M8 5l-5 7 5 7M16 5l5 7-5 7"/></svg>' +
    "Arraste para o lado para ver os desvios</p>" +
    '<div class="df-lane-fit"><div class="df-lane" id="df-lane-' + esc(lane.id) + '" data-lane="' + esc(lane.id) + '">',
  ];
  const inicio = pillHtml("Início", "df-start"), sid = inicio[0];
  out.push(inicio[1]);
  let prev = sid, prevLabel = "", prevSem = "normal", trailingRejoin = [], prevFaseId = null, prevBlocoFim = 0;
  lane.fases.forEach(function (fase, i) {
    if (i > 0) {
      const divId = uid();
      out.push('<div class="df-phase-div" id="' + divId + '"><span>' + esc(fase.titulo) + "</span></div>");
      edge(prev, divId, "straight", prevLabel, prevSem, { kind: "trunk", fase: prevFaseId, blocoIdx: prevBlocoFim });
      trailingRejoin.forEach(function (r) { edge(r[0], divId, "straight", "", r[1], r[2]); });
      prev = divId; prevLabel = ""; prevSem = "normal";
    }
    const r = renderSection(fase.id, fase.blocos, out, prev, prevLabel, prevSem);
    prev = r.prev; prevLabel = r.prevLabel; prevSem = r.prevSem; trailingRejoin = r.pendingRejoin;
    prevFaseId = fase.id; prevBlocoFim = r.blocoIdxFim;
  });
  const fim = pillHtml("Fim", "df-end"), eid = fim[0];
  out.push(fim[1]);
  edge(prev, eid, "straight", prevLabel, prevSem, { kind: "trunk", fase: prevFaseId, blocoIdx: prevBlocoFim });
  trailingRejoin.forEach(function (r) { edge(r[0], eid, "straight", "", r[1], r[2]); });
  out.push("</div></div></section>");
  return out.join("");
}

function renderTudo() {
  EDGES = [];
  DADOS.lanes.forEach(function (lane) {
    const holder = ROOT.querySelector('[data-lane-holder="' + lane.id + '"]');
    if (holder) holder.innerHTML = renderMulti(lane);
  });
  atualizarCabecalho();
  scheduleDraw();
}

/* ============================================================
   CONECTORES (SVG medido após layout) — porta quase literal de script2.js.
   Continua operando só sobre EDGES (dado) + DOM (ids), então não precisou
   mudar quando a topologia deixou de ser "assada" e passou a ser lida do
   banco: o motor não sabe nem precisa saber de onde vieram os EDGES.
   ============================================================ */
function rectOf(el, lane) {
  const r = el.getBoundingClientRect(), lr = lane.getBoundingClientRect();
  // O <svg class="df-wires"> é filho de .df-lane e HERDA o zoom do pai (zoom,
  // ao contrário de transform, é uma propriedade que cascateia pros
  // descendentes). Isso significa que qualquer coordenada que a gente escreva
  // no atributo "d" do path é multiplicada de novo pelo zoom da lane na hora
  // de desenhar na tela — um dobro de escala que não existe em nenhum outro
  // canto do CSS. Resultado medido com getScreenCTM(): sem essa divisão, o
  // traçado caía a ~300px de onde a caixa realmente estava (bug relatado como
  // "linhas bagunçadas, nada centralizado"). Dividindo pelo zoom ATUAL aqui,
  // a multiplicação que o <svg> vai fazer sozinho na hora de renderizar
  // CANCELA essa divisão e a linha acerta exatamente a posição real da caixa
  // — não importa o que o zoom fizer por baixo dos panos com min-width/flex,
  // porque r/lr já são a posição REAL medida na tela (drawLane roda depois
  // de fitAll aplicar o zoom final, ver comentário em drawAll).
  const zoom = parseFloat(getComputedStyle(lane).zoom) || 1;
  return {
    x: (r.left - lr.left) / zoom, y: (r.top - lr.top) / zoom, w: r.width / zoom, h: r.height / zoom,
    cx: (r.left - lr.left + r.width / 2) / zoom, cy: (r.top - lr.top + r.height / 2) / zoom,
    right: (r.left - lr.left + r.width) / zoom, bottom: (r.top - lr.top + r.height) / zoom,
  };
}
function ptSide(rc, side) {
  if (side === "top") return { x: rc.cx, y: rc.y };
  if (side === "bottom") return { x: rc.cx, y: rc.bottom };
  if (side === "left") return { x: rc.x, y: rc.cy };
  return { x: rc.right, y: rc.cy };
}
const LBL_H = 22; // altura do chip de rótulo — usada para desviar dele nos cotovelos

function pathV(a, b, my) {
  if (Math.abs(a.x - b.x) < 2) return "M" + a.x + "," + a.y + " L" + b.x + "," + b.y;
  return "M" + a.x + "," + a.y + " L" + a.x + "," + my + " L" + b.x + "," + my + " L" + b.x + "," + b.y;
}
function pathH(a, b) {
  if (Math.abs(a.y - b.y) < 2) return "M" + a.x + "," + a.y + " L" + b.x + "," + b.y;
  const mx = a.x + (b.x - a.x) * 0.5;
  return "M" + a.x + "," + a.y + " L" + mx + "," + a.y + " L" + mx + "," + b.y + " L" + b.x + "," + b.y;
}
function labelY(a, b) { return a.y + Math.min(28, Math.max(14, (b.y - a.y) * 0.45)); }
function elbowY(a, b, faixa) {
  const lo = a.y + 10, hi = b.y - 4;
  let y = Math.min(Math.max(lo, b.y - 26), hi);
  if (faixa && y > faixa.top - 6 && y < faixa.bottom + 6) {
    const abaixo = faixa.bottom + 8;
    if (abaixo <= hi) return abaixo;
    const acima = faixa.top - 8;
    if (acima >= lo) return acima;
  }
  return y;
}
function ensureSvg(lane) {
  let svg = lane.querySelector("svg.df-wires");
  if (!svg) {
    const pfx = lane.id;
    svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    svg.setAttribute("class", "df-wires");
    svg.dataset.pfx = pfx;
    svg.innerHTML =
      '<defs>' +
      '<marker id="ar-n-' + pfx + '" markerWidth="8" markerHeight="8" refX="6" refY="3" orient="auto"><path d="M0,0 L6,3 L0,6 Z" fill="currentColor"/></marker>' +
      '<marker id="ar-e-' + pfx + '" markerWidth="8" markerHeight="8" refX="6" refY="3" orient="auto"><path d="M0,0 L6,3 L0,6 Z" fill="currentColor"/></marker>' +
      '<marker id="ar-f-' + pfx + '" markerWidth="8" markerHeight="8" refX="6" refY="3" orient="auto"><path d="M0,0 L6,3 L0,6 Z" fill="currentColor"/></marker>' +
      '<marker id="ar-o-' + pfx + '" markerWidth="8" markerHeight="8" refX="6" refY="3" orient="auto"><path d="M0,0 L6,3 L0,6 Z" fill="currentColor"/></marker>' +
      "</defs>";
    lane.insertBefore(svg, lane.firstChild);
  }
  return svg;
}
function clearLabels(lane) { lane.querySelectorAll(".df-wire-label").forEach(function (n) { n.remove(); }); }

function drawLane(lane) {
  const svg = ensureSvg(lane);
  while (svg.children.length > 1) svg.removeChild(svg.lastChild);
  clearLabels(lane);
  // zera antes de medir: senão o <svg> nunca encolhe de volta (mesmo bug do
  // artifact original — "Restaurar padrão" não voltava a 100%).
  svg.setAttribute("width", 1); svg.setAttribute("height", 1);
  const natW = lane.scrollWidth, natH = lane.scrollHeight;
  svg.setAttribute("width", natW); svg.setAttribute("height", natH);

  const arestas = [];
  EDGES.forEach(function (ed) {
    const a = document.getElementById(ed.a), b = document.getElementById(ed.b);
    if (!a || !b || !lane.contains(a) || !lane.contains(b)) return;
    const ra = rectOf(a, lane), rb = rectOf(b, lane), it = { ed: ed };
    if (ed.kind === "right") {
      it.horizontal = true; it.pa = ptSide(ra, "right"); it.pb = ptSide(rb, "left");
    } else {
      it.horizontal = false; it.pa = ptSide(ra, "bottom"); it.pb = ptSide(rb, "top");
      it.reta = Math.abs(it.pa.x - it.pb.x) < 2;
      if (it.reta && ed.label) it.ly = labelY(it.pa, it.pb);
    }
    arestas.push(it);
  });

  const faixas = {};
  arestas.forEach(function (it) {
    if (it.ly == null) return;
    faixas[it.ed.b] = { top: it.ly - LBL_H / 2, bottom: it.ly + LBL_H / 2 };
  });

  arestas.forEach(function (it) {
    const ed = it.ed;
    let d, mid;
    if (it.horizontal) {
      d = pathH(it.pa, it.pb);
      mid = { x: it.pa.x + Math.max(24, (it.pb.x - it.pa.x) * 0.35), y: it.pa.y };
    } else if (it.reta) {
      d = pathV(it.pa, it.pb);
      mid = { x: it.pa.x, y: it.ly != null ? it.ly : labelY(it.pa, it.pb) };
    } else {
      const my = elbowY(it.pa, it.pb, faixas[ed.b]);
      d = pathV(it.pa, it.pb, my);
      mid = { x: (it.pa.x + it.pb.x) / 2, y: my };
    }
    const cls = ed.sem === "exc" ? "df-wire-exc" : ed.sem === "fork" ? "df-wire-fork"
      : ed.sem === "ok" ? "df-wire-ok" : "df-wire-normal";
    const marker = (ed.sem === "exc" ? "ar-e" : ed.sem === "fork" ? "ar-f"
      : ed.sem === "ok" ? "ar-o" : "ar-n") + "-" + svg.dataset.pfx;
    const p = document.createElementNS("http://www.w3.org/2000/svg", "path");
    p.setAttribute("d", d);
    p.setAttribute("class", cls);
    p.setAttribute("marker-end", "url(#" + marker + ")");
    // no modo admin, uma segunda trilha invisível e mais grossa por cima —
    // é ela que recebe o clique, já que 2px de linha é alvo difícil demais.
    if (isAdmin()) {
      const hit = document.createElementNS("http://www.w3.org/2000/svg", "path");
      hit.setAttribute("d", d);
      hit.setAttribute("class", "df-wire-hit");
      hit.dataset.a = ed.a; hit.dataset.b = ed.b;
      if (ed.meta) hit.dataset.meta = JSON.stringify(ed.meta);
      hit.addEventListener("click", onEdgeClick);
      svg.appendChild(hit);
    }
    svg.appendChild(p);
    if (ed.label) {
      const lb = document.createElement("span");
      lb.className = "df-wire-label" + (ed.sem === "exc" ? " df-wl-exc" : ed.sem === "fork" ? " df-wl-fork"
        : ed.sem === "ok" ? " df-wl-ok" : "");
      lb.textContent = ed.label;
      lb.style.left = mid.x + "px";
      lb.style.top = mid.y + "px";
      lane.appendChild(lb);
    }
  });
}
function drawAll() {
  // resize da janela e troca de tema disparam isso o tempo todo, inclusive
  // em telas do app que não são o Fluxo de Processos — se a seção nunca foi
  // aberta (ROOT ainda não montado), não há nada pra desenhar.
  if (!ROOT) return;
  // --df-vw (largura) e --df-vw-inicio (margin-left) precisam ser atualizados
  // ANTES de tudo: controlam a largura "full bleed" do diagrama (regra
  // .df-lane-fit). Calculados por MEDIÇÃO real, não por %: a página tem uma
  // sidebar fixa (assimétrica -- só do lado esquerdo), então o truque
  // genérico de breakout (margin-left:calc(50% - vw/2), que assume a página
  // inteira simetricamente centralizada) sobrava sidebar de um lado sem
  // nada do outro e descentralizava o diagrama (bug relatado). .df-wrap não
  // tem nenhum ajuste de posição nele mesmo, então serve de referência
  // estável pra achar onde .df-lane-fit cairia SEM margin nenhum.
  const wrap = ROOT.querySelector(".df-wrap");
  if (wrap) {
    const wrapRect = wrap.getBoundingClientRect();
    const wrapPadLeft = parseFloat(getComputedStyle(wrap).paddingLeft) || 0;
    const naturalLeft = wrapRect.left + wrapPadLeft; // onde .df-lane-fit cairia com margin-left:0
    const conteudo = document.querySelector(".conteudo");
    const cRect = conteudo ? conteudo.getBoundingClientRect() : wrapRect;
    const cPadLeft = conteudo ? parseFloat(getComputedStyle(conteudo).paddingLeft) || 0 : 0;
    const desiredLeft = cRect.left + cPadLeft; // mesmo x onde o resto do texto da página começa
    ROOT.style.setProperty("--df-vw", (window.innerWidth - desiredLeft) + "px");
    ROOT.style.setProperty("--df-vw-inicio", (desiredLeft - naturalLeft) + "px");
  }
  // fitAll() ANTES de drawLane() — de propósito, na ordem inversa da versão
  // anterior. fitAll() mede o tamanho NATURAL (zoom solto) e já aplica o zoom
  // de ajuste final; só DEPOIS disso as linhas são desenhadas, lendo a
  // posição REAL das caixas na tela (getBoundingClientRect no estado final),
  // não uma predição de "zoom escala tudo uniformemente". Essa predição
  // quebra quando .df-lane é esticado por min-width:100% (uma fase cabe
  // sozinha, mas o conjunto da lane inteira não): o zoom recalcula o
  // min-width contra o container, e a largura pós-zoom da lane NÃO é
  // simplesmente largura-natural × zoom — confirmado com medição real via
  // getScreenCTM(): o traçado ficava a ~300px de onde a caixa realmente
  // estava (bug relatado como "linhas bagunçadas, nada centralizado").
  // Medir DEPOIS do zoom aplicado elimina a predição: não importa o que o
  // zoom faz por baixo dos panos, a linha sempre acerta onde a caixa
  // REALMENTE está, porque lê a mesma verdade que os olhos veem.
  fitAll();
  void ROOT.offsetHeight; // força o reflow assentar antes de medir (ver comentário acima)
  Array.prototype.slice.call(ROOT.querySelectorAll(".df-lane")).forEach(drawLane);
}
let _raf = null;
function scheduleDraw() {
  if (_raf) cancelAnimationFrame(_raf);
  _raf = requestAnimationFrame(drawAll);
}

/* ---------- ajuste automático à tela (herdado do artifact aprovado) ---------- */
// Piso do zoom automático. Antes 0.58: o diagrama real (com bifurcações
// paralelas) já precisa de MUITO menos que isso pra caber sem rolagem
// horizontal (medido: ~0.12 pra caber inteiro) — ou seja, mesmo em 0.58 a
// maior parte da largura já dependia do "arraste pro lado" pra ser vista.
// Subido pra 0.85 a pedido da operação: preferem rolar mais pra ver os
// desvios/bifurcações do que ter etapas/losangos pequenos demais pra ler
// sem dar zoom no PRÓPRIO NAVEGADOR. Esse piso é POR LANE (cada "Fluxo
// principal"/"Fluxo de Reversa" tem seu próprio, calculado a partir da
// linha mais larga dela) — subir o número não quebra nada de layout, só
// muda quanto do desenho cabe sem precisar arrastar.
const FIT_MIN = 0.85;
function zoomOff() { ROOT.querySelectorAll(".df-lane").forEach(function (l) { l.style.zoom = ""; }); }
function fitAll() {
  const lanes = Array.prototype.slice.call(ROOT.querySelectorAll(".df-lane"));
  if (!lanes.length) return;
  // --df-vw já foi atualizado em drawAll(), antes do desenho das linhas —
  // não repetir aqui (ver comentário em drawAll).
  zoomOff();
  const host = lanes[0].parentNode, cs = getComputedStyle(host);
  const avail = host.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight);
  let natural = 0;
  lanes.forEach(function (l) { natural = Math.max(natural, l.scrollWidth); });
  let s = 1;
  if (natural > avail + 1) s = Math.max(FIT_MIN, avail / natural);
  s = Math.floor(s * 1000) / 1000;
  if (s < 1) lanes.forEach(function (l) { l.style.zoom = String(s); });
  const pct = Math.round(s * 100);
  const badge = document.getElementById("df-v-fit"); if (badge) badge.textContent = pct + "%";
  const note = document.getElementById("df-tp-fitnote"); if (note) note.hidden = s === 1;
  const scrollable = natural * s > avail + 2;
  ROOT.querySelectorAll(".df-drag-hint").forEach(function (h) { h.style.display = scrollable ? "flex" : "none"; });
}
window.addEventListener("resize", scheduleDraw);
if (document.fonts && document.fonts.ready) document.fonts.ready.then(scheduleDraw);
// segue o tema do app (botão "Tema" na topbar, atributo data-tema no <html>) —
// a cor muda sozinha via CSS var, mas os traçados SVG e o zoom de ajuste
// precisam de um redesenho para recalcular contra o novo layout.
new MutationObserver(scheduleDraw).observe(document.documentElement, { attributes: true, attributeFilter: ["data-tema"] });
// ResizeObserver no <html>: pega qualquer mudança de largura DISPONÍVEL que
// não é "resize" da janela — a mais comum é a barra de rolagem vertical
// aparecer/sumir conforme o conteúdo da página cresce (ex.: o subtítulo
// "Última atualização" que só chega depois do fetch do snapshot, ou o menu
// lateral). document.documentElement.clientWidth muda nesses casos, mas
// window não dispara "resize" — e --df-vw só é reescrito num redesenho, então
// sem isto o traçado das linhas ficava medido contra uma largura que já não
// era mais a real, deixando o SVG desalinhado das caixas (bug relatado:
// "linhas bagunçadas, nada centralizado" — reproduzido e confirmado por
// medição: o path da linha ficava a ~300px de onde a caixa realmente estava).
if (window.ResizeObserver) new ResizeObserver(scheduleDraw).observe(document.documentElement);

/* ============================================================
   MODO EDIÇÃO — só existe a capacidade para admin (isAdmin()); mesmo admin
   começa em modo leitura, igual todo mundo, e liga o "Editar fluxo" quando
   quiser. Ninguém edita sem querer só por ter a permissão.
   ============================================================ */
let EDIT_MODE = false;
function setEditMode(v) {
  EDIT_MODE = !!v && isAdmin();
  const btn = document.getElementById("df-editbtn");
  if (btn) btn.classList.toggle("df-on", EDIT_MODE);
  const bar = document.getElementById("df-editbar");
  if (bar) bar.hidden = !EDIT_MODE;
  ROOT.classList.toggle("df-editando", EDIT_MODE);
  atualizarEdicaoArmazens();
  scheduleDraw();
}

/* ============================================================
   DIÁLOGO DE DETALHE (modo leitura — igual para todo mundo)
   ============================================================ */
function respHtml(resp) {
  if (!resp) return "<i>em branco na planilha</i>";
  if (resp.indexOf("/") > -1) return esc(resp.split("/").map(function (s) { return s.trim(); }).join(" → "));
  return esc(resp);
}
function armazemNota(d) {
  const naOrig = d.orig === "—", naDest = d.dest === "—";
  if (naOrig && naDest) return "Não movimenta estoque nesta etapa.";
  if (naOrig && !naDest) return "O material passa a existir no " + esc(d.dest) + " nesta etapa — não é uma transferência de outro lugar.";
  if (!naOrig && naDest) return "Sai da posição em " + esc(d.orig) + "; nenhum novo armazém de destino é registrado nesta etapa.";
  return "";
}
function openDetail(fase, n) {
  const key = nodeKey(fase, n), d = DADOS.nos[key];
  if (!d) return;
  let html =
    '<p class="df-dg-kick">Etapa ' + esc(d.n) + '</p><h3 class="df-dg-h">' + esc(d.nome) + "</h3>" +
    '<span class="df-dg-chip t-' + esc(d.tipo) + '">' + esc(TIPO_LBL[d.tipo] || d.tipo) + "</span>";
  if (d.n_orig) {
    html += '<div class="df-dg-sec"><b>Número na planilha original</b><p>' + esc(d.n_orig) + "</p></div>";
  }
  if (d.nome !== d.nome_orig) {
    html += '<div class="df-dg-sec"><b>Nome na planilha</b><p>' + esc(d.nome_orig) + "</p></div>";
  }
  html += '<div class="df-dg-sec"><b>Resumo</b><p>' + esc(d.resumo) + "</p></div>";
  if (d.marco) html += '<div class="df-dg-sec df-dg-marco"><b>Por que essa etapa importa</b><p>' + esc(d.marco) + "</p></div>";
  if (d.loop) html += '<div class="df-dg-sec df-dg-loop"><b>Volta ao fluxo</b><p>' + esc(d.loop) + "</p></div>";
  if (d.nota) html += '<div class="df-dg-sec df-dg-alert"><b>Observação</b><p>' + esc(d.nota) + "</p></div>";
  const nota = armazemNota(d);
  html += '<div class="df-dg-sec"><dl class="df-dg-meta">' +
    "<div><dt>Responsável</dt><dd>" + respHtml(d.resp) + "</dd></div>" +
    "<div><dt>Armazém</dt><dd>" + esc(d.orig) + " → " + esc(d.dest) + "</dd></div></dl>" +
    (nota ? '<p class="df-dg-handoff">' + nota + "</p>" : "") + "</div>";
  if (d.resp && d.resp.indexOf("/") > -1) {
    html += '<p class="df-dg-handoff">Mais de uma área envolvida, em sequência — cada uma assume a ' +
      "etapa e passa adiante (handoff), não é responsabilidade simultânea.</p>";
  }
  html += '<div class="df-dg-sec df-dg-orig"><b>Texto original validado pela área</b>' +
    "<blockquote>" + esc(d.original) + "</blockquote></div>";
  if (isAdmin()) {
    html += '<div class="df-dg-sec"><button type="button" class="df-btn df-btn-gold" id="df-dlg-editar">' +
      "✏️ Editar esta etapa</button></div>";
  }
  const body = document.getElementById("df-dlgbody");
  body.innerHTML = html;
  const editBtn = document.getElementById("df-dlg-editar");
  if (editBtn) editBtn.addEventListener("click", function () {
    document.getElementById("df-dlg").close();
    if (!EDIT_MODE) setEditMode(true);
    abrirPainelNo(fase, n);
  });
  document.getElementById("df-dlg").showModal();
}

/* ============================================================
   BUSCA
   ============================================================ */
function wireSearch() {
  const q = document.getElementById("df-q"), qhint = document.getElementById("df-qhint");
  if (!q) return;
  // matches/idx: a lista de etapas batidas pela busca ATUAL e qual delas o
  // Enter vai visitar da próxima vez — Enter repetido cicla pelas seguintes,
  // voltando pro início depois da última (busca de verdade, não só filtro).
  let matches = [], idx = 0;
  q.addEventListener("input", function () {
    const t = q.value.trim().toLowerCase();
    matches = []; idx = 0;
    ROOT.querySelectorAll(".df-step[data-n]").forEach(function (b) {
      const key = nodeKey(b.getAttribute("data-fase"), b.getAttribute("data-n")), d = DADOS.nos[key];
      if (!d) return;
      const hay = (d.n + " " + d.nome + " " + d.nome_orig + " " + d.resp).toLowerCase();
      const hit = t && hay.indexOf(t) > -1;
      b.classList.toggle("df-hit", hit);
      b.classList.toggle("df-dim", !!t && !hit);
      if (hit) matches.push(b);
    });
    const n = matches.length;
    qhint.textContent = t ? n + " etapa" + (n === 1 ? "" : "s") + " encontrada" + (n === 1 ? "" : "s") : "";
  });
  // Enter leva até a etapa: sem isso, achar 1 resultado num fluxo de 60+
  // etapas ainda obrigava a rolar a página inteira até achar o retângulo com
  // o contorno dourado. scrollIntoView cuida sozinho de qualquer combinação
  // de scroll (rolagem vertical da página + rolagem horizontal interna do
  // diagrama em .df-lane-fit), então funciona igual não importa o zoom
  // automático nem quantas fases tem antes da etapa buscada.
  q.addEventListener("keydown", function (e) {
    if (e.key !== "Enter" || !matches.length) return;
    e.preventDefault();
    const alvo = matches[idx % matches.length];
    idx = (idx + 1) % matches.length;
    alvo.scrollIntoView({ behavior: "smooth", block: "center", inline: "center" });
    // pulso mais forte só na etapa visitada agora, pra diferenciar de "achei
    // 5, essa é a que você tá vendo" quando há mais de um resultado.
    alvo.classList.remove("df-hit-atual");
    void alvo.offsetWidth; // reinicia a animação se o Enter for apertado de novo na mesma etapa
    alvo.classList.add("df-hit-atual");
  });
}

/* ============================================================
   PAINEL DE AJUSTE DE LAYOUT (self-service — ver conversa com o usuário:
   "tem alguma forma de eu mesmo editar sem gastar sua memória?")
   ============================================================ */
const TUNE_DEFAULT = { lane: 46, bx: 130, cy: 46, bw: 222, bh: 54, dia: 210 };
const TUNE_VARS = { lane: "--df-gap-lane", bx: "--df-gap-branch-x", cy: "--df-gap-chain-y",
  bw: "--df-box-w", bh: "--df-box-h", dia: "--df-dia-size" };
function wireTune() {
  const tuneBtn = document.getElementById("df-tunebtn"), tunePanel = document.getElementById("df-tunepanel"),
    tuneClose = document.getElementById("df-tp-close"), tuneReset = document.getElementById("df-tp-reset");
  if (!tuneBtn) return;
  let tuneVals = {};
  try { tuneVals = JSON.parse(localStorage.getItem("ecom-flow-tune") || "{}"); } catch (e) { tuneVals = {}; }
  function applyTune(k, v) {
    const sl = document.getElementById("df-s-" + k);
    if (sl) v = Math.min(parseInt(sl.max, 10), Math.max(parseInt(sl.min, 10), v));
    ROOT.style.setProperty(TUNE_VARS[k], v + "px");
    const el = document.getElementById("df-v-" + k); if (el) el.textContent = v + "px";
    if (sl) sl.value = v;
    return v;
  }
  Object.keys(TUNE_DEFAULT).forEach(function (k) {
    const v = applyTune(k, tuneVals[k] != null ? tuneVals[k] : TUNE_DEFAULT[k]);
    if (tuneVals[k] != null) tuneVals[k] = v;
  });
  function saveTune() { try { localStorage.setItem("ecom-flow-tune", JSON.stringify(tuneVals)); } catch (e) {} }
  Object.keys(TUNE_DEFAULT).forEach(function (k) {
    const sl = document.getElementById("df-s-" + k);
    sl.addEventListener("input", function () {
      const v = parseInt(sl.value, 10);
      tuneVals[k] = v; applyTune(k, v); saveTune(); scheduleDraw();
    });
  });
  tuneBtn.addEventListener("click", function () { tunePanel.hidden = !tunePanel.hidden; });
  tuneClose.addEventListener("click", function () { tunePanel.hidden = true; });
  tuneReset.addEventListener("click", function () {
    tuneVals = {}; saveTune();
    Object.keys(TUNE_DEFAULT).forEach(function (k) { applyTune(k, TUNE_DEFAULT[k]); });
    scheduleDraw();
  });
}

/* ============================================================
   MOTOR DE NUMERAÇÃO — só entra em ação quando o Admin insere/exclui um
   bloco. Não tenta reproduzir o julgamento caso a caso que gerou a
   numeração hoje aprovada (isso não é uma função pura da posição — dois
   losangos parecidos no dado atual usam critérios diferentes, um por
   "olhar pra trás", outro por "olhar pra frente", decisão de conteúdo, não
   de estrutura). Em vez disso, aplica UMA regra simples e previsível daqui
   pra frente, sempre com raio de ação limitado à vizinhança tocada — nunca
   renumera nada fora do que a edição realmente afeta — e sempre mostra o
   número sugerido num campo editável antes de confirmar.
   Regra: inteiro = sempre em sequência, sem pular (nodes2.py, cabeçalho).
   Decimal/letra = próximo da família (mesma profundidade do vizinho).
   ============================================================ */
function parseNum(n) {
  const m = /^(\d+)([A-Z]?)((?:\.\d+)*)$/.exec(String(n));
  if (!m) return { int: 0, letter: "", decimals: [] };
  return { int: parseInt(m[1], 10), letter: m[2] || "", decimals: m[3] ? m[3].slice(1).split(".").map(Number) : [] };
}
function fmtNum(p) { return String(p.int) + p.letter + (p.decimals.length ? "." + p.decimals.join(".") : ""); }

function acharFase(faseId) {
  for (const lane of DADOS.lanes) for (const f of lane.fases) if (f.id === faseId) return f;
  return null;
}
/* move (ou cria) a entrada em DADOS.nos quando o número de um bloco muda */
function renomearNo(faseId, nAntigo, nNovo) {
  if (nAntigo === nNovo) return;
  const kOld = nodeKey(faseId, nAntigo), kNew = nodeKey(faseId, nNovo);
  const d = DADOS.nos[kOld];
  if (d) { d.n = nNovo; DADOS.nos[kNew] = d; delete DADOS.nos[kOld]; }
}
function trunkPeekBehind(blocos, blocoIdx) {
  for (let i = blocoIdx - 1; i >= 0; i--) {
    const b = blocos[i];
    if (b[0] === "step" || b[0] === "gate") return parseNum(b[1]).int;
  }
  return 0;
}
function forkBranchLetter(idx) { return String.fromCharCode(65 + idx); } // 0->A, 1->B, 2->C...

/* desloca (+1) os inteiros do tronco a partir de `apartir` (inclusive),
   e ajusta em cascata o prefixo de toda cadeia guard/fork que citava esse
   inteiro — bloqueado ao que essa fase realmente contém, nada fora dela. */
function deslocarTroncoApartirDe(fObj, apartir) {
  // 1) descobre quem muda (+1 no inteiro) — só quem já tem inteiro >= apartir
  const mapa = {}; // inteiro antigo -> inteiro novo
  fObj.blocos.forEach(function (b) {
    if (b[0] === "step" || b[0] === "gate") {
      const p = parseNum(b[1]);
      if (p.int >= apartir) mapa[p.int] = p.int + 1;
    }
  });
  const antigos = Object.keys(mapa).map(Number).sort(function (a, b) { return b - a; });
  // 2) renomeia os steps/gates do tronco, do maior inteiro pro menor — assim
  //    nunca sobrescreve em DADOS.nos um número que ainda vai ser lido
  antigos.forEach(function (velho) {
    fObj.blocos.forEach(function (b) {
      if ((b[0] === "step" || b[0] === "gate") && parseNum(b[1]).int === velho) {
        const p = parseNum(b[1]), novoStr = fmtNum(Object.assign({}, p, { int: mapa[velho] }));
        renomearNo(fObj.id, b[1], novoStr);
        b[1] = novoStr;
      }
    });
  });
  // 3) reescreve o prefixo de toda cadeia (guard/fork) que citava um desses
  //    inteiros — mesma ordem decrescente, mesmo motivo
  function ajustaLista(lista) {
    antigos.forEach(function (velho) {
      lista.forEach(function (n, i) {
        const p = parseNum(n);
        if (p.int === velho) {
          const novo = fmtNum(Object.assign({}, p, { int: mapa[velho] }));
          renomearNo(fObj.id, n, novo);
          lista[i] = novo;
        }
      });
    });
  }
  fObj.blocos.forEach(function (b) {
    if (b[0] === "guard") ajustaLista(b[2]);
    else if (b[0] === "fork") b[2].forEach(function (br) { ajustaLista(br[1]); });
  });
}

/* insere um novo bloco de tronco (step) na posição blocoIdx da fase — ou no
   fim, se blocoIdx === blocos.length. Devolve o número atribuído. */
function inserirEtapaTronco(faseId, blocoIdx) {
  const fObj = acharFase(faseId);
  const alvo = fObj.blocos[blocoIdx];
  let novoN;
  if (alvo) {
    const nums = [];
    fObj.blocos.forEach(function (b) { if (b[0] === "step" || b[0] === "gate") nums.push(parseNum(b[1]).int); });
    const alvoInt = (function () {
      for (let i = blocoIdx; i < fObj.blocos.length; i++) {
        const b = fObj.blocos[i];
        if (b[0] === "step" || b[0] === "gate") return parseNum(b[1]).int;
      }
      return (nums.length ? Math.max.apply(null, nums) : 0) + 1;
    })();
    deslocarTroncoApartirDe(fObj, alvoInt);
    novoN = String(alvoInt);
  } else {
    const nums = [];
    fObj.blocos.forEach(function (b) { if (b[0] === "step" || b[0] === "gate") nums.push(parseNum(b[1]).int); });
    novoN = String((nums.length ? Math.max.apply(null, nums) : 0) + 1);
  }
  fObj.blocos.splice(blocoIdx, 0, ["step", novoN]);
  return novoN;
}

/* insere um novo item numa cadeia (nExc de um guard, ou uma lista de ramo de
   fork), na posição atPos — ou no fim, se atPos === lista.length. */
function proximoNaFamilia(prevStr, parentBase) {
  if (!prevStr) return parentBase.int + (parentBase.letter || "") + ".1";
  const p = parseNum(prevStr);
  const dec = p.decimals.length ? p.decimals.slice() : [0];
  dec[dec.length - 1] += 1;
  return fmtNum({ int: p.int, letter: p.letter, decimals: dec });
}
function inserirNaCadeia(lista, atPos, faseId, parentBase) {
  const antecessor = atPos > 0 ? lista[atPos - 1] : null;
  for (let i = lista.length - 1; i >= atPos; i--) {
    const p = parseNum(lista[i]);
    const dec = p.decimals.length ? p.decimals.slice() : [0];
    dec[dec.length - 1] += 1;
    const novo = fmtNum({ int: p.int, letter: p.letter, decimals: dec });
    renomearNo(faseId, lista[i], novo);
    lista[i] = novo;
  }
  const novoN = proximoNaFamilia(antecessor, parentBase);
  lista.splice(atPos, 0, novoN);
  return novoN;
}

/* acha em qual lista (tronco da fase, cadeia de um guard, ou ramo de um fork)
   um número mora hoje — usado tanto por excluirNo() quanto pelos painéis. */
function localizarBloco(fase, n) {
  const fObj = acharFase(fase);
  if (!fObj) return null;
  for (let i = 0; i < fObj.blocos.length; i++) {
    const b = fObj.blocos[i];
    if ((b[0] === "step" || b[0] === "gate") && b[1] === n) return { fObj: fObj, lista: fObj.blocos, idx: i, tipo: "trunk" };
    if (b[0] === "guard") {
      const j = b[2].indexOf(n);
      if (j > -1) return { fObj: fObj, lista: b[2], idx: j, tipo: "chain", bloco: b, blocoIdx: i };
    }
    if (b[0] === "fork") {
      for (let bi = 0; bi < b[2].length; bi++) {
        const j = b[2][bi][1].indexOf(n);
        if (j > -1) return { fObj: fObj, lista: b[2][bi][1], idx: j, tipo: "chain", bloco: b, blocoIdx: i, branch: bi };
      }
    }
  }
  return null;
}

/* ============================================================
   MODO ADMIN — inserir/editar/excluir blocos, setores, nova fase, salvar.
   Tudo aqui só roda com isAdmin() && EDIT_MODE; a proteção que importa de
   verdade é a RLS `gravar_snapshots` (só admin) — isto é conveniência de
   interface, não a trava real.
   ============================================================ */
const TIPO_NOVO = {
  etapa: { tipo: "principal", rotulo: "Nova etapa padrão" },
  quebra: { tipo: "desvio", subtipo: "quebra", rotulo: "Nova quebra" },
  bo: { tipo: "desvio", subtipo: "bo", rotulo: "Novo B.O." },
};
function marcarEditado() {
  EDITADO = true;
  const bar = document.getElementById("df-editbar");
  if (bar) bar.classList.add("df-tem-mudanca");
  const salvarBtn = document.getElementById("df-btn-salvar");
  if (salvarBtn) salvarBtn.disabled = false;
}
function criarNoVazio(fase, n, escolha) {
  const t = TIPO_NOVO[escolha] || TIPO_NOVO.etapa;
  DADOS.nos[nodeKey(fase, n)] = {
    n: n, n_orig: null, novo: true, extraido_de: null, fase: fase,
    nome: "Nova etapa", nome_orig: "Nova etapa", tipo: t.tipo, subtipo: t.subtipo || null,
    resp: "", orig: "—", dest: "—", resumo: "", original: "",
    marco: "", loop: "", nota: "", terminal: false, icone: ICONE_PADRAO,
  };
}
function criarBloco(meta, escolha) {
  if (!isAdmin() || !EDIT_MODE) return;
  let novoN;
  if (meta.kind === "trunk") {
    novoN = inserirEtapaTronco(meta.fase, meta.blocoIdx);
  } else {
    const fObj = acharFase(meta.fase);
    const bloco = fObj.blocos[meta.blocoIdx];
    let lista, parentBase;
    if (meta.chainKind === "guard") {
      lista = bloco[2];
      parentBase = { int: trunkPeekBehind(fObj.blocos, meta.blocoIdx), letter: "" };
    } else {
      lista = bloco[2][meta.branch][1];
      parentBase = { int: trunkPeekBehind(fObj.blocos, meta.blocoIdx), letter: forkBranchLetter(meta.branch) };
    }
    novoN = inserirNaCadeia(lista, meta.atPos, meta.fase, parentBase);
  }
  criarNoVazio(meta.fase, novoN, escolha);
  marcarEditado();
  renderTudo();
  abrirPainelNo(meta.fase, novoN, true);
}
function excluirNo(fase, n) {
  const loc = localizarBloco(fase, n);
  if (!loc) return;
  if (!confirm('Excluir a etapa "' + n + '"? Isso não pode ser desfeito nesta sessão (mas nada é perdido de ' +
    "verdade — toda versão salva anteriormente continua no histórico do banco).")) return;
  loc.lista.splice(loc.idx, 1);
  delete DADOS.nos[nodeKey(fase, n)];
  marcarEditado();
  document.getElementById("df-dlg").close();
  renderTudo();
}

/* ---------- menu flutuante (mesmo padrão do dropdown de categoria do armazém) ---------- */
function fecharMenuFlutuante() {
  const m = document.getElementById("df-edge-menu");
  if (m) m.remove();
}
function mostrarMenuFlutuante(x, y, opcoes, onEscolher) {
  fecharMenuFlutuante();
  const m = document.createElement("div");
  m.id = "df-edge-menu";
  m.className = "df-edge-menu";
  m.innerHTML = opcoes.map(function (o) {
    return '<button type="button" class="df-edge-opt" data-v="' + esc(o[0]) + '">' + esc(o[1]) + "</button>";
  }).join("");
  // some dentro de #dfRoot, não do body: é lá que as variáveis de cor
  // (--df-card, --df-bd...) existem — teto do body não herda nada delas.
  ROOT.appendChild(m);
  const mw = m.offsetWidth, mh = m.offsetHeight;
  let left = Math.min(x, window.innerWidth - mw - 8), top = Math.min(y, window.innerHeight - mh - 8);
  m.style.left = Math.max(8, left) + "px";
  m.style.top = Math.max(8, top) + "px";
  m.querySelectorAll(".df-edge-opt").forEach(function (b) {
    b.addEventListener("click", function () { fecharMenuFlutuante(); onEscolher(b.getAttribute("data-v")); });
  });
  setTimeout(function () {
    document.addEventListener("click", fecharMenuFlutuante, { once: true });
  }, 0);
}
function onEdgeClick(e) {
  if (!EDIT_MODE) return;
  e.stopPropagation();
  let meta = null;
  try { meta = JSON.parse(e.target.dataset.meta || "null"); } catch (err) { meta = null; }
  if (!meta) return;
  const opcoes = [["etapa", "Nova etapa padrão"]];
  // Quebra/B.O. só fazem sentido numa cadeia de DESVIO (guard) — um ramo de
  // bifurcação (fork) é um caminho igualmente correto, não um desvio.
  if (meta.kind === "chain" && meta.chainKind === "guard") {
    opcoes.push(["quebra", "Nova quebra"], ["bo", "Novo B.O."]);
  }
  mostrarMenuFlutuante(e.clientX, e.clientY, opcoes, function (escolha) { criarBloco(meta, escolha); });
}

/* ---------- painel de edição de uma etapa (retângulo) ---------- */
function campoInput(label, id, valor, opts) {
  opts = opts || {};
  return '<label class="df-campo"><span>' + esc(label) + '</span><input type="text" id="' + id +
    '" value="' + esc(valor) + '"' +
    (opts.placeholder ? ' placeholder="' + esc(opts.placeholder) + '"' : "") +
    (opts.list ? ' list="' + opts.list + '"' : "") + "></label>";
}
function campoArea(label, id, valor, rows) {
  return '<label class="df-campo"><span>' + esc(label) + '</span><textarea id="' + id + '" rows="' +
    (rows || 3) + '">' + esc(valor) + "</textarea></label>";
}
function campoCheckbox(label, id, marcado) {
  return '<label class="df-campo df-campo-check"><input type="checkbox" id="' + id + '"' +
    (marcado ? " checked" : "") + "><span>" + esc(label) + "</span></label>";
}
function listaSetoresDatalist() {
  return '<datalist id="df-dl-setores">' +
    (DADOS.setores || []).map(function (s) { return '<option value="' + esc(s) + '">'; }).join("") +
    "</datalist>";
}
function iconePickerHtml(atual) {
  return '<div class="df-icon-picker" id="df-icon-picker">' +
    Object.keys(ICONS).map(function (k) {
      return '<button type="button" class="df-icon-opt' + (k === atual ? " df-on" : "") + '" data-ic="' + k +
        '" title="' + k + '">' + svgIcon(k) + "</button>";
    }).join("") + "</div>";
}
function abrirPainelNo(fase, n, ehNovo) {
  const key = nodeKey(fase, n), d = DADOS.nos[key];
  if (!d) return;
  const html =
    '<p class="df-dg-kick">Editando etapa ' + esc(n) + (ehNovo ? " — nova" : "") + '</p>' +
    listaSetoresDatalist() +
    campoInput("Nome (resumo padronizado)", "df-f-nome", d.nome) +
    campoArea("Resumo", "df-f-resumo", d.resumo, 3) +
    campoArea("Texto original validado pela área", "df-f-original", d.original, 3) +
    campoInput("Responsável(is) — separe com \"/\" quando houver mais de uma área em sequência",
      "df-f-resp", d.resp, { list: "df-dl-setores", placeholder: "ex.: Comercial/Planejamento/Coleta" }) +
    '<div class="df-campo-lado-a-lado">' +
    campoInput("Armazém origem", "df-f-orig", d.orig, { placeholder: "— se não movimenta" }) +
    campoInput("Armazém destino", "df-f-dest", d.dest, { placeholder: "— se não movimenta" }) +
    "</div>" +
    '<label class="df-campo"><span>Tipo</span><select id="df-f-tipo">' +
    ["principal", "desvio", "bifurcacao", "gate"].map(function (t) {
      return '<option value="' + t + '"' + (t === d.tipo ? " selected" : "") + ">" + esc(TIPO_LBL[t]) + "</option>";
    }).join("") + "</select></label>" +
    campoArea("Observação (opcional)", "df-f-nota", d.nota, 2) +
    campoInput("Marco do processo (opcional — por que esta etapa importa)", "df-f-marco", d.marco) +
    campoInput("Reinjeta no ciclo (opcional — pra onde volta)", "df-f-loop", d.loop) +
    "<p class=\"df-dg-sec\"><b>Ícone</b></p>" + iconePickerHtml(d.icone) +
    '<div class="df-painel-acoes">' +
    '<button type="button" class="df-btn df-btn-danger" id="df-btn-excluir-no">Excluir esta etapa</button>' +
    '<span class="df-flex1"></span>' +
    '<button type="button" class="df-btn" id="df-btn-cancelar-no">Cancelar</button>' +
    '<button type="button" class="df-btn df-btn-gold" id="df-btn-salvar-no">Salvar etapa</button>' +
    "</div>";
  const body = document.getElementById("df-dlgbody");
  body.innerHTML = html;
  let iconeEscolhido = d.icone;
  body.querySelectorAll(".df-icon-opt").forEach(function (b) {
    b.addEventListener("click", function () {
      body.querySelectorAll(".df-icon-opt").forEach(function (x) { x.classList.remove("df-on"); });
      b.classList.add("df-on");
      iconeEscolhido = b.getAttribute("data-ic");
    });
  });
  document.getElementById("df-btn-excluir-no").addEventListener("click", function () { excluirNo(fase, n); });
  document.getElementById("df-btn-cancelar-no").addEventListener("click", function () {
    document.getElementById("df-dlg").close();
    if (ehNovo) excluirNo(fase, n); // etapa recém-criada, cancelada antes de preencher: desfaz a inserção
  });
  document.getElementById("df-btn-salvar-no").addEventListener("click", function () {
    const g = function (id) { return document.getElementById(id).value.trim(); };
    d.nome = g("df-f-nome") || "Nova etapa";
    d.nome_orig = ehNovo ? d.nome : d.nome_orig;
    d.resumo = g("df-f-resumo");
    d.original = g("df-f-original");
    d.resp = g("df-f-resp");
    d.orig = g("df-f-orig") || "—";
    d.dest = g("df-f-dest") || "—";
    d.tipo = document.getElementById("df-f-tipo").value;
    d.nota = g("df-f-nota");
    d.marco = g("df-f-marco");
    d.loop = g("df-f-loop");
    d.icone = iconeEscolhido;
    marcarEditado();
    document.getElementById("df-dlg").close();
    renderTudo();
  });
  document.getElementById("df-dlg").showModal();
}

/* ---------- painel de edição de um losango (guard ou fork) ---------- */
function abrirPainelGuard(fase, blocoIdx) {
  const fObj = acharFase(fase), b = fObj.blocos[blocoIdx];
  const opts = b[3] || {};
  const html =
    '<p class="df-dg-kick">Editando decisão</p>' +
    campoArea("Pergunta", "df-f-pergunta", b[1], 2) +
    '<div class="df-campo-lado-a-lado">' +
    campoInput("Resposta que leva ao desvio/B.O.", "df-f-exc", opts.exc || "Sim") +
    campoInput("Resposta correta", "df-f-ok", opts.ok || "Não") +
    "</div>" +
    campoCheckbox("A cadeia volta ao tronco depois do último item (senão termina em \"Fim deste caminho\")",
      "df-f-rejoin", !!opts.rejoin) +
    campoCheckbox("Os itens são motivos alternativos (\"ou\"), não uma sequência", "df-f-parallel", !!opts.parallel) +
    '<p class="df-dg-handoff">Para adicionar, editar ou excluir os itens desta cadeia, use as próprias etapas ' +
    "e setas dela no diagrama — este painel só edita a pergunta e o comportamento do losango.</p>" +
    '<div class="df-painel-acoes"><span class="df-flex1"></span>' +
    '<button type="button" class="df-btn" id="df-btn-cancelar-g">Cancelar</button>' +
    '<button type="button" class="df-btn df-btn-gold" id="df-btn-salvar-g">Salvar</button></div>';
  document.getElementById("df-dlgbody").innerHTML = html;
  document.getElementById("df-btn-cancelar-g").addEventListener("click", function () { document.getElementById("df-dlg").close(); });
  document.getElementById("df-btn-salvar-g").addEventListener("click", function () {
    b[1] = document.getElementById("df-f-pergunta").value.trim();
    b[3] = {
      rejoin: document.getElementById("df-f-rejoin").checked,
      parallel: document.getElementById("df-f-parallel").checked,
      exc: document.getElementById("df-f-exc").value.trim() || "Sim",
      ok: document.getElementById("df-f-ok").value.trim() || "Não",
    };
    marcarEditado();
    document.getElementById("df-dlg").close();
    renderTudo();
  });
  document.getElementById("df-dlg").showModal();
}
function abrirPainelFork(fase, blocoIdx) {
  const fObj = acharFase(fase), b = fObj.blocos[blocoIdx];
  const branches = b[2];
  const html =
    '<p class="df-dg-kick">Editando bifurcação</p>' +
    campoArea("Pergunta", "df-f-pergunta", b[1], 2) +
    branches.map(function (br, i) {
      return campoInput("Rótulo do ramo " + forkBranchLetter(i), "df-f-branch-" + i, br[0]);
    }).join("") +
    '<p class="df-dg-handoff">Para adicionar, editar ou excluir etapas de um ramo, use as próprias etapas e ' +
    "setas dele no diagrama — este painel só edita a pergunta e os rótulos dos ramos.</p>" +
    '<div class="df-painel-acoes"><span class="df-flex1"></span>' +
    '<button type="button" class="df-btn" id="df-btn-cancelar-f">Cancelar</button>' +
    '<button type="button" class="df-btn df-btn-gold" id="df-btn-salvar-f">Salvar</button></div>';
  document.getElementById("df-dlgbody").innerHTML = html;
  document.getElementById("df-btn-cancelar-f").addEventListener("click", function () { document.getElementById("df-dlg").close(); });
  document.getElementById("df-btn-salvar-f").addEventListener("click", function () {
    b[1] = document.getElementById("df-f-pergunta").value.trim();
    branches.forEach(function (br, i) {
      br[0] = document.getElementById("df-f-branch-" + i).value.trim() || br[0];
    });
    marcarEditado();
    document.getElementById("df-dlg").close();
    renderTudo();
  });
  document.getElementById("df-dlg").showModal();
}

/* ---------- cadastro de setores (responsáveis) ---------- */
function abrirPainelSetores() {
  function linhas() {
    return (DADOS.setores || []).map(function (s, i) {
      return '<li><span>' + esc(s) + '</span><button type="button" class="df-btn-x" data-i="' + i + '">✕</button></li>';
    }).join("");
  }
  const html =
    '<p class="df-dg-kick">Cadastro de setores</p>' +
    '<p class="df-dg-handoff">Alimenta o autocomplete do campo Responsável ao editar uma etapa — o campo ' +
    "continua aceitando texto livre e composto (\"A/B/C\") mesmo sem estar aqui.</p>" +
    '<ul class="df-lista-setores" id="df-lista-setores">' + linhas() + "</ul>" +
    '<div class="df-campo-lado-a-lado">' +
    '<input type="text" id="df-novo-setor" placeholder="Novo setor…">' +
    '<button type="button" class="df-btn df-btn-gold" id="df-btn-add-setor">Adicionar</button></div>' +
    '<div class="df-painel-acoes"><span class="df-flex1"></span>' +
    '<button type="button" class="df-btn df-btn-gold" id="df-btn-fechar-setores">Fechar</button></div>';
  document.getElementById("df-dlgbody").innerHTML = html;
  function wireRemover() {
    document.querySelectorAll("#df-lista-setores .df-btn-x").forEach(function (b) {
      b.addEventListener("click", function () {
        DADOS.setores.splice(parseInt(b.getAttribute("data-i"), 10), 1);
        marcarEditado();
        document.getElementById("df-lista-setores").innerHTML = linhas();
        wireRemover();
      });
    });
  }
  wireRemover();
  document.getElementById("df-btn-add-setor").addEventListener("click", function () {
    const el = document.getElementById("df-novo-setor"), v = el.value.trim();
    if (!v) return;
    DADOS.setores = DADOS.setores || [];
    if (DADOS.setores.indexOf(v) === -1) { DADOS.setores.push(v); DADOS.setores.sort(); marcarEditado(); }
    el.value = "";
    document.getElementById("df-lista-setores").innerHTML = linhas();
    wireRemover();
  });
  document.getElementById("df-btn-fechar-setores").addEventListener("click", function () {
    document.getElementById("df-dlg").close();
  });
  document.getElementById("df-dlg").showModal();
}

/* ---------- nova fase (anexada ao fim de uma lane existente) ---------- */
function abrirPainelNovaFase() {
  const opcoesLane = DADOS.lanes.map(function (l) {
    return '<option value="' + esc(l.id) + '">' + esc(l.titulo) + "</option>";
  }).join("");
  const html =
    '<p class="df-dg-kick">Nova fase</p>' +
    '<p class="df-dg-handoff">Anexa uma fase nova ao FINAL de uma lane já existente, já nascendo com o ' +
    "Início ligado a ela. Criar uma lane inteiramente nova, ou reordenar fases, não está disponível aqui — " +
    "fale comigo se precisar disso.</p>" +
    '<label class="df-campo"><span>Lane</span><select id="df-f-lane">' + opcoesLane + "</select></label>" +
    campoInput("Nome da fase", "df-f-fase-nome", "") +
    '<div class="df-painel-acoes"><span class="df-flex1"></span>' +
    '<button type="button" class="df-btn" id="df-btn-cancelar-fase">Cancelar</button>' +
    '<button type="button" class="df-btn df-btn-gold" id="df-btn-criar-fase">Criar fase</button></div>';
  document.getElementById("df-dlgbody").innerHTML = html;
  document.getElementById("df-btn-cancelar-fase").addEventListener("click", function () { document.getElementById("df-dlg").close(); });
  document.getElementById("df-btn-criar-fase").addEventListener("click", function () {
    const laneId = document.getElementById("df-f-lane").value;
    const nome = document.getElementById("df-f-fase-nome").value.trim();
    if (!nome) { alert("Dê um nome pra fase antes de criar."); return; }
    const lane = DADOS.lanes.filter(function (l) { return l.id === laneId; })[0];
    if (!lane) return;
    let faseId = "fase" + (Date.now() % 100000);
    const novoN = "1";
    lane.fases.push({ id: faseId, titulo: nome, blocos: [["step", novoN]] });
    DADOS.nos[nodeKey(faseId, novoN)] = {
      n: novoN, n_orig: null, novo: true, extraido_de: null, fase: faseId,
      nome: "Primeira etapa", nome_orig: "Primeira etapa", tipo: "principal", subtipo: null,
      resp: "", orig: "—", dest: "—", resumo: "", original: "",
      marco: "", loop: "", nota: "", terminal: false, icone: ICONE_PADRAO,
    };
    marcarEditado();
    document.getElementById("df-dlg").close();
    renderTudo();
    abrirPainelNo(faseId, novoN, true);
  });
  document.getElementById("df-dlg").showModal();
}

/* ---------- clique nos blocos (delegado — sobrevive a cada renderTudo()) ---------- */
function wireCliquesDelegados() {
  ROOT.addEventListener("click", function (e) {
    const step = e.target.closest(".df-step[data-n]");
    if (step) {
      const fase = step.getAttribute("data-fase"), n = step.getAttribute("data-n");
      if (EDIT_MODE) abrirPainelNo(fase, n); else openDetail(fase, n);
      return;
    }
    const dia = e.target.closest(".df-dia");
    if (dia && EDIT_MODE) {
      const fase = dia.getAttribute("data-fase"), blocoIdx = parseInt(dia.getAttribute("data-bloco"), 10);
      if (dia.getAttribute("data-guardtype") === "guard") abrirPainelGuard(fase, blocoIdx);
      else abrirPainelFork(fase, blocoIdx);
    }
  });
}

/* ---------- barra "Editar fluxo" (só aparece pra admin) ---------- */
function wireEditToggle() {
  const btn = document.getElementById("df-editbtn");
  if (!btn) return;
  btn.addEventListener("click", function () { setEditMode(!EDIT_MODE); });
  const setoresBtn = document.getElementById("df-btn-setores");
  if (setoresBtn) setoresBtn.addEventListener("click", abrirPainelSetores);
  const faseBtn = document.getElementById("df-btn-nova-fase");
  if (faseBtn) faseBtn.addEventListener("click", abrirPainelNovaFase);
  const salvarBtn = document.getElementById("df-btn-salvar");
  if (salvarBtn) salvarBtn.addEventListener("click", salvar);
  const descartarBtn = document.getElementById("df-btn-descartar");
  if (descartarBtn) descartarBtn.addEventListener("click", function () {
    if (!EDITADO || confirm("Descartar todas as alterações não salvas e voltar à última versão publicada?")) {
      carregarDados().then(function (ok) { if (ok) { renderTudo(); setEditMode(true); } });
    }
  });
}

/* ============================================================
   CABEÇALHO (estatísticas) — recalculado a cada renderTudo(), nunca
   hardcoded, porque o admin pode ter acabado de mudar essas contagens.
   ============================================================ */
function atualizarCabecalho() {
  const vals = Object.keys(DADOS.nos).map(function (k) { return DADOS.nos[k]; });
  const cnt = {};
  vals.forEach(function (d) { cnt[d.tipo] = (cnt[d.tipo] || 0) + 1; });
  const nFases = DADOS.lanes.reduce(function (s, l) { return s + l.fases.length; }, 0);
  const set = function (id, v) { const el = document.getElementById(id); if (el) el.textContent = v; };
  set("df-stat-total", vals.length);
  set("df-stat-fases", nFases);
  set("df-stat-normal", (cnt.principal || 0) + (cnt.seq || 0) + (cnt.gate || 0));
  set("df-stat-desvio", cnt.desvio || 0);
  set("df-stat-bif", cnt.bifurcacao || 0);
}

/* ============================================================
   MONTAGEM DO SHELL (equivalente ao HTML f-string de build6.py, agora
   escrito uma vez no mount e depois só recebendo o conteúdo dinâmico das
   lanes via renderTudo()).
   ============================================================ */
// Vocabulário de status pedido pelo usuário (troca completa do que existia
// antes: ativo/ativar/criar). Reaproveita as classes .badge.disp/.bloq/.anal
// já usadas na tela de Estoque, mesmas cores; .pend é novo (ver CSS).
const STAT_ARM = {
  ativo: ["ATIVO", "disp"], bloqueado: ["BLOQUEADO", "bloq"],
  analise: ["EM ANÁLISE", "anal"], pendente: ["PENDENTE", "pend"],
};
// Migração dos valores antigos (dado gravado antes desta mudança de
// vocabulário) pro conjunto novo, só pra exibição — o próximo "Salvar
// alterações" já grava com as chaves novas.
const STAT_ARM_MIGRA = { ativo: "ativo", ativar: "pendente", criar: "pendente" };
function chaveStatusArmazem(a) {
  return STAT_ARM[a.status] ? a.status : (STAT_ARM_MIGRA[a.status] || "pendente");
}
function armazensTableHtml() {
  const campos = ["cod", "uso", "resp", "dono"];
  const rows = (DADOS.armazens || []).map(function (a, i) {
    const stKey = chaveStatusArmazem(a);
    const st = STAT_ARM[stKey];
    // Fora do modo edição, cada campo era um <input> readonly — mas <input>
    // não tem como quebrar linha: texto mais longo que a coluna simplesmente
    // é cortado no meio, sem "..." nem nada indicando que falta texto
    // (relatado: "Utilização" cortando "Vendável — armazém de mate|"). Em
    // leitura vira <span> comum, que quebra linha normal dentro da célula;
    // o <input> real só aparece em modo edição, onde uma linha só é aceitável
    // porque é exatamente o que está sendo digitado ali na hora.
    const inputs = campos.map(function (c) {
      const valor = a[c] || "";
      const classeCod = c === "cod" ? " df-armz-cod" : "";
      return EDIT_MODE
        ? '<td><input class="df-armz-input' + classeCod + '" data-i="' + i + '" data-campo="' + c + '" ' +
          'value="' + esc(valor) + '"></td>'
        : '<td><span class="df-armz-texto' + classeCod + '">' + esc(valor) + '</span></td>';
    }).join("");
    const corPontinho = { disp: "--olive", bloq: "--red", anal: "--amber", pend: "--text-muted" };
    // Sem onclick inline aqui de propósito: funções deste arquivo vivem dentro
    // da IIFE (function(global){...})(window) e um onclick="..." executa no
    // escopo global, não a enxergaria. data-i/data-status + delegação de
    // clique em wireArmazensEdicao() (mesmo padrão do resto do arquivo).
    // "alternarMenuCategoria" na pill, logo abaixo, é diferente: essa função
    // É global de verdade (vive no index.html, fora da IIFE), por isso pode
    // ser chamada por onclick normalmente.
    const opts = Object.keys(STAT_ARM).map(function (k) {
      const bOpt = STAT_ARM[k];
      return '<button type="button" class="status-opt" data-i="' + i + '" data-status="' + k + '">' +
        '<i class="dot" style="background:var(' + corPontinho[bOpt[1]] + ')"></i>' + bOpt[0] + "</button>";
    }).join("");
    // Transf. (faz T+/T−): fora do modo edição isto é INFORMAÇÃO, não controle.
    // Um checkbox desabilitado é quase ilegível — marcado e desmarcado ficam
    // com o mesmo peso visual —, então em leitura vira badge com cor e texto
    // ("T+ / T−" verde = faz, "—" apagado = não faz). O checkbox de verdade só
    // aparece pra quem está editando, que é quem precisa clicar nele.
    const fazTT = !!a.tt;
    const celTransf = EDIT_MODE
      ? '<label class="df-armz-check"><input type="checkbox" class="df-armz-check-input" data-i="' +
        i + '"' + (fazTT ? " checked" : "") + "> T+ / T−</label>"
      : '<span class="badge ' + (fazTT ? "disp" : "pend") + '">' + (fazTT ? "T+ / T−" : "—") + "</span>";
    // Mesma regra pro status: fora do modo edição a pílula não abre dropdown
    // (antes abria pra qualquer perfil e o clique não fazia nada, porque
    // selecionarStatusArmazem() barra quem não está editando — menu que não
    // faz nada é pior que menu que não existe).
    const celStatus = EDIT_MODE
      ? '<span class="status-cell"><span class="badge ' + st[1] + ' status-toggle" onclick="alternarMenuCategoria(this)">' +
        st[0] + '<span class="status-caret">▼</span></span><div class="status-dropdown">' + opts + "</div></span>"
      : '<span class="badge ' + st[1] + '">' + st[0] + "</span>";
    return "<tr>" + inputs +
      "<td>" + celTransf + "</td>" +
      "<td>" + celStatus + "</td>" +
      "</tr>";
  }).join("");
  return '<div class="df-tw"><table><thead><tr><th>Código</th><th>Utilização</th><th>Responsável</th>' +
    "<th>Dono</th><th>Transf.</th><th>Status</th></tr></thead><tbody>" + rows + "</tbody></table></div>";
}
function selecionarStatusArmazem(i, statusKey) {
  document.querySelectorAll(".status-dropdown.aberto").forEach(function (d) { d.classList.remove("aberto"); });
  if (!EDIT_MODE || !DADOS.armazens || !DADOS.armazens[i]) return;
  DADOS.armazens[i].status = statusKey;
  marcarEditado();
  atualizarEdicaoArmazens(); // já redesenha o bloco

}
function wireArmazensEdicao() {
  ROOT.addEventListener("input", function (e) {
    const el = e.target.closest(".df-armz-input");
    // .df-armz-input só existe no DOM em modo edição agora (fora dele a
    // célula é <span>) — a checagem de EDIT_MODE aqui é defensiva, não o
    // caminho normal.
    if (!el || !EDIT_MODE) return;
    const i = parseInt(el.dataset.i, 10), campo = el.dataset.campo;
    if (!DADOS.armazens || !DADOS.armazens[i]) return;
    DADOS.armazens[i][campo] = el.value;
    marcarEditado();
  });
  ROOT.addEventListener("change", function (e) {
    const el = e.target.closest(".df-armz-check-input");
    if (!el || !EDIT_MODE) return;
    const i = parseInt(el.dataset.i, 10);
    if (!DADOS.armazens || !DADOS.armazens[i]) return;
    DADOS.armazens[i].tt = el.checked;
    marcarEditado();
  });
  ROOT.addEventListener("click", function (e) {
    const opt = e.target.closest(".status-opt[data-status]");
    if (!opt) return;
    selecionarStatusArmazem(parseInt(opt.dataset.i, 10), opt.dataset.status);
  });
}
// Chamada por setEditMode(): liga/desliga a edição da tabela de Armazéns
// junto com o resto da página (nenhum campo edita fora do modo edição).
// Redesenha o bloco inteiro (não só troca readOnly como antes) porque TODAS
// as colunas mudam de FORMA entre leitura e edição agora — Código/Utilização/
// Responsável/Dono viram <span> x <input>, Transf. vira badge x checkbox,
// Status vira pílula estática x pílula com dropdown. Só é chamada no clique
// do "Editar fluxo" e na troca de status, nunca durante digitação, então não
// existe risco de roubar o foco de quem está preenchendo um campo.
function atualizarEdicaoArmazens() {
  const bloco = document.getElementById("df-armazens-bloco");
  if (bloco) bloco.innerHTML = armazensTableHtml();
}
// Seção "Pendências" removida da tela a pedido do usuário (desnecessária no
// cenário atual — eram só notas de revisão/QA, sem valor operacional). O
// campo DADOS.pendencias continua sendo salvo no payload (linha ~1280) por
// segurança, só deixou de ser renderizado.
function montarShell(root) {
  ROOT = root;
  ROOT.className = "df-shell";
  const laneHolders = DADOS.lanes.map(function (l) {
    return '<div data-lane-holder="' + esc(l.id) + '"></div>';
  }).join("");
  root.innerHTML =
    "<header>" +
    '<div class="df-hd"><div>' +
    '<p class="df-kick">E-commerce · Fluxograma</p>' +
    "<h1>" + esc(DADOS.titulo_pagina || "Fluxo de Processos — E-commerce") + "</h1>" +
    '<p class="df-sub">Retângulo = etapa · Losango = decisão · Pílula = início/fim · Vermelho = desvio · Dourado = bifurcação · Verde = fluxo padrão</p>' +
    '<div class="df-rule"></div></div>' +
    (isAdmin() ? '<button type="button" class="df-editbtn" id="df-editbtn">✏️ Editar fluxo</button>' : "") +
    "</div>" +
    '<div class="df-stats">' +
    '<div class="df-stat"><b id="df-stat-total">0</b><span>Etapas no fluxo</span></div>' +
    '<div class="df-stat"><b id="df-stat-fases">0</b><span>Fases / processos</span></div>' +
    '<div class="df-stat df-a"><b id="df-stat-normal">0</b><span>Caminho normal</span></div>' +
    '<div class="df-stat df-b"><b id="df-stat-desvio">0</b><span>Desvios</span></div>' +
    '<div class="df-stat df-c"><b id="df-stat-bif">0</b><span>Bifurcações</span></div>' +
    "</div></header>" +
    '<div class="df-wrap">' +
    (isAdmin() ?
      '<div class="df-editbar" id="df-editbar" hidden>' +
      '<span>✏️ Modo edição — clique numa seta para inserir, numa etapa ou losango para editar.</span>' +
      '<span class="df-flex1"></span>' +
      '<button type="button" class="df-btn" id="df-btn-setores">Setores</button>' +
      '<button type="button" class="df-btn" id="df-btn-nova-fase">+ Nova fase</button>' +
      '<button type="button" class="df-btn" id="df-btn-descartar">Descartar</button>' +
      '<button type="button" class="df-btn df-btn-gold" id="df-btn-salvar" disabled>Salvar alterações</button>' +
      "</div>" : "") +
    '<section class="df-blk"><h2>Como a numeração funciona</h2>' +
    '<div class="df-rule-box">' +
    '<div><b>1, 2, 3…</b><p>Etapa do caminho padrão, sempre em sequência.</p></div>' +
    '<div><b>6.1, 6.2…</b><p>Desvio que nasce na etapa 6. Se ele mesmo se desdobrar: 6.1.1, 6.1.2.</p></div>' +
    '<div><b>5A, 5B</b><p>Bifurcação legítima — dois caminhos igualmente corretos, não um erro.</p></div>' +
    '<div><b>Cada fase recomeça do 1</b><p>Cada fase do fluxo é tratada como um processo separado.</p></div>' +
    "</div></section>" +
    /* Prefixo "df-" nas classes modificadoras (df-sw-step, df-ln-n, ...) é
       obrigatório — o CSS só reconhece a forma composta ".df-sw.df-sw-dev"
       etc. Sem ele (como estava) a legenda inteira aparecia sem nenhuma cor,
       mesma causa raiz do bug de TIPO_CLS acima. */
    '<section class="df-blk legend-blk"><div class="df-legs">' +
    '<div class="df-lg"><span class="df-sw df-sw-step"></span><div><b>Etapa</b><p>Passo do processo.</p></div></div>' +
    '<div class="df-lg"><span class="df-sw df-sw-dev"></span><div><b>Desvio</b><p>Só acontece fora do padrão.</p></div></div>' +
    '<div class="df-lg"><span class="df-sw df-sw-bif"></span><div><b>Bifurcação</b><p>Um dos caminhos possíveis.</p></div></div>' +
    '<div class="df-lg"><span class="df-sw df-sw-gate"></span><div><b>Regra do sistema</b><p>Bloqueio automático.</p></div></div>' +
    '<div class="df-lg"><span class="df-sw df-sw-dia"></span><div><b>Decisão</b><p>Losango — pergunta que define o caminho.</p></div></div>' +
    '<div class="df-lg"><span class="df-ln df-ln-n"></span><div><b>Fluxo normal</b><p>Linha sólida cinza.</p></div></div>' +
    '<div class="df-lg"><span class="df-ln df-ln-ok"></span><div><b>Saída correta</b><p>Linha verde.</p></div></div>' +
    '<div class="df-lg"><span class="df-ln df-ln-e"></span><div><b>Exceção</b><p>Linha tracejada vermelha.</p></div></div>' +
    '<div class="df-lg"><span class="df-ln df-ln-f"></span><div><b>Bifurcação</b><p>Linha dourada.</p></div></div>' +
    "</div></section>" +
    laneHolders +
    // Armazéns: só quando o payload traz a lista (no E-commerce nasce sem —
    // a tabela depende de classes de status da tela de Estoque da DISTR).
    ((DADOS.armazens && DADOS.armazens.length) ?
      '<section class="df-blk"><h2>Armazéns</h2><div id="df-armazens-bloco">' + armazensTableHtml() + "</div></section>" : "") +
    '<footer id="df-footer">Clique numa etapa para o detalhe completo — o texto original validado por cada ' +
    "área está preservado na íntegra ali dentro.</footer>" +
    "</div>" +
    '<dialog id="df-dlg"><button class="df-dlg-x" id="df-dlgx" type="button" aria-label="Fechar">✕</button>' +
    '<div id="df-dlgbody"></div></dialog>' +
    '<button class="df-tunebtn" id="df-tunebtn" type="button" title="Ajustar espaçamento e tamanho" ' +
    'aria-label="Ajustar layout"><svg viewBox="0 0 24 24"><path d="M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6z"/>' +
    '<path d="M19.4 13a1.7 1.7 0 0 0 .3 1.9l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.9-.3 1.7 1.7 0 0 0-1 1.5V19a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1-1.6 1.7 1.7 0 0 0-1.9.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.9 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.6-1 1.7 1.7 0 0 0-.3-1.9l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.9.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.9-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.9V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/></svg></button>' +
    '<div class="df-tunepanel" id="df-tunepanel" hidden>' +
    '<div class="df-tp-h"><b>Ajustar layout</b><button id="df-tp-close" type="button" aria-label="Fechar painel">✕</button></div>' +
    '<p class="df-tp-note">Mexe ao vivo, direto no navegador. Fica salvo neste navegador.</p>' +
    '<p class="df-tp-fit">Ajuste automático à tela <b id="df-v-fit">100%</b></p>' +
    '<p class="df-tp-fitnote" id="df-tp-fitnote" hidden>O diagrama ficou mais largo que a janela e foi ' +
    "reduzido para caber inteiro.</p>" +
    ['lane', 'bx', 'cy', 'bw', 'bh', 'dia'].map(function (k) {
      const lbl = { lane: "Espaço entre etapas do tronco", bx: "Espaço losango → ramo lateral",
        cy: "Espaço entre itens empilhados", bw: "Largura das etapas", bh: "Altura das etapas",
        dia: "Tamanho do losango" }[k];
      const range = { lane: "44,90,2", bx: "40,240,4", cy: "28,120,2", bw: "170,320,2", bh: "44,90,2", dia: "150,300,2" }[k].split(",");
      return '<div class="df-tp-row"><label>' + lbl + ' <b id="df-v-' + k + '"></b></label>' +
        '<input type="range" id="df-s-' + k + '" min="' + range[0] + '" max="' + range[1] + '" step="' + range[2] + '"></div>';
    }).join("") +
    '<button class="df-tp-reset" id="df-tp-reset" type="button">Restaurar padrão</button></div>';
  document.getElementById("df-dlgx").addEventListener("click", function () { document.getElementById("df-dlg").close(); });
  document.getElementById("df-dlg").addEventListener("click", function (e) {
    if (e.target.id === "df-dlg") document.getElementById("df-dlg").close();
  });
  montarBuscaNaTopbar();
}
/* A busca vive na topbar do app (fora de #dfRoot), não mais numa barra
   própria rolando junto do conteúdo — evita o conflito visual de duas
   barras "grudentas" (sticky) competindo no topo da tela ao rolar a página
   (a topbar do app já é position:fixed). Criado só na primeira montagem
   (não existe ainda) — index.html (mostrarSecao) só alterna a classe
   .ativa pra mostrar/esconder o slot ao trocar de seção; o elemento nunca
   é destruído, senão o listener de wireSearch() se perderia. */
function montarBuscaNaTopbar() {
  const slot = document.getElementById("topbarBusca");
  if (!slot || slot.querySelector("#df-q")) return;
  slot.innerHTML = '<input type="search" id="df-q" placeholder="Buscar por número, etapa ou área…" ' +
    'aria-label="Buscar etapa"><span class="df-qhint" id="df-qhint"></span>';
}

/* ============================================================
   CARGA + SALVAMENTO — só lê/escreve em dashboard_snapshots, pagina
   'ecom_fluxo'. Mesma tabela e mesmo padrão "uma versão = uma linha nova"
   que o resto do Report E-commerce já usa (README, seção 1 e "Evoluções
   naturais"); "Salvar" nunca dá UPDATE, então cada versão anterior continua
   inteira no banco — é o histórico/undo de graça.
   ============================================================ */
async function carregarDados() {
  const { data, error } = await SB
    .from("dashboard_snapshots")
    .select("payload, gerado_em")
    .eq("pagina", "ecom_fluxo")
    .order("gerado_em", { ascending: false })
    .limit(1);
  if (error) {
    ROOT.innerHTML = '<div class="df-aviso df-erro">Erro ao carregar o fluxo: ' + esc(error.message) + "</div>";
    return false;
  }
  if (!data || !data.length) {
    ROOT.innerHTML = '<div class="df-aviso">Nenhuma versão do fluxo publicada ainda.' +
      (isAdmin() ? " Use o editor para montar a primeira versão." : " Fale com o admin.") + "</div>";
    return false;
  }
  DADOS = data[0].payload;
  DADOS.setores = DADOS.setores || [];
  DADOS.lanes = DADOS.lanes || [];
  DADOS.nos = DADOS.nos || {};
  SNAP_INFO = { gerado_em: data[0].gerado_em };
  return true;
}

async function salvar() {
  if (!isAdmin()) return; // a trava que importa é a RLS gravar_snapshots (só admin) no banco
  const btn = document.getElementById("df-btn-salvar");
  if (btn) { btn.disabled = true; btn.textContent = "Salvando…"; }
  try {
    const payload = {
      versao_schema: DADOS.versao_schema || 1,
      titulo_pagina: DADOS.titulo_pagina,
      setores: DADOS.setores,
      lanes: DADOS.lanes,
      nos: DADOS.nos,
      armazens: DADOS.armazens,
      pendencias: DADOS.pendencias,
    };
    // .select() no insert pra trazer de volta o gerado_em que o BANCO gravou
    // (a coluna é default now(); o relógio do servidor é a fonte de verdade,
    // não o do navegador). Sem isto o SNAP_INFO ficava com a data da versão
    // ANTERIOR e a topbar seguia anunciando "Última atualização" velha logo
    // depois de o admin publicar uma versão nova.
    const { data, error } = await SB.from("dashboard_snapshots")
      .insert({
        pagina: "ecom_fluxo",
        // tipo_snapshot e data_snapshot são NOT NULL aqui (no report-DISTR
        // não existem). 'manual' = versão salva por uma pessoa, mesmo rótulo
        // do botão "Subir versão"; gerado_em em UTC, mesmo padrão do ingest.js.
        tipo_snapshot: "manual",
        data_snapshot: new Date().toISOString().slice(0, 10),
        gerado_em: new Date().toISOString(),
        payload: payload,
      })
      .select("gerado_em")
      .single();
    if (error) throw error;
    if (data && data.gerado_em) {
      SNAP_INFO = { gerado_em: data.gerado_em };
      if (typeof global.atualizarSubtituloSecao === "function") global.atualizarSubtituloSecao("fluxo");
    }
    EDITADO = false;
    const bar = document.getElementById("df-editbar");
    if (bar) bar.classList.remove("df-tem-mudanca");
    alert("Alterações salvas — quem abrir o fluxo agora já vê a versão nova.");
  } catch (e) {
    alert("Não foi possível salvar: " + (e && e.message ? e.message : String(e)));
  } finally {
    if (btn) { btn.disabled = !EDITADO; btn.textContent = "Salvar alterações"; }
  }
}

/* ============================================================
   API PÚBLICA
   ============================================================ */
async function iniciar(rootId, supabaseClient, perfilAtual) {
  SB = supabaseClient;
  PERFIL = perfilAtual;
  const root = document.getElementById(rootId);
  if (!root) return;
  ROOT = root;
  ROOT.innerHTML = '<p class="df-loading">Carregando fluxo…</p>';
  const ok = await carregarDados();
  if (!ok) return;
  montarShell(root);
  wireSearch();
  wireTune();
  wireEditToggle();
  wireCliquesDelegados();
  wireArmazensEdicao();
  atualizarEdicaoArmazens();
  renderTudo();
  // A seção carrega sob demanda: quando mostrarSecao('fluxo') rodou, o
  // snapshot ainda não existia e a topbar ficou sem data. Agora que existe,
  // reescreve o subtítulo — mas só se o usuário ainda estiver no Fluxo (ele
  // pode ter trocado de seção enquanto o await acima resolvia).
  if (typeof global.atualizarSubtituloSecao === "function") global.atualizarSubtituloSecao("fluxo");
}

// dataSnapshot(): o index.html usa isto pra escrever "Última atualização" na
// topbar quando a seção Fluxo de Processos está aberta. Retorna null enquanto
// o snapshot não carregou (a seção carrega sob demanda, na primeira visita).
global.EcomFluxo = {
  iniciar: iniciar,
  dataSnapshot: function () { return SNAP_INFO ? SNAP_INFO.gerado_em : null; },
};
})(window);
