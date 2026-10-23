/* ============================================================
   PLANTA 3D DA OCUPAÇÃO — tela Estoque (abaixo da tabela e dos donuts)

   Desenho do galpão (validado com a operação): vestuário E/F/G à esquerda
   com ruas na vertical (só piso 1), divisão de módulos, calçados A/B/C com
   ruas na horizontal e 4 pisos. Cada rua de calçados tem duas longarinas
   (lado par em cima, ímpar embaixo; 001/002 na ponta direita) e a rua 01
   tem também a parte de trás da longarina. Estruturas: elevador (A35),
   eclusa de 10 pallets, 3 escadas no bloco B, caixas de faturamento
   (C19–20, pisos 2–4), colmeia (C36–47, piso 1: 10 ruas, 20 colmeias de
   5 × 16 escaninhos, mesa de embalagem e esteira em volta) e mesas ADM.

   Dados: saldo por prédio vem da view vw_ocupacao_mapa (agregada de
   balanco_wms_detalhado, o Estoque WMS do último "Atualizar Balanço").
   Capacidade: calçados pela regra por endereço (mesma de "Endereços com
   disponibilidade", sem os ENDERECOS_INATIVOS); vestuário pela capacidade
   do piso/bloco do snapshot de Estoque, repartida pelo nº de prédios.

   Uso: montarPlanta3D(elementoContainer, payloadDoSnapshotEstoque)
   Three.js r128 é carregado sob demanda na primeira vez.
   ============================================================ */
(function () {
'use strict';

const URL_THREE = 'https://cdnjs.cloudflare.com/ajax/libs/three.js/r128/three.min.js';
const URL_ORBIT = 'https://cdn.jsdelivr.net/npm/three@0.128.0/examples/js/controls/OrbitControls.js';

const P3 = { estado: null, cache: null, ui: { modo: 'geral', piso: 0, topo: false, faixas: false, cam: null } };

/* ---------------- utilidades ---------------- */
const fmtI = v => Math.round(v).toLocaleString('pt-BR');
const fmtP = v => v.toLocaleString('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 1 }) + '%';
const pad = (v, n) => String(v).padStart(n || 2, '0');
const FRENTE = { A: 10, B: 12, C: 10 };   // a rua 01 normal vai até aqui; depois vem a parte de trás da longarina
function capEnd(b, r, p, n) {             // mesma regra de capacidadeEnderecoCalcado (index.html)
  if (r <= 34) return p > 1 ? 60 : [60, 60, 40][n - 1];
  if (p > 1) return [50, 60, 60][n - 1];
  if (b === 'A') return [60, 60, 40][n - 1];
  if (b === 'B') return [50, 50, 70][n - 1];
  return [50, 60, 60][n - 1];
}
function carregarScript(src) {
  return new Promise((ok, erro) => {
    const s = document.createElement('script'); s.src = src; s.async = true;
    s.onload = ok; s.onerror = () => erro(new Error('Não foi possível carregar ' + src));
    document.head.appendChild(s);
  });
}
async function garantirThree() {
  if (window.THREE && window.THREE.OrbitControls) return;
  if (!window.THREE) await carregarScript(URL_THREE);
  if (!window.THREE.OrbitControls) await carregarScript(URL_ORBIT);
}

/* ---------------- dados ---------------- */
async function buscarMapa() {
  // cache de 5 min: trocar de tema re-renderiza a tela e não precisa buscar de novo
  if (P3.cache && Date.now() - P3.cache.em < 5 * 60 * 1000) return P3.cache.linhas;
  const linhas = [];
  for (let off = 0; ; off += 1000) {
    const { data, error } = await supabaseClient.from('vw_ocupacao_mapa')
      .select('bloco, rua, predio, piso, enderecos, saldo, gerado_em')
      .order('bloco').order('rua').order('predio').order('piso').range(off, off + 999);
    if (error) throw new Error('Erro ao ler a ocupação por endereço: ' + error.message);
    if (!data || !data.length) break;
    linhas.push(...data);
    if (data.length < 1000) break;
  }
  P3.cache = { em: Date.now(), linhas };
  return linhas;
}
// Cadastro de endereços do WMS por prédio (Abastecimento → Cadastro de Endereços). Vazio = ainda não carregado.
async function buscarCadastro() {
  if (P3.cacheCad && Date.now() - P3.cacheCad.em < 5 * 60 * 1000) return P3.cacheCad.linhas;
  const linhas = [];
  for (let off = 0; ; off += 1000) {
    const { data, error } = await supabaseClient.from('vw_enderecos_predio')
      .select('bloco, rua, predio, andar, setor, aptos, carregado_em')
      .order('bloco').order('rua').order('predio').order('andar').range(off, off + 999);
    if (error) { console.warn('Cadastro de endereços indisponível:', error.message); break; }
    if (!data || !data.length) break;
    linhas.push(...data);
    if (data.length < 1000) break;
  }
  P3.cacheCad = { em: Date.now(), linhas };
  return linhas;
}
const naoExiste = e => (typeof enderecoNaoExisteConfirmado === 'function' ? enderecoNaoExisteConfirmado(e) : null);
function inativos() {
  const m = {};
  try { Object.keys(ENDERECOS_INATIVOS).forEach(k => ENDERECOS_INATIVOS[k].forEach(e => { m[e] = k; })); } catch (e) { /* lista não carregada */ }
  return m;
}
// Linhas por prédio da fonte mais próxima da tabela: o mapa salvo pelo "Atualizar Estoque"
// (mesmo arquivo e mesmas regiões da tabela) e, se não houver, a view do Balanço WMS.
async function obterLinhas(payload) {
  const m = payload && payload.mapa;
  if (m && m.linhas && m.linhas.length) {
    return { fonte: 'estoque', base: payload.gerado_em || null,
      linhas: m.linhas.map(l => ({ bloco: l[0], rua: l[1], predio: l[2], piso: l[3], saldo: l[4], regiao: m.regioes[l[5]] })) };
  }
  const linhas = await buscarMapa();
  let base = null; linhas.forEach(l => { if (l.gerado_em && (!base || l.gerado_em > base)) base = l.gerado_em; });
  return { fonte: 'balanco', base, linhas };
}
const normReg = s => String(s || '').replace(/\s+/g, ' ').trim().toUpperCase();
// maior saldo vence (empate: a primeira vista)
function regiaoMaior(mapa) { let melhor = null, v = -Infinity; mapa.forEach((s, r) => { if (s > v) { v = s; melhor = r; } }); return melhor; }
function montarDados(linhas, payload, cadastro) {
  const inat = inativos(), capTab = {};
  // cadastro do WMS: aptos ativos por prédio (calçados) e endereços por rua (vestuário)
  const cadCalc = new Map(), cadVest = new Map(); let baseCad = null;
  (cadastro || []).forEach(c => {
    if (c.carregado_em && (!baseCad || c.carregado_em > baseCad)) baseCad = c.carregado_em;
    const b = c.bloco, r = +c.rua, pr = +c.predio, p = +c.andar;
    if (c.setor === 'CALÇADOS' && 'ABC'.includes(b) && p >= 1 && p <= 4) {
      const aptos = (c.aptos || []).map(Number).filter(n => !naoExiste(b + pad(r) + pad(pr, 3) + p + pad(n)));
      if (!aptos.length) return;
      const k = b + '|' + r + '|' + p + '|' + pr; cadCalc.set(k, (cadCalc.get(k) || []).concat(aptos));
    } else if (c.setor === 'CONFECÇÃO' && 'EFG'.includes(b)) {
      const k = b + '|' + r; const o = cadVest.get(k) || { n: 0, np: 0 }; o.n += (c.aptos || []).length; o.np = Math.max(o.np, pr); cadVest.set(k, o);
    }
  });
  const usaCad = cadCalc.size > 0;
  ((payload && payload.pisos) || []).forEach(x => { capTab[normReg(x.piso_bloco)] = Number(x.capacidade) || 0; });
  const padrao = (b, p) => 'PISO ' + p + ' - ' + b;
  // ---- agrega por prédio, guardando a região de cada um
  const pred = new Map(), maxPred = new Map(), regRua = new Map(), vest = new Map();
  linhas.forEach(l => {
    const b = l.bloco, r = +l.rua, p = +l.piso, pr = +l.predio, s = Number(l.saldo) || 0;
    const reg = normReg(l.regiao || padrao(b, p));
    if ('ABC'.includes(b)) {
      if (p < 1 || p > 4) return;
      if (b === 'A' && r === 47) return;   // rua A47 é de vestuário (região "PISO 1 - A (VESTUÁRIO)"): fora do relatório de calçados
      const k = b + '|' + r + '|' + p;
      maxPred.set(k, Math.max(maxPred.get(k) || 0, pr));
      let o = pred.get(k + '|' + pr); if (!o) { o = { saldo: 0, regs: new Map() }; pred.set(k + '|' + pr, o); }
      o.saldo += s; o.regs.set(reg, (o.regs.get(reg) || 0) + s);
      let rr = regRua.get(k); if (!rr) { rr = new Map(); regRua.set(k, rr); } rr.set(reg, (rr.get(reg) || 0) + s);
    } else {
      const k = b + '|' + r; let o = vest.get(k);
      if (!o) { o = { b, r, saldo: 0, np: 0, n: 0, regs: new Map() }; vest.set(k, o); }
      o.saldo += s; o.np = Math.max(o.np, pr); o.n += Number(l.enderecos) || 0; o.regs.set(reg, (o.regs.get(reg) || 0) + s);
    }
  });
  // ---- calçados: uma entrada por bloco × rua × piso × lado × região; capacidade pela regra por endereço.
  // Com o cadastro do WMS: só os prédios/aptos ativos lá (menos os confirmados que não existem).
  // Sem cadastro: deduz pelos prédios com saldo (1..último) menos a lista de inativos.
  const prediosPorRua = new Map();
  const addPred = (k, pr) => { let s = prediosPorRua.get(k); if (!s) { s = new Set(); prediosPorRua.set(k, s); } s.add(pr); };
  if (usaCad) {
    cadCalc.forEach((_, kp) => { const i = kp.lastIndexOf('|'); if (!(kp.startsWith('A|47|'))) addPred(kp.slice(0, i), +kp.slice(i + 1)); });
    pred.forEach((_, kp) => { const i = kp.lastIndexOf('|'); addPred(kp.slice(0, i), +kp.slice(i + 1)); });   // saldo em prédio fora do cadastro não some
  } else {
    maxPred.forEach((np, k) => { for (let pr = 1; pr <= np; pr++) addPred(k, pr); });
  }
  const ruasCalc = new Map();
  prediosPorRua.forEach((setPred, k) => {
    const [b, rs, ps] = k.split('|'), r = +rs, p = +ps, regPadrao = regiaoMaior(regRua.get(k) || new Map()) || padrao(b, p);
    for (const pr of [...setPred].sort((x, y) => x - y)) {
      const face = r === 1 && pr > FRENTE[b] ? 'tras' : (pr % 2 ? 'impar' : 'par');
      const dp = pred.get(k + '|' + pr), reg = dp ? regiaoMaior(dp.regs) : regPadrao;
      const kk = k + '|' + face + '|' + reg; let o = ruasCalc.get(kk);
      if (!o) { o = { b, r, p, face, regiao: reg, saldo: 0, capRegra: 0, n: 0, preds: new Set() }; ruasCalc.set(kk, o); }
      let ativos = 0;
      const niveis = usaCad ? (cadCalc.get(k + '|' + pr) || []) : [1, 2, 3].filter(n => !inat[b + pad(r) + pad(pr, 3) + p + pad(n)] && !naoExiste(b + pad(r) + pad(pr, 3) + p + pad(n)));
      niveis.forEach(n => { o.capRegra += capEnd(b, r, p, n); o.n++; ativos++; });
      const sp = dp ? dp.saldo : 0;
      o.saldo += sp;
      if (ativos || sp) o.preds.add(pr);   // prédio todo inativo/inexistente não conta no comprimento do lado
    }
  });
  // ---- capacidade: a de cada piso/bloco da tabela, repartida entre as ruas pela regra.
  // No piso 1 a tabela já é a soma da regra (fator = 1); nos pisos 2–4 é a tabela padrão.
  // Assim a soma de cada piso/bloco na planta é igual à tabela (saldo e capacidade).
  const somaRegra = {};
  ruasCalc.forEach(o => { somaRegra[o.regiao] = (somaRegra[o.regiao] || 0) + o.capRegra; });
  ruasCalc.forEach(o => {
    const tab = capTab[o.regiao];
    o.foraTabela = !tab;
    o.cap = tab && somaRegra[o.regiao] ? o.capRegra * tab / somaRegra[o.regiao] : o.capRegra;
    o.pct = o.cap ? o.saldo / o.cap * 100 : (o.saldo ? 100 : 0);
    o.np = o.preds.size;
  });
  // ---- vestuário: capacidade do piso/bloco repartida pelos endereços ativos de cada rua (cadastro)
  // ou, sem cadastro, pelo nº de prédios
  const ruasVest = [];
  ['E', 'F', 'G'].forEach(b => {
    const lista = [];
    for (let r = 1; r <= 26; r++) {
      const o = vest.get(b + '|' + r) || { b, r, saldo: 0, np: 0, n: 0, regs: new Map() };
      const cv = cadVest.get(b + '|' + r);
      if (cv) { o.np = cv.np; o.peso = cv.n; o.nCad = cv.n; }
      if (!o.np) o.np = (b === 'E' && r <= 13) || (b === 'G' && r >= 14) ? 28 : 42;
      if (!o.peso) o.peso = o.np;
      o.regiao = regiaoMaior(o.regs) || padrao(b, 1);
      lista.push(o);
    }
    const soma = lista.reduce((a, o) => a + o.peso, 0), capB = capTab[padrao(b, 1)] || 0;
    lista.forEach(o => { o.cap = capB * o.peso / soma; o.pct = o.cap ? o.saldo / o.cap * 100 : 0; ruasVest.push(o); });
  });
  return { ruasCalc, ruasVest, usaCad, baseCad };
}

/* ---------------- cores ---------------- */
const RAMPS = {
  dark:  [[0, '#1E7A4A'], [.6, '#45C645'], [.72, '#C6D23A'], [.82, '#F6BD00'], [.92, '#F28322'], [1, '#E0283E']],
  light: [[0, '#2A8F55'], [.6, '#4DB84D'], [.72, '#BFC232'], [.82, '#E9A800'], [.92, '#E06A1B'], [1, '#B5122B']]
};
const INFRA = {
  dark:  { esteira: '#10161F', colmeia: '#FF9233', estr: '#7C92AC', estrut: '#2F5F9E', degrau: '#B9CDEA', parede: '#5A6F88', piso: '#22344A', chao: '#18233A', mesa: '#B08A5E', perna: '#55657A', cadeira: '#3A4A5E', pessoa: '#4F86C6', coord: '#F6BD00', pele: '#E2B48C', monitor: '#0E141E', tela: '#8FC3F5', pallet: '#9A7350', carga: '#CDB48C', eclusa: '#33516E', corrimao: '#F6BD00', faixa: '#F6BD00' },
  light: { esteira: '#3A4656', colmeia: '#EE7A16', estr: '#8EA3BA', estrut: '#3A6AAE', degrau: '#E4EDF8', parede: '#9DB0C4', piso: '#D6DFE9', chao: '#E3E9F0', mesa: '#B08A5E', perna: '#8A99AA', cadeira: '#7D8DA0', pessoa: '#3F78BD', coord: '#C9960A', pele: '#D9A77E', monitor: '#1B2533', tela: '#6FAEEB', pallet: '#9A7350', carga: '#D9C4A0', eclusa: '#C4D3E2', corrimao: '#D9A300', faixa: '#E8B000' }
};
const tema = () => document.documentElement.getAttribute('data-tema') === 'claro' ? 'light' : 'dark';
const hex2 = h => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];
function corRGB(pct) {
  let t = Math.max(0, Math.min(1, pct / 100));
  if (P3.ui.faixas) t = pct < 70 ? .6 : pct < 85 ? .8 : pct < 95 ? .9 : 1;
  const r = RAMPS[tema()];
  for (let i = 1; i < r.length; i++) if (t <= r[i][0]) {
    const a = r[i - 1], b = r[i], k = (t - a[0]) / (b[0] - a[0] || 1), ca = hex2(a[1]), cb = hex2(b[1]);
    return ca.map((v, j) => Math.round(v + (cb[j] - v) * k));
  }
  return hex2(r[r.length - 1][1]);
}
const corCSS = pct => 'rgb(' + corRGB(pct).join(',') + ')';

/* ---------------- CSS e HTML ---------------- */
function injetaCSS() {
  if (document.getElementById('p3-css')) return;
  const st = document.createElement('style'); st.id = 'p3-css';
  st.textContent = `
.p3-card { padding: 0; overflow: hidden; }
.p3-bar { display: flex; flex-wrap: wrap; gap: 10px 18px; align-items: center; justify-content: space-between; padding: 12px 14px; border-bottom: 1px solid var(--border); }
.p3-ctrls { display: flex; flex-wrap: wrap; gap: 8px 16px; align-items: center; }
.p3-grp { display: flex; gap: 4px; align-items: center; font-size: 12px; color: var(--text-muted); }
.p3-seg { display: inline-flex; border: 1px solid var(--border); border-radius: 99px; padding: 3px; background: var(--bg-input); }
.p3-seg button { all: unset; cursor: pointer; padding: 6px 16px; border-radius: 99px; font-size: 13px; font-weight: 600; color: var(--text-muted); }
.p3-seg button[aria-pressed="true"] { background: var(--amber); color: #142032; }
.p3-chip { all: unset; cursor: pointer; padding: 4px 10px; border-radius: 99px; border: 1px solid var(--border); font-size: 12.5px; color: var(--text-muted); font-variant-numeric: tabular-nums; }
.p3-chip[aria-pressed="true"] { background: var(--amber); border-color: var(--amber); color: #142032; font-weight: 700; }
.p3-seg button:focus-visible, .p3-chip:focus-visible { outline: 2px solid var(--amber); outline-offset: 2px; }
.p3-kpi { font-size: 12.5px; color: var(--text-muted); font-variant-numeric: tabular-nums; }
.p3-kpi b { color: var(--text); font-weight: 600; }
.p3-stage { position: relative; height: clamp(420px, 64vh, 660px); background: radial-gradient(120% 90% at 50% 0%, var(--bg-card) 0%, var(--bg) 100%); }
.p3-stage canvas { display: block; width: 100%; height: 100%; touch-action: none; cursor: grab; }
.p3-labels { position: absolute; inset: 0; pointer-events: none; overflow: hidden; }
.p3-lbl { position: absolute; transform: translate(-50%, -50%); font-size: 11px; font-weight: 700; color: var(--text-muted); white-space: nowrap; letter-spacing: .04em; text-shadow: 0 0 5px var(--bg), 0 0 2px var(--bg); }
.p3-lbl.big { font-size: 13px; color: var(--text); }
.p3-lbl.inf { color: var(--text); font-weight: 600; background: var(--bg-input); border: 1px solid var(--border); border-radius: 4px; padding: 1px 6px; text-shadow: none; }
.p3-hint { position: absolute; left: 12px; bottom: 10px; font-size: 11.5px; color: var(--text-muted); pointer-events: none; }
.p3-reset { position: absolute; right: 12px; bottom: 10px; background: var(--bg-card); }
.p3-msg { position: absolute; inset: 0; display: grid; place-items: center; color: var(--text-muted); padding: 20px; text-align: center; font-size: 13px; }
.p3-legend { display: flex; flex-wrap: wrap; gap: 8px 22px; align-items: center; padding: 10px 14px; border-top: 1px solid var(--border); font-size: 12px; color: var(--text-muted); }
.p3-ramp { width: min(340px, 100%); }
.p3-ramp .g { height: 10px; border-radius: 3px; }
.p3-ramp .ticks { position: relative; height: 16px; font-variant-numeric: tabular-nums; }
.p3-ramp .ticks span { position: absolute; top: 2px; transform: translateX(-50%); font-size: 10.5px; }
.p3-sw { display: inline-flex; gap: 6px; align-items: center; }
.p3-sw i { width: 12px; height: 12px; border-radius: 3px; display: inline-block; }
.p3-base { padding: 0 14px 12px; font-size: 11.5px; color: var(--text-muted); }
.p3-tip { position: fixed; z-index: 9999; pointer-events: none; background: var(--bg-card); color: var(--text); border: 1px solid var(--border); border-radius: 8px; padding: 8px 11px;
  font-size: 12.5px; min-width: 190px; max-width: 320px; box-shadow: var(--shadow); font-variant-numeric: tabular-nums; }
.p3-tip .t { font-weight: 700; margin-bottom: 2px; }
.p3-tip .p { font-size: 20px; font-weight: 300; }
.p3-tip .s { color: var(--text-muted); }
@media (max-width: 720px) { .p3-hint { display: none; } }
.p3-tela { display: inline-flex; align-items: center; gap: 6px; }
.p3-tela svg { width: 14px; height: 14px; }
/* tela cheia: o card ocupa o monitor inteiro e o 3D cresce no espaço que sobra */
.p3-card:fullscreen, .p3-card.p3-max { display: flex; flex-direction: column; width: 100vw; height: 100vh; border-radius: 0; border: 0; background: var(--bg-card); }
.p3-card.p3-max { position: fixed; inset: 0; z-index: 9000; }
.p3-card:fullscreen .p3-stage, .p3-card.p3-max .p3-stage { flex: 1 1 auto; height: auto; min-height: 0; }
.p3-card:fullscreen .p3-base, .p3-card.p3-max .p3-base { display: none; }`;
  document.head.appendChild(st);
}
function htmlPlanta() {
  return '<div class="p3-bar">'
    + '<div class="p3-seg" role="group" aria-label="Segmento"><button type="button" data-m="geral">Geral</button><button type="button" data-m="calc">Calçados</button><button type="button" data-m="vest">Vestuário</button></div>'
    + '<span class="p3-kpi" data-k="kpi"></span>'
    + '<div class="p3-ctrls"><div class="p3-grp" data-k="pisos">Piso'
    + [0, 1, 2, 3, 4].map(p => '<button class="p3-chip" type="button" data-p="' + p + '">' + (p ? p : 'Todos') + '</button>').join('')
    + '</div><div class="p3-grp">Vista<button class="p3-chip" type="button" data-v="3d">3D</button><button class="p3-chip" type="button" data-v="topo">Planta</button></div>'
    + '<button class="p3-chip p3-tela" type="button" data-k="tela" title="Abrir a planta em tela cheia (Esc para sair)"></button></div></div>'
    + '<div class="p3-stage" data-k="stage"><canvas aria-label="Planta 3D com a ocupação por rua"></canvas><div class="p3-labels" data-k="labels"></div>'
    + '<div class="p3-msg" data-k="msg">Carregando planta 3D…</div>'
    + '<div class="p3-hint">Role para aproximar onde está o mouse · duplo clique aproxima (até 2×), o próximo volta · arraste para girar (na Planta, para mover)</div>'
    + '<button class="p3-chip p3-reset" type="button" data-k="reset">Centralizar</button></div>'
    + '<div class="p3-legend"><div class="p3-ramp"><div class="g" data-k="rampG"></div><div class="ticks" data-k="rampT"></div></div>'
    + '<span>Verde: espaço bom para armazenar (abaixo de 70%) · vermelho: 95% ou mais</span>'
    + '<div class="p3-grp">Escala<button class="p3-chip" type="button" data-e="0">Contínua</button><button class="p3-chip" type="button" data-e="1">Faixas do report</button></div>'
    + '<span class="p3-sw"><i data-k="swInf"></i>Estruturas (elevador, escadas, caixas de faturamento)</span>'
    + '<span class="p3-sw"><i data-k="swCol"></i>Colmeia (escaninhos)</span></div>'
    + '<div class="p3-base" data-k="base"></div>';
}

/* ---------------- planta (coordenadas do desenho ÷ 10) ---------------- */
const HP = 5;                       // altura entre pisos
const OP_ESTR = .84;                // estruturas translúcidas só o bastante para ver os degraus
const BL = {
  A: { x0: 88, x1: 109, z0: 39.5, z1: 109.5, np: 10 },
  B: { x0: 112, x1: 137,   z0: 40, z1: 110.5, np: 12 },
  C: { x0: 139, x1: 160,   z0: 40.5, z1: 110.5, np: 10 }
};
const wP = b => (BL[b].x1 - BL[b].x0) / BL[b].np;
const pit = b => (BL[b].z1 - BL[b].z0) / 48;
const zRow = (b, row) => BL[b].z0 + (row + .5) * pit(b);
const wB = b => 2 * wP(b);
const baia = pr => Math.ceil(pr / 2);
const VX0 = 53.3, VX1 = 79.8, vPit = (VX1 - VX0) / 13;   // vestuário praticamente colado na divisão de módulos
const ESCADAS_B = [4, 18, 32];   // rua do meio de cada escada (cadastro do WMS: prédios 005–008 inativos nas ruas 03–05, 17–19, 31–33)
const VB = { G: [[36.5, 47], [48, 58.5]], F: [[60, 70.5], [71.5, 82]], E: [[84, 94.5], [95.5, 106]] };
const posVest = r => r >= 14 ? { meia: 0, col: r - 14 } : { meia: 1, col: 13 - r };
function zVest(b, r, np) {
  const ps = posVest(r), zz = VB[b][ps.meia], L = zz[1] - zz[0], k = Math.min(1, (np || 42) / 42);
  if (k >= 1) return zz;
  return ps.meia === 0 ? [zz[1] - L * k, zz[1]] : [zz[0], zz[0] + L * k];
}
const VIEWS = {
  geral: { t: [106, 2, 90], o: [-48, 94, 124], top: 230 },
  calc:  { t: [123, 6, 76], o: [-38, 74, 98], top: 180 },
  vest:  { t: [67, 0, 74], o: [-30, 62, 78], top: 175 }
};
const CORES_COLMEIA = [['01','BLACK','#111111'],['02','BRANCA','#F4F6F8'],['03','AMARELA','#FFFF00'],['04','AZUL','#0A0A8C'],
  ['05','VERDE','#33CC33'],['06','VERMELHA','#FF1A1A'],['07','LARANJA','#FF8C00'],['08','LILÁS','#DDA0DD'],['09','ROSA','#FF00FF'],
  ['10','ROXA','#7B2D7B'],['11','CIANO','#00FFFF'],['12','CINZA','#D3D3D3'],['13','MOSTARDA','#FFBF00'],['14','MARROM','#A0522D'],
  ['15','ESMERALDA','#50C878'],['16','ESCARLATE','#E0352B'],['17','TIJOLO','#EE8F50'],['18','TERRACOTA','#F26B4F'],['19','ORQUÍDEA','#9932CC'],['20','OLIVA','#6B8E23']];

/* ---------------- tooltip (um só por página) ---------------- */
function tipEl() {
  let t = document.getElementById('p3-tip');
  if (!t) { t = document.createElement('div'); t.id = 'p3-tip'; t.className = 'p3-tip'; t.hidden = true; document.body.appendChild(t); }
  return t;
}
function mostraTip(x, y, html) {
  const tip = tipEl(); tip.innerHTML = html; tip.hidden = false;
  const host = document.fullscreenElement || document.body;   // em tela cheia só o card aparece: o tooltip vai junto
  if (tip.parentNode !== host) host.appendChild(tip);
  const w = tip.offsetWidth, h = tip.offsetHeight;
  tip.style.left = Math.min(window.innerWidth - w - 8, x + 14) + 'px';
  tip.style.top = Math.max(8, Math.min(window.innerHeight - h - 8, y + 14)) + 'px';
}
const escondeTip = () => { const t = document.getElementById('p3-tip'); if (t) t.hidden = true; };
function tipHtml(titulo, o, extra) {
  const num = o.cap ? '<div class="p" style="color:' + corCSS(o.pct) + '">' + fmtP(o.pct) + (o.pct > 100.05 ? ' <span style="font-size:12px">acima da capacidade</span>' : '') + '</div><div class="s">Saldo ' + fmtI(o.saldo) + ' · Capacidade ' + fmtI(o.cap) + ' · Livre ' + fmtI(Math.max(0, o.cap - o.saldo)) + '</div>'
    : '<div class="s">Saldo ' + fmtI(o.saldo) + ' · sem capacidade cadastrada</div>';
  return '<div class="t">' + titulo + '</div>' + num + (extra ? '<div class="s">' + extra + '</div>' : '');
}
const tipInfo = (t, s) => '<div class="t">' + t + '</div><div class="s">' + s + '</div>';

/* ---------------- ciclo de vida ---------------- */
function destruir() {
  const e = P3.estado; if (!e) return;
  try { P3.ui.cam = { p: e.camera.position.toArray(), t: e.controls.target.toArray() }; } catch (x) { /* sem câmera */ }
  cancelAnimationFrame(e.raf); cancelAnimationFrame(e.voo);
  if (e.ro) e.ro.disconnect();
  try { e.controls.dispose(); e.renderer.dispose(); } catch (x) { /* já liberado */ }
  escondeTip();
  P3.estado = null;
}

window.montarPlanta3D = async function (container, payload) {
  if (!container) return;
  injetaCSS();
  destruir();
  container.innerHTML = htmlPlanta();
  const q = k => container.querySelector('[data-k="' + k + '"]');
  const stage = q('stage'), cv = stage.querySelector('canvas'), labelsEl = q('labels'), msg = q('msg');
  const ui = P3.ui;

  // legenda e controles (funcionam mesmo antes do 3D carregar)
  function desenhaLegenda() {
    const g = q('rampG');
    if (ui.faixas) {
      const st = [[0, 70, 69], [70, 85, 80], [85, 95, 90], [95, 100, 99]];
      g.style.background = 'linear-gradient(90deg,' + st.map(s => corCSS(s[2]) + ' ' + s[0] + '% ' + s[1] + '%').join(',') + ')';
    } else {
      const p = []; for (let i = 0; i <= 20; i++) p.push(corCSS(i * 5) + ' ' + (i * 5) + '%');
      g.style.background = 'linear-gradient(90deg,' + p.join(',') + ')';
    }
    q('rampT').innerHTML = [0, 50, 70, 85, 95].map(v => '<span style="left:' + v + '%">' + v + '%</span>').join('');
    q('swInf').style.background = INFRA[tema()].estrut;
    q('swCol').style.background = INFRA[tema()].colmeia;
  }
  function kpis() {
    let s = 0, c = 0;
    ((payload && payload.pisos) || []).forEach(x => {
      const vest = /-\s*[EFG]\s*$/i.test(x.piso_bloco);
      if (ui.modo === 'geral' || (ui.modo === 'vest') === vest) { s += x.saldo; c += x.capacidade; }
    });
    q('kpi').innerHTML = c ? 'Ocupação <b>' + fmtP(s / c * 100) + '</b> · Saldo <b>' + fmtI(s) + '</b> · Capacidade <b>' + fmtI(c) + '</b>' : '';
  }
  function marcaBotoes() {
    container.querySelectorAll('[data-m]').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.m === ui.modo)));
    container.querySelectorAll('[data-p]').forEach(b => b.setAttribute('aria-pressed', String(+b.dataset.p === ui.piso)));
    container.querySelectorAll('[data-v]').forEach(b => b.setAttribute('aria-pressed', String((b.dataset.v === 'topo') === ui.topo)));
    container.querySelectorAll('[data-e]').forEach(b => b.setAttribute('aria-pressed', String((b.dataset.e === '1') === ui.faixas)));
    q('pisos').style.visibility = ui.modo === 'vest' ? 'hidden' : '';
  }
  desenhaLegenda(); kpis(); marcaBotoes();

  let dados;
  try {
    await garantirThree();
    const [fonte, cadastro] = await Promise.all([obterLinhas(payload), buscarCadastro()]);
    dados = montarDados(fonte.linhas, payload, cadastro); dados.fonte = fonte.fonte; dados.base = fonte.base;
  } catch (e) {
    console.error(e); msg.textContent = 'Não foi possível montar a planta 3D: ' + e.message; return;
  }
  if (!container.isConnected || !stage.isConnected) return;   // tela trocada enquanto carregava
  const { ruasCalc, ruasVest, base, fonte, usaCad, baseCad } = dados;
  q('base').textContent = (fonte === 'estoque'
      ? 'Saldo: mesmo arquivo e mesmas regiões da tabela acima ("Atualizar Estoque"' + (base ? ' de ' + formatarDataBR(base) : '') + '). '
      : 'Saldo: Estoque WMS do último "Atualizar Balanço"' + (base ? ' (' + formatarDataBR(base) + ')' : '') + ' — rode "Atualizar Estoque" para a planta usar o mesmo arquivo da tabela. ')
    + (usaCad ? 'Endereços: cadastro do WMS' + (baseCad ? ' (carregado em ' + formatarDataBR(baseCad) + ')' : '') + ', só os ativos. ' : 'Endereços: deduzidos pelos prédios com saldo — carregue o "Cadastro de Endereços (WMS)" no Abastecimento para usar o cadastro oficial. ')
    + 'Capacidade: no piso 1, a regra por endereço; nos pisos 2 a 4, a capacidade padrão de cada piso/bloco, repartida entre as ruas pela regra; no vestuário, ' + (usaCad ? 'pelos endereços ativos de cada rua' : 'pelo nº de prédios de cada rua') + '. A soma de cada piso/bloco é igual à tabela acima.';

  const THREE = window.THREE;
  let renderer;
  try { renderer = new THREE.WebGLRenderer({ canvas: cv, antialias: true, alpha: true }); }
  catch (e) { msg.textContent = 'Este navegador não abriu o 3D.'; return; }
  msg.remove();
  renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
  const camera = new THREE.PerspectiveCamera(30, 1, 1, 3000);
  const controls = new THREE.OrbitControls(camera, cv);
  controls.enableDamping = false;   // sem inércia: a imagem para junto com o mouse
  controls.rotateSpeed = .45; controls.panSpeed = .6;   // menos sensível: movimentos pequenos do mouse não jogam a imagem longe
  controls.maxPolarAngle = Math.PI * .49; controls.screenSpacePanning = true;
  controls.enableZoom = false;   // zoom próprio, na direção do mouse
  const est = { renderer, camera, controls, raf: 0, voo: 0, ro: null, nivelZoom: 0 };
  P3.estado = est;

  const scene = new THREE.Scene();
  scene.add(new THREE.HemisphereLight(0xffffff, 0x6b7c90, .95));
  const dl = new THREE.DirectionalLight(0xffffff, .55); dl.position.set(.5, 1.4, 1); scene.add(dl);
  const objs = [], labels = [];
  const cor = nome => new THREE.Color(INFRA[tema()][nome]);
  function reg(obj, seg, piso, pinta, alvo) { objs.push({ obj, seg, piso: piso || 0, pinta, alvo }); scene.add(obj); if (pinta) pinta(); return obj; }
  function rotulo(txt, x, y, z, seg, cls, piso) {
    const el = document.createElement('div'); el.className = 'p3-lbl' + (cls ? ' ' + cls : ''); el.textContent = txt;
    labelsEl.appendChild(el); labels.push({ el, pos: new THREE.Vector3(x, y, z), seg, piso: piso || 0 });
  }
  function caixa(x0, z0, x1, z1, y, h, nomeCor, seg, opts) {
    opts = opts || {};
    const mat = new THREE.MeshLambertMaterial({ transparent: opts.op != null, opacity: opts.op != null ? opts.op : 1, depthWrite: opts.op == null });
    const m = new THREE.Mesh(new THREE.BoxGeometry(Math.abs(x1 - x0), h, Math.abs(z1 - z0)), mat);
    m.position.set((x0 + x1) / 2, y + h / 2, (z0 + z1) / 2);
    m.userData.tip = opts.tip; m.userData.baseOp = mat.opacity;
    return reg(m, seg, opts.piso, () => mat.color.copy(cor(nomeCor)), !!opts.tip);
  }
  function lote(itens, seg, piso) {
    if (!itens.length) return null;
    const mat = new THREE.MeshLambertMaterial({ transparent: false, opacity: 1 });
    const mesh = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), mat, itens.length);
    const m4 = new THREE.Matrix4(), c = new THREE.Color();
    itens.forEach((it, i) => { m4.makeScale(it.w, it.h, it.d); m4.setPosition(it.x, it.y + it.h / 2, it.z); mesh.setMatrixAt(i, m4); });
    mesh.userData.itens = itens; mesh.userData.baseOp = 1;
    const pinta = () => {
      itens.forEach((it, i) => { if (it.hex) c.set(it.hex); else if (it.corNome) c.copy(cor(it.corNome)); else { const rgb = corRGB(it.pct); c.setRGB(rgb[0] / 255, rgb[1] / 255, rgb[2] / 255); } mesh.setColorAt(i, c); });
      mesh.instanceColor.needsUpdate = true;
    };
    return reg(mesh, seg, piso, pinta, itens.some(it => it.tip));
  }

  /* ---------- cena ---------- */
  caixa(46, 30, 164, 127, -.3, .3, 'chao', 'comum');
  // lajes dos mezaninos: seguem o recorte do bloco A (ruas 36–47 só têm os prédios 001–006), sem cobrir a área sem endereços
  const zQuebra = zRow('A', 35) + pit('A') / 2, xQuebra = BL.A.x1 - 6 * wP('A') - .3;
  for (let p = 2; p <= 4; p++) {
    caixa(86.5, 38, BL.C.x1 + 1.5, zQuebra, (p - 1) * HP - .12, .1, 'piso', 'calc', { op: .5, piso: p });
    caixa(xQuebra, zQuebra, BL.C.x1 + 1.5, 112, (p - 1) * HP - .12, .1, 'piso', 'calc', { op: .5, piso: p });
  }

  // calçados: uma faixa por rua × lado × piso
  for (let p = 1; p <= 4; p++) {
    const itens = [];
    ruasCalc.forEach(o => {
      if (o.p !== p) return;
      if (!o.preds.size) return;   // lado sem nenhum endereço ativo e sem saldo: não existe (ex.: A46 ímpar, B47 par no piso 1)
      const pP = pit(o.b), zc = zRow(o.b, o.r), mx = Math.max(...o.preds);
      const posicoes = o.face === 'tras' ? Math.ceil((mx - FRENTE[o.b]) / 2) : baia(mx);
      const len = Math.max(1, posicoes) * wB(o.b);
      const z = o.face === 'par' ? zc - .3 * pP : o.face === 'impar' ? zc + .3 * pP : zRow(o.b, 1) - .82 * pP;
      const numTras = o.b === 'A' ? 'ímpar' : 'par';
      const nome = 'Bloco ' + o.b + ' · Rua ' + pad(o.r) + ' · ' + (o.face === 'tras' ? 'parte de trás da longarina' : 'lado ' + (o.face === 'par' ? 'par' : 'ímpar')) + ' · Piso ' + p;
      const faixa = ' · prédios ' + pad(Math.min(...o.preds), 3) + ' a ' + pad(mx, 3);
      itens.push({ x: BL[o.b].x1 - len / 2 - .1, y: (p - 1) * HP, z, w: len - .2, h: .55, d: pP * .34, pct: o.pct,
        tip: () => tipHtml(nome, o, o.np + ' prédios' + faixa + ' · ' + o.n + ' endereços' + (o.face === 'tras' ? '<br>Numeração ' + numTras + ' que continua por trás da longarina' : '') + (o.foraTabela ? '<br>Região "' + o.regiao + '" no WMS: não entra na tabela por piso/bloco' : '')) });
    });
    lote(itens, 'calc', p);
  }
  // vestuário
  lote(ruasVest.map(o => {
    const ps = posVest(o.r), zz = zVest(o.b, o.r, o.np), x = VX0 + (ps.col + .5) * vPit;
    return { x, y: 0, z: (zz[0] + zz[1]) / 2, w: vPit * .62, h: .55, d: zz[1] - zz[0] - .5, pct: o.pct,
      tip: () => tipHtml('Vestuário · Bloco ' + o.b + ' · Rua ' + pad(o.r), o, o.np + ' prédios' + (o.n ? ' · ' + fmtI(o.n) + ' endereços com saldo' : '')) };
  }), 'vest', 1);

  caixa(81, 27, 81.8, 106.5, 0, 4 * HP + 1, 'parede', 'comum', { op: .45, tip: tipInfo('Divisão de módulos do galpão', 'Separa o módulo de vestuário (E, F, G) do de calçados (A, B, C).') });
  // elevador
  // na quebra do bloco A, alinhado à direita (posição definida no editor)
  caixa(92.5, 92, 96.5, 95, 0, 4 * HP + .8, 'estrut', 'calc', { op: OP_ESTR, tip: tipInfo('Elevador', 'Rua A35, prédios 007 a 010 · liga os 4 pisos') });
  // eclusas: 2 colunas × 5 fileiras de pallets (meia eclusa: 1 coluna); a fileira 1 é a mais perto do estoque
  // no chão: faixa amarela de contorno e uma faixa de ponta a ponta dividindo as 2 colunas ao meio
  const pal = [], car = [], faixas = [];
  let semente = 7;
  const sorteio = () => (semente = (semente * 9301 + 49297) % 233280) / 233280;   // fixo: não muda a cada carga
  function eclusa(x0, z0, x1, z1, cols, ocupa, nome, seg, detalhe) {
    const n = cols * 5, cheias = ocupa(n), tip = tipInfo(nome, detalhe + ' · ' + cheias.size + ' de ' + n + ' posições com pallet');
    caixa(x0, z0, x1, z1, 0, .05, 'eclusa', seg, { piso: 1, tip });
    const F = .14, y = .05, h = .03, tf = () => tip;
    faixas.push({ x: (x0 + x1) / 2, y, z: z0 + F / 2, w: x1 - x0, h, d: F, corNome: 'faixa', tip: tf },
                { x: (x0 + x1) / 2, y, z: z1 - F / 2, w: x1 - x0, h, d: F, corNome: 'faixa', tip: tf },
                { x: x0 + F / 2, y, z: (z0 + z1) / 2, w: F, h, d: z1 - z0, corNome: 'faixa', tip: tf },
                { x: x1 - F / 2, y, z: (z0 + z1) / 2, w: F, h, d: z1 - z0, corNome: 'faixa', tip: tf });
    if (cols === 2) faixas.push({ x: (x0 + x1) / 2, y, z: (z0 + z1) / 2, w: F, h, d: z1 - z0, corNome: 'faixa', tip: tf });
    const px = (x1 - x0) / cols, pz = (z1 - z0) / 5, lado = Math.min(px, pz) * .74;
    for (let c = 0; c < cols; c++) for (let l = 0; l < 5; l++) {
      const i = l * cols + c, x = x0 + (c + .5) * px, z = z0 + (l + .5) * pz;
      if (!cheias.has(i)) continue;
      const t = () => tipInfo(nome, 'Posição ' + (i + 1) + ' de ' + n + ' · com pallet');
      pal.push({ x, y: .08, z, w: lado, h: .2, d: lado, corNome: 'pallet', tip: t });
      car.push({ x, y: .28, z, w: lado * .88, h: 1.2, d: lado * .88, corNome: 'carga', tip: t });
    }
  }
  // distribui as eclusas com o mesmo espaço entre elas, de xIni a xFim
  function fileira(xIni, xFim, lista, seg, larg, largMeia, detalhe) {
    const ws = lista.map(([cols]) => cols === 1 ? largMeia : larg), vao = (xFim - xIni - ws.reduce((a, b) => a + b, 0)) / Math.max(1, lista.length - 1);
    let x = xIni;
    lista.forEach(([cols, oc, nome], i) => { eclusa(x, 112, x + ws[i], 122, cols, oc, nome, seg, cols === 1 ? 'Pallets da colmeia' : detalhe); x += ws[i] + vao; });
  }
  const todas = n => new Set([...Array(n).keys()]);
  const vazia = () => new Set();
  const topo = () => new Set([0, 1]);                                    // 1 pallet de cada lado, na fileira junto ao estoque
  const algumas = k => n => { const o = new Set(); while (o.size < Math.min(k, n)) o.add(Math.floor(sorteio() * n)); return o; };
  eclusa(83, 95, 89.5, 106, 2, todas, 'Eclusa de buffer', 'calc', 'Pallets aguardando subir aos pisos');
  // eclusas da frente do galpão (calçados): cada grupo dentro da largura do seu bloco — nenhuma na frente dos corredores entre blocos
  fileira(96.5, BL.A.x1 - .3, [[2, topo, 'Eclusa 1'], [2, vazia, 'Eclusa 2']], 'calc', 4.4, 2.6, 'Frente do bloco A');
  fileira(BL.B.x0 + .3, BL.B.x1 - .3, [[2, algumas(3), 'Eclusa 3'], [2, vazia, 'Eclusa 4'], [2, algumas(3), 'Eclusa 5'],
    [2, vazia, 'Eclusa 6'], [1, algumas(3), 'Meia eclusa da colmeia']], 'calc', 4.4, 2.6, 'Frente do bloco B');
  fileira(BL.C.x0 + .3, BL.C.x1 - .3, [[2, algumas(3), 'Eclusa 7'], [2, algumas(2), 'Eclusa 8'], [2, algumas(3), 'Eclusa 9'],
    [2, vazia, 'Eclusa 10']], 'calc', 4.4, 2.6, 'Frente do bloco C (colmeia)');
  // eclusas do embarque (frente do vestuário)
  fileira(47, 72, [[2, algumas(7), 'Eclusa do embarque 4'], [2, algumas(7), 'Eclusa do embarque 3'], [2, algumas(7), 'Eclusa do embarque 2'],
    [2, algumas(7), 'Eclusa do embarque 1']], 'comum', 4.4, 2.6, 'Pallets para expedição');
  lote(pal, 'comum', 1); lote(car, 'comum', 1); lote(faixas, 'comum', 1);
  // escadas: 2 lances por piso (como em prédio) — sobe meio piso num sentido, patamar, e sobe o resto no sentido contrário
  const degraus = [], barras = [];
  function barra(xa, ya, xb, yb, z, esp) {               // corrimão inclinado entre (xa, ya) e (xb, yb), na altura z
    const len = Math.hypot(xb - xa, yb - ya), m = new THREE.Mesh(new THREE.BoxGeometry(len, esp, esp), new THREE.MeshLambertMaterial());
    m.position.set((xa + xb) / 2, (ya + yb) / 2, z); m.rotation.z = Math.atan2(yb - ya, xb - xa);
    m.userData.baseOp = 1; barras.push(m);
  }
  ESCADAS_B.forEach(r => {
    const x0 = BL.B.x1 - 4 * wB('B'), x1 = BL.B.x1 - 2 * wB('B'), z0 = zRow('B', r - 1) + .1 * pit('B'), z1 = zRow('B', r + 1) - .1 * pit('B');
    const H = 4 * HP + .6, e = .16, tipEsc = tipInfo('Escada', 'Bloco B · rua ' + pad(r) + ' (e longarinas das ruas ' + pad(r - 1) + ' e ' + pad(r + 1) + ') · prédios 005–008 · 2 lances por piso, com patamar');
    [[x0, z0, x1, z0 + e], [x0, z1 - e, x1, z1], [x0, z0, x0 + e, z1], [x1 - e, z0, x1, z1]].forEach(([a, b, c, d]) => caixa(a, b, c, d, 0, H, 'estrut', 'calc', { op: OP_ESTR, tip: tipEsc }));
    const xa = x0 + e, xb = x1 - e, za = z0 + e, zb = z1 - e, zm = (za + zb) / 2, L = 1.4, NS = 8;
    const ri = xa + L, rf = xb - L, dx = (rf - ri) / NS, sobe = HP / 2 / NS, larg = zm - za - .12, AC = .9;
    const zIda = za + larg / 2, zVolta = zb - larg / 2;
    for (let p = 1; p <= 3; p++) {
      const y0 = (p - 1) * HP, ym = y0 + HP / 2, y1 = p * HP;
      for (let s = 0; s < NS; s++) {
        // 1º lance: sobe no sentido do prédio 001 (x crescente), metade de baixo da escada
        degraus.push({ x: ri + (s + .5) * dx, y: y0, z: zIda, w: dx * .97, h: (s + 1) * sobe, d: larg, corNome: 'degrau', tip: () => tipEsc });
        // 2º lance: volta no sentido contrário, do patamar até o piso de cima
        degraus.push({ x: rf - (s + .5) * dx, y: ym, z: zVolta, w: dx * .97, h: (s + 1) * sobe, d: larg, corNome: 'degrau', tip: () => tipEsc });
      }
      // patamar do meio (ponta do prédio 001) e chegada no piso de cima (ponta oposta)
      degraus.push({ x: (rf + xb) / 2, y: ym - .25, z: (za + zb) / 2, w: xb - rf, h: .25, d: zb - za, corNome: 'degrau', tip: () => tipEsc });
      degraus.push({ x: (xa + ri) / 2, y: y1 - .25, z: (za + zb) / 2, w: ri - xa, h: .25, d: zb - za, corNome: 'degrau', tip: () => tipEsc });
      // corrimãos: nas paredes e no meio (entre os dois lances), acompanhando a inclinação
      [za + .08, zm - .02].forEach(z => barra(ri, y0 + AC, rf, ym + AC, z, .07));
      [zm + .02, zb - .08].forEach(z => barra(rf, ym + AC, ri, y1 + AC, z, .07));
      barra(rf, ym + AC, xb - .08, ym + AC, za + .08, .07); barra(rf, ym + AC, xb - .08, ym + AC, zb - .08, .07);   // em volta do patamar
      const mz = new THREE.Mesh(new THREE.BoxGeometry(.07, .07, zb - za - .16), new THREE.MeshLambertMaterial());
      mz.position.set(xb - .08, ym + AC, (za + zb) / 2); mz.userData.baseOp = 1; barras.push(mz);
      // montantes do corrimão do meio
      [[ri, y0], [rf, ym], [ri, y1]].forEach(([x, y]) => degraus.push({ x, y, z: zm, w: .07, h: AC, d: .07, corNome: 'corrimao', tip: () => tipEsc }));
    }
  });
  lote(degraus, 'calc', 0);
  barras.forEach(m => { m.userData.tip = tipInfo('Corrimão', 'Escada do bloco B'); reg(m, 'calc', 0, () => m.material.color.copy(cor('corrimao')), true); });
  // caixas de faturamento
  const fz0 = zRow('C', 19) - pit('C') / 2, fz1 = zRow('C', 20) + pit('C') / 2;
  caixa(BL.C.x0 + .1, fz0, BL.C.x1 - .1, fz1, HP - .1, 3 * HP + .1, 'estrut', 'calc', { op: OP_ESTR, tip: tipInfo('Caixas de faturamento', 'Bloco C · ruas 19–20 · pisos 2 a 4') });
  objs[objs.length - 1].pisos = [2, 3, 4];
  // colmeia
  const exE1 = BL.C.x1 - .1, exE0 = exE1 - .7, xm1 = exE0 - .35, xm0 = xm1 - 1.55, xEsc = xm0 - .25;
  const cz0 = zRow('C', 36) - pit('C') / 2, cz1 = BL.C.z1, NCOL = 16, NNIV = 5, NRUAS = 10, HNIV = .5;
  const rz0 = cz0 + 1, rz1 = cz1 - 1, LCOL = (xEsc - BL.C.x0 - .4) / NCOL, xIni = xEsc - NCOL * LCOL, passoR = (rz1 - rz0) / NRUAS;
  const PROF = passoR * .3, CORR = passoR * .26, esc = [], marcas = [];
  for (let k = 0; k < NRUAS; k++) {
    const zc = rz0 + (k + .5) * passoR, rua = pad(k + 1);
    [-1, 1].forEach((sd, li) => {
      const [num, nomeCor, hexCor] = CORES_COLMEIA[2 * k + li];
      const z = zc + sd * (CORR / 2 + PROF / 2), lado = li ? 'par' : 'ímpar';
      const cab = '<div class="t"><i style="display:inline-block;width:10px;height:10px;border-radius:2px;margin-right:6px;border:1px solid var(--border);background:' + hexCor + '"></i>Colmeia ' + num + '-' + nomeCor;
      for (let c = 0; c < NCOL; c++) for (let n = 1; n <= NNIV; n++) {
        const numEsc = (NNIV - n) * NCOL + c + 1;
        esc.push({ x: xIni + (c + .5) * LCOL, y: (n - 1) * HNIV, z, w: LCOL * .9, h: HNIV * .86, d: PROF, corNome: 'colmeia',
          tip: () => cab + ' · escaninho ' + pad(numEsc) + ' de 80</div><div class="s">Rua ' + rua + ' da colmeia · lado ' + lado + ' · linha ' + (NNIV - n + 1) + ', coluna ' + pad(c + 1) + '</div>' });
      }
      const tipC = () => cab + '</div><div class="s">Rua ' + rua + ' · lado ' + lado + ' · 5 × 16 = 80 escaninhos</div>';
      marcas.push({ x: xIni + NCOL * LCOL / 2, y: NNIV * HNIV, z, w: NCOL * LCOL - .1, h: .09, d: PROF, hex: hexCor, tip: tipC });
      marcas.push({ x: xIni - .07, y: 0, z, w: .1, h: NNIV * HNIV, d: PROF, hex: hexCor, tip: tipC });
    });
    caixa(xm0, zc - passoR * .38, xm1, zc + passoR * .38, .62, .1, 'mesa', 'calc', { piso: 1, tip: tipInfo('Mesa de embalagem · rua ' + rua + ' da colmeia', 'Aprox. 2 m, no fim da rua') });
    [[xm0 + .05, zc - passoR * .34], [xm1 - .2, zc - passoR * .34], [xm0 + .05, zc + passoR * .34 - .15], [xm1 - .2, zc + passoR * .34 - .15]].forEach(([a, b]) => caixa(a, b, a + .15, b + .15, 0, .62, 'perna', 'calc', { piso: 1 }));
  }
  lote(esc, 'calc', 1); lote(marcas, 'calc', 1);
  const tipE = tipInfo('Esteira', 'Contorna a colmeia: lado de dentro, lateral (ao lado das mesas de embalagem) e frente');
  [[exE0, cz0 + .15, exE1, cz1 - .15], [xIni - .3, cz0 + .15, exE1, cz0 + .85], [xIni - .3, cz1 - .85, exE1, cz1 - .15]].forEach(([x0, z0, x1, z1]) => {
    caixa(x0, z0, x1, z1, .62, .12, 'estr', 'calc', { piso: 1, tip: tipE });
    caixa(x0 + .06, z0 + .06, x1 - .06, z1 - .06, .74, .04, 'esteira', 'calc', { piso: 1, tip: tipE });
    const lx = Math.abs(x1 - x0) > Math.abs(z1 - z0);
    for (let t = .4; t < (lx ? x1 - x0 : z1 - z0) - .2; t += 1.6) {
      const a = lx ? x0 + t : x0 + .05, b = lx ? z0 + .05 : z0 + t;
      caixa(a, b, a + .12, b + .12, 0, .62, 'perna', 'calc', { piso: 1 });
      if (lx) caixa(a, z1 - .17, a + .12, z1 - .05, 0, .62, 'perna', 'calc', { piso: 1 });
      else caixa(x1 - .17, b, x1 - .05, b + .12, 0, .62, 'perna', 'calc', { piso: 1 });
    }
  });
  // ---- mesas administrativas com as pessoas (escala: 1 unidade ≈ 1,3 m; o estoque fica "acima", z menor)
  const MZ0 = 113.5, MZ1 = 121.5, MLARG = 1.5;          // mesa de ~2 m × ~10 m, comprida no sentido do estoque
  function pessoa(x, z, dx, dz, nome, coord) {           // (dx, dz) = para onde a pessoa olha (a mesa)
    const tip = tipInfo(nome, coord ? 'Coordenadora, de costas para o estoque' : 'Posto com computador');
    caixa(x - .24, z - .24, x + .24, z + .24, .34, .07, 'cadeira', 'comum');                          // assento
    const bx = x - dx * .26, bz = z - dz * .26;                                                     // encosto atrás
    caixa(bx - (dz ? .24 : .04), bz - (dx ? .24 : .04), bx + (dz ? .24 : .04), bz + (dx ? .24 : .04), .41, .45, 'cadeira', 'comum');
    const tr = new THREE.Mesh(new THREE.CylinderGeometry(.16, .2, .55, 12), new THREE.MeshLambertMaterial());
    tr.position.set(x, .7, z); tr.userData.tip = tip; tr.userData.baseOp = 1;
    reg(tr, 'comum', 0, () => tr.material.color.copy(cor(coord ? 'coord' : 'pessoa')), true);
    const cb = new THREE.Mesh(new THREE.SphereGeometry(.13, 14, 10), new THREE.MeshLambertMaterial());
    cb.position.set(x, 1.12, z); cb.userData.tip = tip; cb.userData.baseOp = 1;
    reg(cb, 'comum', 0, () => cb.material.color.copy(cor('pele')), true);
    // computador na mesa, de frente para a pessoa
    const mx = x + dx * .95, mz = z + dz * .95, larg = .46, esp = .05;
    const [ax, az] = dx ? [esp, larg] : [larg, esp];
    caixa(mx - ax / 2, mz - az / 2, mx + ax / 2, mz + az / 2, .72, .34, 'monitor', 'comum', { tip });
    const sx = mx - dx * .035, sz = mz - dz * .035, [tx, tz] = dx ? [.012, larg - .06] : [larg - .06, .012];
    caixa(sx - tx / 2, sz - tz / 2, sx + tx / 2, sz + tz / 2, .75, .27, 'tela', 'comum');
  }
  function mesa(x0, nome, lados, zLbl, detalhe) {
    const x1 = x0 + MLARG, xc = (x0 + x1) / 2, t = tipInfo(nome, detalhe);
    caixa(x0, MZ0, x1, MZ1, .62, .1, 'mesa', 'comum', { tip: t });
    [[x0 + .1, MZ0 + .1], [x1 - .3, MZ0 + .1], [x0 + .1, MZ1 - .3], [x1 - .3, MZ1 - .3]].forEach(([a, b]) => caixa(a, b, a + .2, b + .2, 0, .62, 'perna', 'comum'));
    pessoa(xc, MZ0 - .6, 0, 1, 'Coordenadora · ' + nome, true);                       // na ponta, de costas para o estoque
    lados.forEach(z => { pessoa(x0 - .6, z, 1, 0, nome, false); pessoa(x1 + .6, z, -1, 0, nome, false); });
    rotulo(nome, xc, 2.2, zLbl, 'comum', 'inf');
  }
  // E-commerce: na frente da eclusa · 5 pessoas de cada lado + coordenadora
  mesa(85, 'ADM E-commerce', [0, 1, 2, 3, 4].map(i => MZ0 + 1.1 + i * 1.45), MZ1 + 3.4, '5 pessoas de cada lado + coordenadora na ponta');
  // Embarque: do outro lado da divisão, na frente do vestuário · coordenadora + 2 de cada lado na ponta oposta
  mesa(77.5, 'ADM Embarque', [MZ1 - 2.1, MZ1 - .8], MZ1 + 1.6, '2 pessoas de cada lado na ponta oposta + coordenadora');
  // rótulos
  ['A', 'B', 'C'].forEach(b => rotulo('BLOCO ' + b, (BL[b].x0 + BL[b].x1) / 2, 3 * HP + 2.2, BL[b].z0 - 5, 'calc', 'big'));
  for (let p = 1; p <= 4; p++) rotulo('PISO ' + p, BL.C.x1 + 3.5, (p - 1) * HP + .4, BL.C.z1 - 1, 'calc', 'big', p);
  rotulo('Rua 01', BL.A.x1 + 1.5, 3 * HP + 1, zRow('A', 0), 'calc');
  rotulo('Rua 47', BL.A.x1 + 1.5, 1, zRow('A', 47), 'calc');
  rotulo('Prédio 001 →', BL.B.x1 - 2, 3 * HP + 1.2, BL.B.z0 - .8, 'calc');
  rotulo('Elevador', 94.5, 4 * HP + 2, 93.5, 'calc', 'inf');
  rotulo('Eclusa', 86.25, 2.8, 100.5, 'calc', 'inf', 1);
  rotulo('Eclusas', (BL.B.x0 + BL.C.x1) / 2, 2.4, 117, 'calc', 'inf', 1);
  rotulo('Eclusas do embarque', 59.75, 2.4, 117, 'comum', 'inf', 1);
  ESCADAS_B.forEach(r => rotulo('Escada', BL.B.x1 - 3 * wB('B'), 4 * HP + 1.6, zRow('B', r), 'calc', 'inf'));
  rotulo('Caixas de faturamento', (BL.C.x0 + BL.C.x1) / 2, 3 * HP + 2.6, (fz0 + fz1) / 2, 'calc', 'inf');
  rotulo('Colmeia', BL.C.x1 - 6, 3.4, cz0 + .6, 'calc', 'inf', 1);
  rotulo('Esteira', exE1 + 2.2, 1.4, (cz0 + cz1) / 2 + 2, 'calc', 'inf', 1);
  rotulo('Divisão de módulos', 81.4, 4 * HP + 2, 30, 'comum', 'inf');
  ['G', 'F', 'E'].forEach(b => {
    rotulo('BLOCO ' + b, VX0 - 5, 1, (VB[b][0][0] + VB[b][1][1]) / 2, 'vest', 'big');
    const np = r => (ruasVest.find(o => o.b === b && o.r === r) || {}).np;
    const zt = zVest(b, 14, np(14)).reduce((a, c) => a + c) / 2, zb = zVest(b, 1, np(1)).reduce((a, c) => a + c) / 2;
    rotulo('14', VX0 - .9, 1, zt, 'vest'); rotulo('26', VX1 + .2, 1, zt, 'vest');
    rotulo('13', VX0 - .9, 1, zb, 'vest'); rotulo('01', VX1 + .2, 1, zb, 'vest');
  });
  rotulo('VESTUÁRIO · PISO 1', (VX0 + VX1) / 2, 1.5, 32.5, 'vest', 'big');

  /* ---------- visibilidade / câmera ---------- */
  function aplica() {
    objs.forEach(o => {
      o.obj.visible = o.seg === 'comum' || ui.modo === 'geral' || o.seg === ui.modo;
      const dim = o.seg !== 'comum' && ui.piso && (o.pisos ? !o.pisos.includes(ui.piso) : (o.piso && o.piso !== ui.piso));
      const m = o.obj.material, op = dim ? .03 : o.obj.userData.baseOp, tr = op < 1;
      if (m.transparent !== tr) { m.transparent = tr; m.depthWrite = !tr; m.needsUpdate = true; }
      m.opacity = op;
    });
    labels.forEach(l => {
      const lp = l.piso || (l.seg === 'vest' ? 1 : 0);
      l.vis = (l.seg === 'comum' || ui.modo === 'geral' || l.seg === ui.modo) && !(ui.piso && lp && lp !== ui.piso) && !(ui.topo && l.piso && /PISO/.test(l.el.textContent));
    });
    kpis(); marcaBotoes();
  }
  function voar(alvo, cam) {
    const ini = { t: controls.target.clone(), c: camera.position.clone() }, t0 = performance.now();
    const dur = window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 0 : 450;
    cancelAnimationFrame(est.voo);
    (function passo(now) {
      const u = dur ? Math.min(1, (now - t0) / dur) : 1, k = u * u * (3 - 2 * u);
      controls.target.lerpVectors(ini.t, alvo, k); camera.position.lerpVectors(ini.c, cam, k); controls.update();
      if (u < 1) est.voo = requestAnimationFrame(passo);
    })(t0);
  }
  function configuraArraste() {
    controls.enableRotate = !ui.topo;   // na Planta, arrastar move a imagem; no 3D, gira
    controls.mouseButtons = { LEFT: ui.topo ? THREE.MOUSE.PAN : THREE.MOUSE.ROTATE, MIDDLE: THREE.MOUSE.DOLLY, RIGHT: THREE.MOUSE.PAN };
    controls.touches = { ONE: ui.topo ? THREE.TOUCH.PAN : THREE.TOUCH.ROTATE, TWO: THREE.TOUCH.DOLLY_PAN };
  }
  function enquadra(animado) {
    const v = VIEWS[ui.modo], alvo = new THREE.Vector3(v.t[0], v.t[1], v.t[2]);
    // telas mais estreitas (ex.: tela cheia num monitor 16:9) afastam a câmera para caber a planta inteira
    const w = stage.clientWidth, h = stage.clientHeight, k = w && h ? Math.max(1, 2.05 / (w / h)) : 1;
    const cam = ui.topo ? new THREE.Vector3(v.t[0], v.top * k, v.t[2] + .01) : new THREE.Vector3(v.t[0] + v.o[0] * k, v.t[1] + v.o[1] * k, v.t[2] + v.o[2] * k);
    est.nivelZoom = 0; configuraArraste();
    if (animado === true) { voar(alvo, cam); return; }
    cancelAnimationFrame(est.voo);
    controls.target.copy(alvo); camera.position.copy(cam); controls.update();
  }
  function tamanho() {
    const w = stage.clientWidth, h = stage.clientHeight; if (!w || !h) return;
    renderer.setSize(w, h, false); camera.aspect = w / h; camera.updateProjectionMatrix();
  }
  const v3 = new THREE.Vector3();
  function loop() {
    est.raf = requestAnimationFrame(loop);
    if (!stage.isConnected) { if (P3.estado === est) destruir(); else cancelAnimationFrame(est.raf); return; }
    if (stage.offsetParent === null) return;        // tela escondida: não desenha
    controls.update(); renderer.render(scene, camera);
    const w = stage.clientWidth, h = stage.clientHeight;
    labels.forEach(l => {
      if (!l.vis) { l.el.style.display = 'none'; return; }
      v3.copy(l.pos).project(camera); const vis = v3.z < 1 && Math.abs(v3.x) < 1.05 && Math.abs(v3.y) < 1.05;
      l.el.style.display = vis ? '' : 'none'; if (vis) { l.el.style.left = ((v3.x + 1) / 2 * w) + 'px'; l.el.style.top = ((1 - v3.y) / 2 * h) + 'px'; }
    });
  }
  const ray = new THREE.Raycaster(), mouse = new THREE.Vector2(), chao = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0), tmp = new THREE.Vector3();
  function raio(ev) {
    const r = cv.getBoundingClientRect();
    mouse.set(((ev.clientX - r.left) / r.width) * 2 - 1, -((ev.clientY - r.top) / r.height) * 2 + 1);
    ray.setFromCamera(mouse, camera);
  }
  function acerto(ev) {
    raio(ev);
    const hits = ray.intersectObjects(objs.filter(o => o.alvo && o.obj.visible && o.obj.material.opacity > .2).map(o => o.obj), false);
    for (const h of hits) {
      if (h.instanceId != null) { const it = h.object.userData.itens[h.instanceId]; if (it && it.tip) return it.tip(); }
      else if (h.object.userData.tip) return h.object.userData.tip;
    }
    return null;
  }
  function pontoSob(ev) {
    raio(ev);
    const hits = ray.intersectObjects(objs.filter(o => o.obj.visible && o.obj.material.opacity > .2).map(o => o.obj), false);
    if (hits.length) return hits[0].point.clone();
    chao.constant = -controls.target.y;
    return ray.ray.intersectPlane(chao, tmp) ? tmp.clone() : null;
  }

  /* ---------- eventos ---------- */
  cv.addEventListener('pointermove', e => { const t = acerto(e); if (t) mostraTip(e.clientX, e.clientY, t); else escondeTip(); });
  cv.addEventListener('pointerleave', escondeTip);
  cv.addEventListener('wheel', e => {          // zoom na direção do ponto sob o mouse
    e.preventDefault();
    const pt = pontoSob(e); if (!pt) return;
    const f = Math.exp(-Math.max(-60, Math.min(60, e.deltaY)) * .0013), k = 1 - 1 / f, dist = camera.position.distanceTo(pt);
    if ((k > 0 && dist * (1 - k) < 3) || (k < 0 && camera.position.distanceTo(controls.target) > 600)) return;
    camera.position.lerp(pt, k); controls.target.lerp(pt, k); controls.update();
  }, { passive: false });
  cv.addEventListener('dblclick', e => {       // 1º e 2º aproximam; o 3º volta à vista original
    if (est.nivelZoom >= 2) { enquadra(true); return; }
    const pt = pontoSob(e); if (!pt) return;
    const off = camera.position.clone().sub(controls.target);
    voar(pt, pt.clone().add(off.multiplyScalar(.45)));
    est.nivelZoom++;
  });
  q('reset').addEventListener('click', () => enquadra(true));
  // tela cheia: Fullscreen API (ocupa o monitor); sem suporte, o card cobre a janela inteira
  const btnTela = q('tela');
  const ICO_ABRE = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5"/></svg>';
  const ICO_FECHA = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M9 4v5H4M15 4v5h5M9 20v-5H4M15 20v-5h5"/></svg>';
  const emTela = () => document.fullscreenElement === container || container.classList.contains('p3-max');
  const rotuloTela = () => { btnTela.innerHTML = emTela() ? ICO_FECHA + 'Sair da tela cheia' : ICO_ABRE + 'Tela cheia'; btnTela.setAttribute('aria-pressed', String(emTela())); };
  // posição da rolagem antes de abrir: ao sair, a página volta exatamente para o heatmap
  let rolagem = null;
  function guardaRolagem() {
    const lista = [{ el: null, top: window.scrollY, left: window.scrollX }];
    for (let el = container.parentElement; el && el !== document.documentElement; el = el.parentElement) {
      if (el.scrollHeight > el.clientHeight || el.scrollWidth > el.clientWidth) lista.push({ el, top: el.scrollTop, left: el.scrollLeft });
    }
    rolagem = lista;
  }
  function voltaRolagem() {
    if (!rolagem) return;
    const r = rolagem;
    const aplica = () => r.forEach(x => { if (x.el) { x.el.scrollTop = x.top; x.el.scrollLeft = x.left; } else window.scrollTo(x.left, x.top); });
    aplica(); requestAnimationFrame(aplica); setTimeout(aplica, 150); setTimeout(() => { aplica(); rolagem = null; }, 400);   // o navegador reajusta a página logo depois de sair
  }
  function aoMudarTela() {
    rotuloTela(); escondeTip();
    if (!emTela()) voltaRolagem();
    setTimeout(() => { tamanho(); enquadra(true); }, 80);
  }
  btnTela.addEventListener('click', async () => {
    if (!emTela()) guardaRolagem();
    let viaClasse = false;   // modo sem Fullscreen API: não dispara "fullscreenchange", então atualiza aqui
    try {
      if (document.fullscreenElement) await document.exitFullscreen();
      else if (container.classList.contains('p3-max')) { container.classList.remove('p3-max'); viaClasse = true; }
      else if (container.requestFullscreen) await container.requestFullscreen({ navigationUI: 'hide' });
      else { container.classList.add('p3-max'); viaClasse = true; }
    } catch (e) { container.classList.toggle('p3-max'); viaClasse = true; }
    if (viaClasse) aoMudarTela();
  });
  document.addEventListener('keydown', e => { if (e.key === 'Escape' && container.classList.contains('p3-max')) { container.classList.remove('p3-max'); aoMudarTela(); } });
  document.addEventListener('fullscreenchange', () => { if (container.isConnected) aoMudarTela(); });
  rotuloTela();
  container.querySelectorAll('[data-m]').forEach(b => b.addEventListener('click', () => { ui.modo = b.dataset.m; aplica(); enquadra(); }));
  container.querySelectorAll('[data-p]').forEach(b => b.addEventListener('click', () => { ui.piso = +b.dataset.p; aplica(); }));
  container.querySelectorAll('[data-v]').forEach(b => b.addEventListener('click', () => { ui.topo = b.dataset.v === 'topo'; aplica(); enquadra(); }));
  container.querySelectorAll('[data-e]').forEach(b => b.addEventListener('click', () => { ui.faixas = b.dataset.e === '1'; desenhaLegenda(); objs.forEach(o => o.pinta && o.pinta()); marcaBotoes(); }));

  aplica(); enquadra();
  if (P3.ui.cam) {                              // re-render (ex.: troca de tema) mantém o ponto de vista
    camera.position.fromArray(P3.ui.cam.p); controls.target.fromArray(P3.ui.cam.t); controls.update(); P3.ui.cam = null;
  }
  est.ro = new ResizeObserver(tamanho); est.ro.observe(stage);
  tamanho(); loop();
};
})();
