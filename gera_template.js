const pptxgen = require("pptxgenjs");
const fs = require("fs");
const path = require("path");

const ASSETS = "/root/.claude/skills/synced/32319dee-ead4-4693-b216-0598affd925b_d61a5f3e-0fd7-48b1-9538-87d627b3020c/vulcabras-visual-identity/assets";
const img = (n) => "image/png;base64," + fs.readFileSync(path.join(ASSETS, n)).toString("base64");
const LOGO = img("logo_vulcabras.png");
const FAV = img("favicon.png");
const LOGO_MIZ = img("logo_MIZ.png");
const LOGO_OLY = img("logo_OLY.png");
const LOGO_UA = img("logo_UA.png");

const C = {
  bg: "142032",
  bgDeep: "031F44",
  card: "2C3E52",
  cardSoft: "263748",
  borda: "44576C",
  texto: "FFFFFF",
  apoio: "93A5B8",
  dourado: "F6BD00",
  positivo: "45C645",
  negativo: "C8102E",
  laranja: "E8830D",
  chip: "1B2A3D",
  miz: "DFBD41",
  oly: "297ADF",
  ua: "C8102E",
};

const F = { black: "Segoe UI Black", reg: "Segoe UI", light: "Segoe UI Light" };

const pres = new pptxgen();
pres.layout = "LAYOUT_WIDE"; // 13.3 x 7.5
pres.author = "Vulcabras — Dados & Processos";
pres.company = "Vulcabras";
pres.title = "Template Institucional Vulcabras";

const W = 13.3;
const M = 0.7; // margem lateral

// ---------- helpers ----------
function fundo(slide, cor) {
  slide.background = { color: cor || C.bg };
}

// Marca minimalista (só o "V") — padrão em todos os slides
function logoTopoDireito(slide) {
  slide.addImage({ data: FAV, x: W - M - 0.46, y: 0.4, w: 0.46, h: 0.46 });
}

// Cabeçalho padrão de slide interno: kicker dourado + título + régua fina
function cabecalho(slide, kicker, titulo) {
  slide.addText(kicker.toUpperCase(), {
    x: M, y: 0.42, w: 8, h: 0.24,
    fontFace: F.reg, fontSize: 11, bold: true, charSpacing: 2.4,
    color: C.dourado, isTextBox: true, margin: 0,
  });
  slide.addText(titulo, {
    x: M, y: 0.68, w: 9.6, h: 0.62,
    fontFace: F.black, fontSize: 30, bold: true, color: C.texto,
    isTextBox: true, margin: 0,
  });
  slide.addShape(pres.ShapeType.rect, {
    x: M, y: 1.38, w: 0.85, h: 0.028, fill: { color: C.dourado }, line: { width: 0 },
  });
  logoTopoDireito(slide);
}

function rodape(slide, texto) {
  slide.addText(texto, {
    x: M, y: 6.92, w: 10, h: 0.26,
    fontFace: F.reg, fontSize: 10, color: C.apoio, isTextBox: true, margin: 0,
  });
}

// Card neutro
function card(slide, o) {
  slide.addShape(pres.ShapeType.roundRect, {
    x: o.x, y: o.y, w: o.w, h: o.h, rectRadius: 0.06,
    fill: { color: o.fill || C.card },
    line: { color: o.borda || C.borda, width: 1 },
    shadow: { type: "outer", angle: 90, offset: 0.02, blur: 3, color: "000000", opacity: 0.3 },
  });
}

// ---------- 1. CAPA ----------
{
  const s = pres.addSlide();
  fundo(s, C.bgDeep);
  s.addImage({ data: FAV, x: M, y: 0.85, w: 1.15, h: 1.15 });

  s.addText("REPORT E-COMMERCE", {
    x: M, y: 2.55, w: 9, h: 0.3,
    fontFace: F.reg, fontSize: 13, bold: true, charSpacing: 2.8,
    color: C.dourado, isTextBox: true, margin: 0,
  });
  s.addText("Título da Apresentação", {
    x: M, y: 2.95, w: 10.4, h: 1.1,
    fontFace: F.black, fontSize: 46, bold: true, color: C.texto,
    isTextBox: true, margin: 0,
  });
  s.addShape(pres.ShapeType.rect, {
    x: M, y: 4.18, w: 1.1, h: 0.032, fill: { color: C.dourado }, line: { width: 0 },
  });
  s.addText("Subtítulo com o recorte do período · Área responsável", {
    x: M, y: 4.42, w: 9, h: 0.34,
    fontFace: F.reg, fontSize: 15, color: C.apoio, isTextBox: true, margin: 0,
  });
  s.addText("Extrema/MG · 2026", {
    x: M, y: 6.6, w: 6, h: 0.3,
    fontFace: F.reg, fontSize: 11, color: C.apoio, isTextBox: true, margin: 0,
  });
  s.addNotes("CAPA. Troque o kicker (contexto/report), o título e o subtítulo. Fundo #031F44, marca minimalista (o V) no topo esquerdo. Não mover a régua dourada.");
}

// ---------- 2. ABERTURA DE SEÇÃO ----------
{
  const s = pres.addSlide();
  fundo(s, C.bgDeep);
  logoTopoDireito(s);
  s.addText("SEÇÃO 01", {
    x: M, y: 2.9, w: 6, h: 0.3,
    fontFace: F.reg, fontSize: 13, bold: true, charSpacing: 2.8,
    color: C.dourado, isTextBox: true, margin: 0,
  });
  s.addText("Nome da Seção", {
    x: M, y: 3.28, w: 10.4, h: 0.95,
    fontFace: F.black, fontSize: 40, bold: true, color: C.texto,
    isTextBox: true, margin: 0,
  });
  s.addShape(pres.ShapeType.rect, {
    x: M, y: 4.32, w: 1.1, h: 0.032, fill: { color: C.dourado }, line: { width: 0 },
  });
  s.addText("Uma linha dizendo o que esta seção responde.", {
    x: M, y: 4.55, w: 9, h: 0.34,
    fontFace: F.reg, fontSize: 14, color: C.apoio, isTextBox: true, margin: 0,
  });
  s.addNotes("ABERTURA DE SEÇÃO. Duplique este slide para cada seção e ajuste o número no kicker.");
}

// ---------- 3. KPI HERO + TILES ----------
{
  const s = pres.addSlide();
  fundo(s);
  cabecalho(s, "Resultado consolidado", "Números do período");

  // KPI hero
  card(s, { x: M, y: 1.85, w: 5.2, h: 2.2 });
  s.addText("VALOR DE ESTOQUE", {
    x: M + 0.35, y: 2.12, w: 4.5, h: 0.26,
    fontFace: F.reg, fontSize: 11, bold: true, charSpacing: 2, color: C.apoio,
    isTextBox: true, margin: 0,
  });
  s.addText("R$ 127,2 mi", {
    x: M + 0.32, y: 2.45, w: 4.6, h: 0.95,
    fontFace: F.light, fontSize: 48, color: C.texto, isTextBox: true, margin: 0,
  });
  s.addText("▲ 4,1% vs. extração anterior", {
    x: M + 0.35, y: 3.44, w: 4.5, h: 0.3,
    fontFace: F.reg, fontSize: 13, bold: true, color: C.positivo,
    isTextBox: true, margin: 0,
  });

  // 4 tiles
  const tiles = [
    { r: "DISPONÍVEL P/ VENDA", v: "94,7%", d: "R$ 120,5 mi livres", c: C.positivo },
    { r: "BLOQUEADO / ANÁLISE", v: "5,3%", d: "R$ 6,7 mi travados", c: C.negativo },
    { r: "SKUs COM ESTOQUE", v: "3.009", d: "21 famílias ativas", c: C.apoio },
    { r: "BACKLOG 3+ DIAS", v: "1.284", d: "▼ meta 800 pedidos", c: C.negativo },
  ];
  const tx = M + 5.5, tw = 3.2, th = 1.02;
  tiles.forEach((t, i) => {
    const x = tx + (i % 2) * (tw + 0.28);
    const y = 1.85 + Math.floor(i / 2) * (th + 0.16);
    card(s, { x, y, w: tw, h: th });
    s.addText(t.r, {
      x: x + 0.22, y: y + 0.14, w: tw - 0.4, h: 0.22,
      fontFace: F.reg, fontSize: 9, bold: true, charSpacing: 1.4, color: C.apoio,
      isTextBox: true, margin: 0,
    });
    s.addText(t.v, {
      x: x + 0.2, y: y + 0.36, w: tw - 0.4, h: 0.4,
      fontFace: F.light, fontSize: 24, color: C.texto, isTextBox: true, margin: 0,
    });
    s.addText(t.d, {
      x: x + 0.22, y: y + 0.75, w: tw - 0.4, h: 0.22,
      fontFace: F.reg, fontSize: 9.5, color: t.c, isTextBox: true, margin: 0,
    });
  });

  // faixa de insight
  card(s, { x: M, y: 4.32, w: 11.9, h: 1.1, fill: C.cardSoft, borda: C.dourado });
  s.addText("LEITURA", {
    x: M + 0.32, y: 4.5, w: 2, h: 0.22,
    fontFace: F.reg, fontSize: 9.5, bold: true, charSpacing: 1.8, color: C.dourado,
    isTextBox: true, margin: 0,
  });
  s.addText("Escreva aqui o insight — o que o número significa e qual decisão ele pede. Slide sem insight é slide de anexo.", {
    x: M + 0.32, y: 4.76, w: 11.2, h: 0.5,
    fontFace: F.reg, fontSize: 13, color: C.texto, isTextBox: true, margin: 0,
  });

  rodape(s, "Fonte: extração EX000796 · 25/08/2026 17:00");
  s.addNotes("SLIDE DE KPI. Um número hero à esquerda, até quatro tiles à direita, faixa de leitura embaixo. Verde só para positivo, vermelho só para negativo.");
}

// ---------- 4. CARDS DE MARCA ----------
{
  const s = pres.addSlide();
  fundo(s);
  cabecalho(s, "Desempenho por marca", "Participação no estoque");

  const marcas = [
    { nome: "MIZUNO", cor: C.miz, txt: "142032", logo: LOGO_MIZ, valor: "R$ 68,9 mi", part: "54,1% do estoque", delta: "▲ 2,4 p.p.", dc: C.positivo },
    { nome: "UNDER ARMOUR", cor: C.ua, txt: "FFFFFF", logo: LOGO_UA, valor: "R$ 32,3 mi", part: "25,4% do estoque", delta: "▼ 1,1 p.p.", dc: C.negativo },
    { nome: "OLYMPIKUS", cor: C.oly, txt: "FFFFFF", logo: LOGO_OLY, valor: "R$ 26,1 mi", part: "20,5% do estoque", delta: "▲ 0,3 p.p.", dc: C.positivo },
  ];
  const cw = 3.78, gap = 0.28;
  marcas.forEach((m, i) => {
    const x = M + i * (cw + gap);
    const y = 1.95;
    // corpo
    slideCard(s, x, y, cw, 3.5, m.cor);
    // header sólido
    s.addShape(pres.ShapeType.rect, {
      x, y, w: cw, h: 0.52, fill: { color: m.cor }, line: { width: 0 },
    });
    s.addText(m.nome, {
      x, y: y + 0.09, w: cw, h: 0.34,
      fontFace: F.reg, fontSize: 13, bold: true, charSpacing: 1.6, color: m.txt,
      align: "center", isTextBox: true, margin: 0,
    });
    s.addImage({ data: m.logo, x: x + cw / 2 - 0.75, y: y + 0.85, w: 1.5, h: 0.5, sizing: { type: "contain", w: 1.5, h: 0.5 } });
    s.addText(m.valor, {
      x: x + 0.25, y: y + 1.6, w: cw - 0.5, h: 0.55,
      fontFace: F.light, fontSize: 28, color: C.texto, align: "center", isTextBox: true, margin: 0,
    });
    s.addText(m.part, {
      x: x + 0.25, y: y + 2.18, w: cw - 0.5, h: 0.3,
      fontFace: F.reg, fontSize: 12, color: C.apoio, align: "center", isTextBox: true, margin: 0,
    });
    s.addText(m.delta, {
      x: x + 0.25, y: y + 2.62, w: cw - 0.5, h: 0.3,
      fontFace: F.reg, fontSize: 13, bold: true, color: m.dc, align: "center", isTextBox: true, margin: 0,
    });
  });

  rodape(s, "Cards de marca: header sólido na cor da marca, corpo neutro, borda fina na mesma cor.");
  s.addNotes("CARDS DE MARCA. Cor da marca identifica marca e mais nada — não usar como paleta categórica genérica.");
}

function slideCard(s, x, y, w, h, borda) {
  s.addShape(pres.ShapeType.roundRect, {
    x, y, w, h, rectRadius: 0.05,
    fill: { color: C.card }, line: { color: borda || C.borda, width: 1 },
  });
}

// ---------- 5. GRÁFICO ----------
{
  const s = pres.addSlide();
  fundo(s);
  cabecalho(s, "Evolução mensal", "Expedição × Forecast");

  s.addChart(
    pres.ChartType.bar,
    [
      {
        name: "Expedido",
        labels: ["Mar", "Abr", "Mai", "Jun", "Jul", "Ago"],
        values: [182000, 196500, 204300, 188700, 221400, 236900],
      },
      {
        name: "Forecast",
        labels: ["Mar", "Abr", "Mai", "Jun", "Jul", "Ago"],
        values: [190000, 195000, 200000, 205000, 215000, 230000],
      },
    ],
    {
      x: M, y: 1.85, w: 7.6, h: 4.5,
      chartColors: [C.oly, C.apoio],
      showTitle: false,
      showLegend: true,
      legendPos: "b",
      legendColor: C.apoio,
      legendFontSize: 11,
      legendFontFace: F.reg,
      catAxisLabelColor: C.apoio,
      catAxisLabelFontSize: 11,
      catAxisLabelFontFace: F.reg,
      valAxisLabelColor: C.apoio,
      valAxisLabelFontSize: 10,
      valAxisLabelFontFace: F.reg,
      valGridLine: { color: C.borda, size: 1 },
      catGridLine: { style: "none" },
      barGapWidthPct: 55,
      chartArea: { fill: { color: C.bg } },
      plotArea: { fill: { color: C.bg } },
    }
  );

  // leitura lateral
  card(s, { x: M + 7.95, y: 1.85, w: 3.95, h: 4.5, fill: C.cardSoft });
  s.addText("O QUE O GRÁFICO DIZ", {
    x: M + 8.22, y: 2.1, w: 3.4, h: 0.24,
    fontFace: F.reg, fontSize: 9.5, bold: true, charSpacing: 1.8, color: C.dourado,
    isTextBox: true, margin: 0,
  });
  s.addText(
    [
      { text: "Agosto fechou 3% acima do forecast, o melhor mês do período.", options: { bullet: true, breakLine: true } },
      { text: "Junho é a única queda — coincide com a parada de inventário.", options: { bullet: true, breakLine: true } },
      { text: "A tendência sustenta a meta de 240 mil para setembro.", options: { bullet: true } },
    ],
    {
      x: M + 8.22, y: 2.45, w: 3.42, h: 2.6,
      fontFace: F.reg, fontSize: 12.5, color: C.texto,
      paraSpaceAfter: 10, isTextBox: true, margin: 0,
    }
  );
  rodape(s, "Fonte: dashboard Report E-commerce · seção Outbound");
  s.addNotes("SLIDE DE GRÁFICO. Gráfico nativo do PowerPoint (editável), leitura em texto ao lado. Cor: azul institucional para a série principal, cinza de apoio para o comparativo.");
}

// ---------- 6. TABELA ----------
{
  const s = pres.addSlide();
  fundo(s);
  cabecalho(s, "Detalhamento", "Estoque por armazém");

  const cabLinha = ["Armazém", "Situação", "Quantidade", "Valor", "% do total"].map((t) => ({
    text: t,
    options: {
      fill: { color: C.chip }, color: C.apoio, bold: true, fontSize: 10,
      fontFace: F.reg, charSpacing: 1, align: "left", valign: "middle",
    },
  }));

  const dados = [
    ["AC190", "Disponível", "2.834.432", "R$ 120.514.650,87", "94,7%"],
    ["ARMRP", "Bloqueado", "77.662", "R$ 4.997.283,39", "3,9%"],
    ["ARAMO", "Em análise", "13.957", "R$ 1.369.869,23", "1,1%"],
    ["DEVFT", "Bloqueado", "3.848", "R$ 269.372,02", "0,2%"],
    ["ARMFT", "Em análise", "1.737", "R$ 41.268,88", "0,0%"],
  ];
  const corSituacao = { "Disponível": C.positivo, "Bloqueado": C.negativo, "Em análise": C.laranja };

  const linhas = [cabLinha];
  dados.forEach((d) => {
    linhas.push(
      d.map((v, i) => ({
        text: v,
        options: {
          fill: { color: C.card }, color: i === 1 ? corSituacao[v] : C.texto,
          bold: i === 1, fontSize: 11, fontFace: F.reg, valign: "middle",
          align: i >= 2 ? "right" : "left",
        },
      }))
    );
  });
  linhas.push(
    ["TOTAL GERAL", "", "2.931.823", "R$ 127.199.303,46", "100%"].map((v, i) => ({
      text: v,
      options: {
        fill: { color: C.chip }, color: C.texto, bold: true, fontSize: 11,
        fontFace: F.reg, valign: "middle", align: i >= 2 ? "right" : "left",
      },
    }))
  );

  s.addTable(linhas, {
    x: M, y: 1.9, w: 11.9,
    colW: [2.3, 2.2, 2.4, 3.4, 1.6],
    rowH: 0.42,
    border: { type: "solid", color: C.borda, pt: 1 },
    margin: 0.08,
  });

  rodape(s, "Linha de total sempre destacada explicitamente — nunca só por ser a última linha.");
  s.addNotes("SLIDE DE TABELA. Cabeçalho em #1B2A3D, números alinhados à direita, situação colorida pela semântica (verde/âmbar/vermelho), total destacado.");
}

// ---------- 7. GUIA RÁPIDO: PALETA E TIPOGRAFIA ----------
{
  const s = pres.addSlide();
  fundo(s);
  cabecalho(s, "Referência", "Paleta e tipografia do template");

  const cores = [
    ["--bg", "142032", "Fundo"],
    ["--bg-deep", "031F44", "Capa / seção"],
    ["--card-bg", "2C3E52", "Card"],
    ["--card-border", "44576C", "Borda"],
    ["--accent-gold", "F6BD00", "Kicker / régua"],
    ["--positive", "45C645", "Positivo"],
    ["--negative", "C8102E", "Negativo"],
    ["--laranja", "E8830D", "Atenção"],
    ["--text-secondary", "93A5B8", "Apoio"],
    ["--brand-miz", "DFBD41", "Mizuno"],
    ["--brand-oly", "297ADF", "Olympikus"],
    ["--brand-ua", "C8102E", "Under Armour"],
  ];
  const cw = 1.86, ch = 1.0, gap = 0.16;
  cores.forEach((c, i) => {
    const x = M + (i % 6) * (cw + gap);
    const y = 1.95 + Math.floor(i / 6) * (ch + 0.55);
    s.addShape(pres.ShapeType.rect, { x, y, w: cw, h: 0.46, fill: { color: c[1] }, line: { width: 0 } });
    s.addText(c[0], {
      x, y: y + 0.52, w: cw, h: 0.22,
      fontFace: F.reg, fontSize: 9.5, bold: true, color: C.texto, isTextBox: true, margin: 0,
    });
    s.addText("#" + c[1] + " · " + c[2], {
      x, y: y + 0.73, w: cw, h: 0.22,
      fontFace: F.reg, fontSize: 8.5, color: C.apoio, isTextBox: true, margin: 0,
    });
  });

  card(s, { x: M, y: 5.05, w: 11.9, h: 1.55, fill: C.cardSoft });
  s.addText("TIPOGRAFIA", {
    x: M + 0.32, y: 5.24, w: 3, h: 0.24,
    fontFace: F.reg, fontSize: 9.5, bold: true, charSpacing: 1.8, color: C.dourado,
    isTextBox: true, margin: 0,
  });
  s.addText("Segoe UI Black — títulos", {
    x: M + 0.32, y: 5.55, w: 3.8, h: 0.4,
    fontFace: F.black, fontSize: 17, bold: true, color: C.texto, isTextBox: true, margin: 0,
  });
  s.addText("Segoe UI — corpo, labels e valores de card", {
    x: M + 4.3, y: 5.6, w: 4.2, h: 0.4,
    fontFace: F.reg, fontSize: 13, color: C.texto, isTextBox: true, margin: 0,
  });
  s.addText("Segoe UI Light — 127,2", {
    x: M + 8.6, y: 5.5, w: 3.1, h: 0.5,
    fontFace: F.light, fontSize: 22, color: C.texto, isTextBox: true, margin: 0,
  });
  s.addText("Títulos 30–46pt · seção 20–24pt · corpo 13–16pt · legenda 9–11pt", {
    x: M + 0.32, y: 6.12, w: 11.2, h: 0.3,
    fontFace: F.reg, fontSize: 11, color: C.apoio, isTextBox: true, margin: 0,
  });
  s.addNotes("REFERÊNCIA. Slide de consulta — apagar antes de apresentar. Cores no pptxgenjs sempre sem # e com 6 dígitos.");
}

// ---------- 8. COMO USAR ----------
{
  const s = pres.addSlide();
  fundo(s, C.bgDeep);
  cabecalho(s, "Instruções", "Como usar este template");

  const blocos = [
    { n: "1", t: "Duplique, não recrie", d: "Copie o slide do tipo que precisa (capa, seção, KPI, marca, gráfico, tabela) e troque só o conteúdo." },
    { n: "2", t: "Um assunto por slide", d: "Se precisa de duas réguas douradas, são dois slides. Contexto → dado → insight." },
    { n: "3", t: "Cor tem significado", d: "Verde só positivo, vermelho só negativo, âmbar atenção. Dourado é marca, nunca KPI." },
    { n: "4", t: "Apague a referência", d: "O slide 7 é consulta interna. Remova-o antes de apresentar." },
  ];
  const bw = 5.8, bh = 1.6;
  blocos.forEach((b, i) => {
    const x = M + (i % 2) * (bw + 0.3);
    const y = 1.95 + Math.floor(i / 2) * (bh + 0.3);
    card(s, { x, y, w: bw, h: bh, fill: C.card });
    s.addShape(pres.ShapeType.ellipse, {
      x: x + 0.3, y: y + 0.32, w: 0.46, h: 0.46,
      fill: { color: C.dourado }, line: { width: 0 },
    });
    s.addText(b.n, {
      x: x + 0.3, y: y + 0.38, w: 0.46, h: 0.34,
      fontFace: F.reg, fontSize: 14, bold: true, color: C.bgDeep, align: "center",
      isTextBox: true, margin: 0,
    });
    s.addText(b.t, {
      x: x + 0.95, y: y + 0.3, w: bw - 1.3, h: 0.34,
      fontFace: F.reg, fontSize: 15, bold: true, color: C.texto, isTextBox: true, margin: 0,
    });
    s.addText(b.d, {
      x: x + 0.95, y: y + 0.68, w: bw - 1.25, h: 0.75,
      fontFace: F.reg, fontSize: 12, color: C.apoio, isTextBox: true, margin: 0,
    });
  });

  s.addText("Manual completo: PADRAO-VULCABRAS.md — nos repositórios report-ecommerce, report-DISTR e Inventario---Dashboard.", {
    x: M, y: 6.5, w: 11.9, h: 0.3,
    fontFace: F.reg, fontSize: 11, color: C.dourado, isTextBox: true, margin: 0,
  });
  s.addNotes("INSTRUÇÕES. Slide de apoio ao time — também pode ser apagado antes de apresentar.");
}

const saida = process.argv[2];
pres.writeFile({ fileName: saida }).then(() => console.log("ok:", saida));
