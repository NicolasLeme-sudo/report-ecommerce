// mapa-brasil.js — SVG paths dos 27 estados brasileiros
// Cada estado: sigla, nome, path (d), centroX, centroY
var BRASIL_ESTADOS = [
{s:"AC",n:"Acre",cx:88,cy:340,d:"M50,310 L130,310 L130,370 L50,370 Z"},
{s:"AM",n:"Amazonas",cx:190,cy:260,d:"M80,180 L310,180 L310,320 L130,320 L130,310 L80,310 Z"},
{s:"RR",n:"Roraima",cx:200,cy:130,d:"M160,60 L250,60 L250,180 L160,180 Z"},
{s:"AP",n:"Amapá",cx:340,cy:120,d:"M310,60 L380,60 L380,180 L310,180 Z"},
{s:"PA",n:"Pará",cx:380,cy:260,d:"M310,180 L510,180 L510,310 L430,310 L430,340 L310,340 L310,180 Z"},
{s:"MA",n:"Maranhão",cx:530,cy:260,d:"M510,200 L590,200 L590,340 L510,340 L510,310 L510,200 Z"},
{s:"TO",n:"Tocantins",cx:440,cy:390,d:"M400,340 L480,340 L480,470 L400,470 Z"},
{s:"PI",n:"Piauí",cx:560,cy:340,d:"M530,260 L590,260 L590,400 L530,400 Z"},
{s:"CE",n:"Ceará",cx:620,cy:270,d:"M590,230 L670,230 L670,310 L590,310 Z"},
{s:"RN",n:"Rio Grande do Norte",cx:670,cy:270,d:"M660,240 L720,240 L720,280 L660,280 Z"},
{s:"PB",n:"Paraíba",cx:680,cy:300,d:"M640,285 L720,285 L720,320 L640,320 Z"},
{s:"PE",n:"Pernambuco",cx:660,cy:340,d:"M590,320 L720,320 L720,355 L590,355 Z"},
{s:"AL",n:"Alagoas",cx:680,cy:370,d:"M640,358 L720,358 L720,385 L640,385 Z"},
{s:"SE",n:"Sergipe",cx:660,cy:395,d:"M640,388 L700,388 L700,410 L640,410 Z"},
{s:"BA",n:"Bahia",cx:560,cy:430,d:"M480,400 L640,400 L700,410 L700,500 L480,500 Z"},
{s:"MT",n:"Mato Grosso",cx:310,cy:420,d:"M200,340 L400,340 L400,470 L260,470 L200,500 L200,340 Z"},
{s:"GO",n:"Goiás",cx:430,cy:490,d:"M370,470 L500,470 L500,550 L420,550 L370,530 Z"},
{s:"DF",n:"Distrito Federal",cx:470,cy:510,d:"M455,500 L490,500 L490,525 L455,525 Z"},
{s:"MS",n:"Mato Grosso do Sul",cx:290,cy:530,d:"M200,500 L370,500 L370,600 L240,600 L200,560 Z"},
{s:"MG",n:"Minas Gerais",cx:530,cy:540,d:"M420,500 L640,500 L640,590 L480,590 L420,560 Z"},
{s:"ES",n:"Espírito Santo",cx:640,cy:555,d:"M620,520 L680,520 L680,580 L620,580 Z"},
{s:"RJ",n:"Rio de Janeiro",cx:600,cy:605,d:"M540,590 L660,590 L660,625 L540,625 Z"},
{s:"SP",n:"São Paulo",cx:460,cy:610,d:"M370,580 L540,580 L540,650 L370,650 Z"},
{s:"PR",n:"Paraná",cx:400,cy:670,d:"M310,650 L490,650 L490,700 L310,700 Z"},
{s:"SC",n:"Santa Catarina",cx:410,cy:720,d:"M340,700 L480,700 L480,740 L340,740 Z"},
{s:"RS",n:"Rio Grande do Sul",cx:380,cy:775,d:"M300,740 L460,740 L460,820 L300,820 Z"},
{s:"RO",n:"Rondônia",cx:160,cy:380,d:"M130,340 L200,340 L200,420 L130,420 Z"}
];

function renderMapaBrasilSVG(containerId, mapaEstados) {
  var el = document.getElementById(containerId);
  if (!el) return;

  var maxCount = 1;
  BRASIL_ESTADOS.forEach(function(e) {
    var d = mapaEstados[e.s] || mapaEstados[e.n] || {};
    var c = d.count || 0;
    if (c > maxCount) maxCount = c;
  });

  var svgParts = '';
  BRASIL_ESTADOS.forEach(function(e) {
    var dados = mapaEstados[e.s] || mapaEstados[e.n] || {};
    var count = dados.count || 0;
    var pct = count / maxCount;

    // Cor: cinza para 0, gradiente de azul claro → azul escuro
    var fill;
    if (count === 0) {
      fill = 'var(--bg-input)';
    } else {
      var light = Math.round(70 - pct * 45);
      var sat = Math.round(30 + pct * 50);
      fill = 'hsl(215,' + sat + '%,' + light + '%)';
    }

    svgParts += '<path d="' + e.d + '" fill="' + fill + '" stroke="var(--border)" stroke-width="1.5" style="cursor:pointer">';
    svgParts += '<title>' + e.s + ' — ' + e.n + '\n' + count.toLocaleString('pt-BR') + ' reversas</title>';
    svgParts += '</path>';

    // Sigla do estado
    var textFill = count > 0 ? '#fff' : 'var(--text-muted)';
    svgParts += '<text x="' + e.cx + '" y="' + (e.cy - 2) + '" text-anchor="middle" font-size="11" font-weight="700" fill="' + textFill + '" style="pointer-events:none">' + e.s + '</text>';
    // Valor
    if (count > 0) {
      svgParts += '<text x="' + e.cx + '" y="' + (e.cy + 12) + '" text-anchor="middle" font-size="9" fill="#ddd" style="pointer-events:none">' + count.toLocaleString('pt-BR') + '</text>';
    }
  });

  // Legenda
  svgParts += '<defs><linearGradient id="legGrad" x1="0" y1="0" x2="0" y2="1">'
    + '<stop offset="0%" stop-color="hsl(215,80%,25%)"/><stop offset="100%" stop-color="hsl(215,30%,70%)"/>'
    + '</linearGradient></defs>';
  svgParts += '<rect x="740" y="120" width="20" height="160" fill="url(#legGrad)" rx="4" stroke="var(--border)"/>';
  svgParts += '<text x="750" y="110" text-anchor="middle" font-size="10" fill="var(--text-muted)">Reversas</text>';
  svgParts += '<text x="750" y="295" text-anchor="middle" font-size="10" fill="var(--text-muted)">0</text>';
  svgParts += '<text x="750" y="118" text-anchor="middle" font-size="10" fill="var(--text)">' + maxCount.toLocaleString('pt-BR') + '</text>';

  el.innerHTML = '<svg viewBox="0 0 800 860" style="width:100%;max-height:500px" xmlns="http://www.w3.org/2000/svg">' + svgParts + '</svg>';
}
