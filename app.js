/* Presviz · PWA local-first con sincronización en línea (Firebase) cuando hay sesión iniciada. */
(function () {
  'use strict';
  const KEY = 'nuestra-plata.v1';
  const $ = (s, el = document) => el.querySelector(s);
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const fmt = new Intl.NumberFormat('es-PE', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const fmt0 = new Intl.NumberFormat('es-PE', { maximumFractionDigits: 0 });
  const S = (n) => (n < 0 ? '-' : '') + 'S/ ' + fmt.format(Math.abs(n || 0));
  const S0 = (n) => (n < 0 ? '-' : '') + 'S/ ' + fmt0.format(Math.abs(n || 0));
  const MES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'setiembre', 'octubre', 'noviembre', 'diciembre'];
  const MES3 = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'set', 'oct', 'nov', 'dic'];

  // ---------- estado ----------
  let st = load();
  function blank() { return { plan: null, paid: {}, bal: {}, real: {}, days: {}, amt: {}, wish: {}, cap: null, me: '', theme: 'auto', fx: null, prepago: null, pw: '' }; }
  function load() {
    try { const raw = localStorage.getItem(KEY); if (raw) return Object.assign(blank(), JSON.parse(raw)); } catch (e) { /* sin storage */ }
    return blank();
  }
  function save() { try { localStorage.setItem(KEY, JSON.stringify(st)); } catch (e) { toast('No se pudo guardar en este dispositivo'); } }
  const stamp = (v) => ({ v, t: Date.now(), by: st.me || '' });
  function setK(bucket, key, v) { st[bucket][key] = stamp(v); save(); cloudPush(bucket, key, st[bucket][key]); }
  const getV = (bucket, key) => (st[bucket][key] && st[bucket][key].v !== null ? st[bucket][key].v : undefined);
  const BUCKETS = ['paid', 'bal', 'real', 'days', 'amt', 'wish'];

  // ---------- helpers del plan ----------
  const P = () => st.plan;
  const today = new Date();
  const ym = (d) => d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0');
  let tab = 'inicio';
  let mi = 0; // índice de mes
  function initMonth() {
    const ms = P().months, cur = ym(today);
    const i = ms.indexOf(cur);
    mi = i >= 0 ? i : cur < ms[0] ? 0 : ms.length - 1;
  }
  const monthName = (k) => { const [y, m] = k.split('-').map(Number); return MES[m - 1] + ' ' + y; };
  const shortDate = (d) => d.getDate() + ' ' + MES3[d.getMonth()];
  const sum = (a) => a.reduce((x, y) => x + (+y || 0), 0);
  const fx = () => st.fx || (P() ? P().fx : 3.45);

  function monthCalc(i) {
    const p = P(), m = p.metas;
    const ing = sum(p.ingresos.map((r) => r.vals[i]));
    const gas = sum(p.gastos.flatMap((g) => g.items.map((it) => it.vals[i])));
    const metas = m.amort[i] + m.viaje[i] + m.tec[i];
    const personal = m.sof[i] + m.ren[i];
    const reserva = m.reserva[i];
    return { ing, gas, metas, personal, reserva, sof: m.sof[i], ren: m.ren[i], libre: ing - gas - metas - personal - reserva };
  }
  function bolsaPlan(b, i) { // saldo plan al cierre del mes i
    let s = b.ini;
    for (let k = 0; k <= i; k++) {
      s += b.aporte[k] || 0;
      const r = b.retiros[P().months[k]];
      if (r === 'ALL') s = 0; else s -= r || 0;
    }
    return s;
  }
  const retiroMes = (b, i) => { const r = b.retiros[P().months[i]]; return r === 'ALL' ? bolsaPlan(b, i - 1) + b.aporte[i] : r || 0; };

  function pagosMes(i) {
    const p = P(), k = p.months[i], [y, m] = k.split('-').map(Number);
    const dim = new Date(y, m, 0).getDate();
    const out = [];
    for (const pg of p.pagos) {
      let amount;
      if (pg.amounts === null) {
        if (pg.id === 'transfer') amount = sum(p.bolsas.map((b) => b.aporte[i]));
        else amount = getV('amt', k + '|' + pg.id);
      } else if (pg.amounts[k] !== undefined) amount = pg.amounts[k];
      else continue;
      const day = getV('days', pg.id) ?? pg.day;
      const date = day ? new Date(y, m - 1, Math.min(day, dim)) : null;
      const key = k + '|' + pg.id;
      out.push({ ...pg, amount, day, date, key, paid: !!getV('paid', key), income: pg.from === 'ingreso' });
    }
    out.sort((a, b) => (a.date ? a.date - 0 : 9e15) - (b.date ? b.date - 0 : 9e15));
    return out;
  }
  const startOfToday = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  function statusPill(x) {
    if (x.paid) return `<span class="pill ok">${x.income ? 'Recibido' : 'Hecho'}</span>`;
    if (!x.date) return '<span class="pill gray">Sin fecha</span>';
    const d = Math.round((x.date - startOfToday) / 864e5);
    if (d < 0) return `<span class="pill danger">Venció hace ${-d} d</span>`;
    if (d === 0) return '<span class="pill warn">Hoy</span>';
    if (d <= 7) return `<span class="pill warn">En ${d} d</span>`;
    return `<span class="pill gray">${shortDate(x.date)}</span>`;
  }

  // ---------- hipotecario ----------
  function simHip(capital, prepago) {
    const h = P().hip, i = Math.pow(1 + h.tea, 1 / 12) - 1, pay = h.cuota - h.seguros;
    let b = capital, n = 0, it = 0, d = new Date(today.getFullYear(), today.getMonth() + (today.getDate() > 5 ? 1 : 0), 5);
    while (b > 0.01 && n < 400) {
      const m = d.getMonth() + 1;
      const x = b * i; b -= Math.min(pay * (m === 1 || m === 8 ? 2 : 1) - x, b); it += x; n++;
      if (m === 9 && prepago) b -= Math.min(prepago, b);
      if (b > 0.01) d = new Date(d.getFullYear(), d.getMonth() + 1, 5);
    }
    return { n, interes: it, fin: d };
  }

  // ---------- render ----------
  const view = $('#view');
  function render() {
    applyTheme();
    document.querySelectorAll('#tabs button').forEach((b) => b.classList.toggle('on', b.dataset.tab === tab));
    if (!P()) { $('#monthNav').style.visibility = 'hidden'; view.innerHTML = onboarding(); bindOnboarding(); return; }
    $('#monthNav').style.visibility = tab === 'metas' ? 'hidden' : 'visible';
    $('#monthLabel').textContent = monthName(P().months[mi]);
    $('#prevMonth').disabled = mi === 0; $('#nextMonth').disabled = mi === P().months.length - 1;
    view.innerHTML = ({ inicio, pagos, bolsas, metas, presupuesto })[tab]();
  }

  function onboarding() {
    return `<div class="card empty">
      <img src="icons/icon-192.png" width="72" height="72" alt="" style="border-radius:18px">
      <h1>Hola 👋</h1>
      <p class="muted">Para abrir su plan, ingresa la <b>clave</b> que te pasó Sofía.</p>
      <p class="small muted">El plan viene cifrado. Lo que anoten se guarda solo en este celular.</p>
      <div class="btns" style="justify-content:center;margin-top:14px"><button class="btn primary" data-act="unlock">Ingresar clave</button><button class="btn" data-act="import">Cargar archivo</button></div>
    </div>`;
  }
  function bindOnboarding() { /* acciones por delegación */ }

  function inicio() {
    const c = monthCalc(mi), k = P().months[mi];
    const personalNote = 'Para salidas, delivery y tienditas. Lo que no gastes es tu ahorro.';
    let h = `<h2>Libre para cada uno · ${esc(monthName(k))}</h2>
    <div class="grid2">
      <div class="person p-sofia"><div class="who">Sofía</div><div class="amt">${S0(c.sof)}</div><div class="sub">${personalNote}</div></div>
      <div class="person p-renan"><div class="who">Renán</div><div class="amt">${S0(c.ren)}</div><div class="sub">${personalNote}</div></div>
    </div>`;
    // próximos pagos
    const lst = [];
    for (let j = Math.max(0, mi - 1); j <= Math.min(P().months.length - 1, mi + 1); j++) lst.push(...pagosMes(j));
    const prox = lst.filter((x) => !x.paid && x.date && (x.date - startOfToday) / 864e5 <= 21 && (x.date - startOfToday) / 864e5 >= -45).slice(0, 8);
    h += `<h2>Próximos pagos</h2><div class="card">`;
    h += prox.length ? prox.map((x) => payRow(x, true)).join('') : '<div class="muted small">Nada pendiente en las próximas 3 semanas 🎉</div>';
    h += `<button class="btn link" data-go="pagos">Ver todos los pagos del mes →</button></div>`;
    // resumen
    h += `<h2>Resumen del mes</h2><div class="card">
      <div class="kv"><span>Ingresos</span><span class="num">${S(c.ing)}</span></div>
      <div class="kv"><span>Gastos del hogar <span class="muted small">(incluye lo que va a Anuales)</span></span><span class="num">−${S(c.gas)}</span></div>
      <div class="kv"><span>Metas (prepago, viaje, tecnología)</span><span class="num">−${S(c.metas)}</span></div>
      <div class="kv"><span>Dinero personal (Sofía + Renán)</span><span class="num">−${S(c.personal)}</span></div>
      ${c.reserva ? `<div class="kv"><span>${c.reserva > 0 ? 'Reserva cuota doble (se guarda)' : 'Reserva cuota doble (se usa)'}</span><span class="num">${c.reserva > 0 ? '−' : '+'}${S(Math.abs(c.reserva))}</span></div>` : ''}
      <div class="kv total"><span>Queda libre en la cuenta común</span><span class="num">${S(c.libre)}</span></div>
    </div>`;
    // metas mini
    const pre = P().bolsas.find((b) => b.id === 'prepago');
    const preSaldo = getV('bal', 'prepago') ?? bolsaPlan(pre, mi);
    const pct = Math.min(100, (preSaldo / pre.goal) * 100);
    const cap = st.cap ? st.cap.v : P().hip.capital;
    const sim = simHip(cap, st.prepago ?? P().hip.prepagoAnual);
    h += `<h2>Meta hipotecario</h2><div class="card">
      <div class="row"><div class="grow"><div class="t">Prepago de setiembre</div><div class="s">${S0(preSaldo)} de ${S0(pre.goal)}</div></div><span class="pill">${fmt0.format(pct)}%</span></div>
      <div class="bar"><i style="width:${pct}%"></i></div>
      <div class="small muted">Con ${S0(st.prepago ?? P().hip.prepagoAnual)} cada setiembre terminan en <b>${MES[sim.fin.getMonth()]} ${sim.fin.getFullYear()}</b> · meta: enero 2040</div>
    </div>`;
    return h;
  }

  function payRow(x, showMonth) {
    const amt = x.amount === undefined ? '<button class="edit" data-act="amt" data-key="' + esc(x.key) + '" data-id="' + esc(x.id) + '">Monto</button>' : `<span class="num">${x.income ? '+' : ''}${S(x.amount)}</span>`;
    const when = x.date ? (showMonth ? shortDate(x.date) : 'Día ' + x.date.getDate()) : '<button class="edit" data-act="day" data-id="' + esc(x.id) + '">Fijar día</button>';
    return `<div class="row ${x.paid ? 'done' : ''}">
      <input type="checkbox" class="check" data-act="paid" data-key="${esc(x.key)}" ${x.paid ? 'checked' : ''} aria-label="Marcar ${esc(x.name)}">
      <div class="grow"><div class="t">${esc(x.name)}</div><div class="s">${when} · ${esc(x.from)}${x.note ? ' · ' + esc(x.note) : ''}</div></div>
      <div style="text-align:right">${amt}<div>${statusPill(x)}</div></div>
    </div>`;
  }

  function pagos() {
    const lst = pagosMes(mi);
    const salidas = lst.filter((x) => !x.income);
    const hechos = salidas.filter((x) => x.paid).length;
    const pend = sum(salidas.filter((x) => !x.paid && x.amount !== undefined).map((x) => x.amount));
    let h = `<h2>${esc(monthName(P().months[mi]))}</h2>
      <div class="card"><div class="row"><div class="grow"><div class="t">${hechos} de ${salidas.length} pagos hechos</div><div class="s">Pendiente: ${S(pend)}</div></div></div>
      <div class="bar"><i style="width:${salidas.length ? (hechos / salidas.length) * 100 : 0}%"></i></div></div>`;
    const conFecha = lst.filter((x) => x.date), sinFecha = lst.filter((x) => !x.date);
    h += `<div class="card">${conFecha.map((x) => payRow(x, false)).join('') || '<span class="muted">—</span>'}</div>`;
    if (sinFecha.length) h += `<h2>Sin fecha fija</h2><div class="card">${sinFecha.map((x) => payRow(x, false)).join('')}</div><p class="note">Toca “Fijar día” para que aparezcan en Próximos pagos.</p>`;
    return h;
  }

  function bolsas() {
    const i = mi, k = P().months[i];
    const tot = sum(P().bolsas.map((b) => b.aporte[i]));
    let h = `<h2>Transferir el día 30 · ${esc(monthName(k))}</h2><div class="card"><div class="row"><div class="grow"><div class="t">Total a transferir</div><div class="s">Apenas llegue el sueldo</div></div><span class="big num">${S(tot)}</span></div></div>`;
    h += '<h2>Bolsas</h2>';
    for (const b of P().bolsas) {
      const plan = bolsaPlan(b, i), ret = retiroMes(b, i), real = st.bal[b.id];
      const goal = b.goal ? `<div class="bar"><i style="width:${Math.max(0, Math.min(100, ((real ? real.v : plan) / b.goal) * 100))}%;background:${b.color}"></i></div><div class="small muted">Meta: ${S0(b.goal)} · ${esc(b.goalLabel || '')}</div>` : '';
      h += `<div class="card">
        <div class="row"><span class="dot" style="background:${b.color}"></span><div class="grow"><div class="t">${esc(b.name)}</div><div class="s">${esc(b.where)}</div></div>
          <div style="text-align:right"><div class="small muted">Transferir</div><div class="num">${S(b.aporte[i])}</div></div></div>
        ${ret ? `<div class="kv"><span>${b.personal ? 'Gasto estimado del mes' : 'Retiro / pago este mes'}</span><span class="num">−${S(ret)}</span></div>` : ''}
        <div class="kv"><span>Saldo según plan (fin de mes)</span><span class="num">${S(plan)}</span></div>
        <div class="kv"><span>Saldo real ${real ? `<span class="muted small">(${new Date(real.t).toLocaleDateString('es-PE')}${real.by ? ' · ' + esc(real.by) : ''})</span>` : ''}</span>
          <span>${real ? `<span class="num">${S(real.v)}</span> ` : ''}<button class="edit" data-act="bal" data-id="${esc(b.id)}">${real ? 'Editar' : 'Anotar'}</button></span></div>
        ${goal}
      </div>`;
    }
    h += `<div class="card"><div class="kv"><span>Match (garantía del inquilino)</span><span class="num">${S(P().match)}</span></div><div class="small muted">Intocable hasta que termine el contrato.</div></div>`;
    return h;
  }

  function metas() {
    const p = P(), h0 = p.hip;
    const cap = st.cap ? st.cap.v : h0.capital;
    const pre = st.prepago ?? h0.prepagoAnual;
    const sim = simHip(cap, pre), base = simHip(cap, 0);
    const pagado = ((460000 - cap) / 460000) * 100;
    const meta = new Date(2040, 0, 5), ok = sim.fin <= meta;
    let h = `<h2>Hipotecario BBVA</h2><div class="card">
      <div class="row"><div class="grow"><div class="t">Capital pendiente</div><div class="s">${st.cap ? 'Actualizado ' + new Date(st.cap.t).toLocaleDateString('es-PE') : 'Dato de la app BBVA (set-26)'}</div></div>
        <div style="text-align:right"><div class="num big">${S0(cap)}</div><button class="edit" data-act="cap">Actualizar</button></div></div>
      <div class="bar"><i style="width:${pagado}%"></i></div><div class="small muted">${fmt.format(pagado)}% pagado de S/ 460,000</div>
      <div class="kv" style="margin-top:8px"><span>Prepago cada setiembre</span><span><span class="num">${S0(pre)}</span> <button class="edit" data-act="prepago">Simular</button></span></div>
      <div class="kv"><span>Terminan en</span><span class="num">${MES[sim.fin.getMonth()]} ${sim.fin.getFullYear()} ${ok ? '<span class="pill ok">Meta ✓</span>' : '<span class="pill warn">Después de la meta</span>'}</span></div>
      <div class="kv"><span>Sin prepagos terminarían</span><span class="num">${MES[base.fin.getMonth()]} ${base.fin.getFullYear()}</span></div>
      <div class="kv"><span>Ahorro en intereses</span><span class="num">${S0(base.interes - sim.interes)}</span></div>
      <p class="note">Meta: terminar en enero 2040 (15 años). Al prepagar, pide SIEMPRE “reducir plazo”. Cálculo aproximado: TEA ${(h0.tea * 100).toFixed(2)}%, 2 cuotas dobles al año.</p>
    </div>`;
    const bv = p.bolsas.find((b) => b.id === 'viaje'), vs = getV('bal', 'viaje') ?? bolsaPlan(bv, curIdx());
    h += `<h2>Viaje a Cusco y Machu Picchu</h2><div class="card"><div class="row"><div class="grow"><div class="t">${S0(vs)} de ${S0(bv.goal)}</div><div class="s">Meta estimada para 1 semana entre los dos · ago/set-27</div></div><span class="pill">${fmt0.format(Math.min(100, (vs / bv.goal) * 100))}%</span></div><div class="bar"><i style="width:${Math.min(100, (vs / bv.goal) * 100)}%;background:${bv.color}"></i></div></div>`;
    const bt = p.bolsas.find((b) => b.id === 'tecno');
    const relojesComprados = getV('wish', 'w1') && getV('wish', 'w2');
    const ts = getV('bal', 'tecno') ?? (bolsaPlan(bt, curIdx()) + (relojesComprados ? 0 : 4978));
    const pend = p.wishlist.filter((w) => !getV('wish', w.id));
    h += `<h2>Tecnología · lista de deseos</h2><div class="card"><div class="kv"><span>Saldo bolsa Tecnología</span><span class="num">${S(ts)}</span></div>
      ${pend[0] ? `<div class="small muted" style="margin:4px 0 6px">Siguiente: ${esc(pend[0].name)} — ${ts >= pend[0].cost ? '<b>ya alcanza</b>' : 'faltan ' + S0(pend[0].cost - ts)}</div>` : ''}
      ${p.wishlist.map((w) => { const on = !!getV('wish', w.id); return `<div class="row ${on ? 'done' : ''}"><input type="checkbox" class="check" data-act="wish" data-id="${esc(w.id)}" ${on ? 'checked' : ''} aria-label="Comprado"><div class="grow"><div class="t">${esc(w.name)}</div></div><span class="num">${S0(w.cost)}</span></div>`; }).join('')}
      <p class="note">Regla: cuotas 0% solo si la plata ya está en la bolsa.</p></div>`;
    const em = p.emergencia.reduce((a, e) => a + (e.usd ? e.usd * fx() : e.pen), 0);
    const ess = ['VIVIENDA', 'ALIMENTACIÓN', 'BBS', 'SALUD'].reduce((a, n) => { const g = p.gastos.find((x) => x.group.startsWith(n)); return a + (g ? sum(g.items.map((it) => sum(it.vals) / 12)) : 0); }, 300);
    h += `<h2>Fondo de emergencia</h2><div class="card"><div class="row"><div class="grow"><div class="t">${S0(em)}</div><div class="s">${p.emergencia.map((e) => esc(e.name)).join(' · ')}</div></div><span class="pill ok">${fmt.format(em / ess)} meses</span></div>
      <p class="note">Solo para emergencias (salud, empleo, reparación urgente). Tipo de cambio: ${fx()}.</p></div>`;
    const ci = curIdx();
    h += `<h2>Dinero personal (acumulado si gastan lo estimado)</h2><div class="grid2">
      <div class="person p-sofia"><div class="who">Sofía</div><div class="amt">${S0(bolsaPlan(p.bolsas.find((b) => b.id === 'sofia'), ci))}</div><div class="sub">a fin de ${monthName(p.months[ci])}</div></div>
      <div class="person p-renan"><div class="who">Renán</div><div class="amt">${S0(bolsaPlan(p.bolsas.find((b) => b.id === 'renan'), ci))}</div><div class="sub">a fin de ${monthName(p.months[ci])}</div></div></div>`;
    return h;
  }
  function curIdx() { const i = P().months.indexOf(ym(today)); return i >= 0 ? i : ym(today) < P().months[0] ? 0 : P().months.length - 1; }

  function presupuesto() {
    const i = mi, k = P().months[i], c = monthCalc(i);
    let h = `<h2>${esc(monthName(k))}</h2><div class="card">
      <div class="kv"><span>Ingresos</span><span class="num">${S(c.ing)}</span></div>
      <div class="kv"><span>Gastos presupuestados</span><span class="num">${S(c.gas)}</span></div>
      <div class="kv"><span>Gastos reales anotados</span><span class="num">${S(realTotal(i))}</span></div>
      <p class="note">Anota el gasto real de cualquier rubro tocando “Real”. Delivery, tienditas y salidas NO van aquí: salen del dinero personal de cada uno.</p></div>`;
    h += `<details class="group"><summary><span class="chev">›</span><span class="grow" style="flex:1">Ingresos</span><span class="num">${S(c.ing)}</span></summary><div class="body">${P().ingresos.map((r) => `<div class="row"><div class="grow"><div class="t">${esc(r.name)}</div>${r.note ? `<div class="s">${esc(r.note)}</div>` : ''}</div><span class="num">${S(r.vals[i])}</span></div>`).join('')}</div></details>`;
    for (const g of P().gastos) {
      const bud = sum(g.items.map((it) => it.vals[i]));
      const realG = sum(g.items.map((it) => getV('real', k + '|' + it.name) ?? 0));
      const anyReal = g.items.some((it) => getV('real', k + '|' + it.name) !== undefined);
      const pct = bud ? (realG / bud) * 100 : 0;
      h += `<details class="group"><summary><span class="chev">›</span><span style="flex:1">${esc(cap1(g.group))}</span><span class="num">${S(bud)}</span></summary><div class="body">
        ${anyReal ? `<div class="bar ${pct > 100 ? 'danger' : pct > 90 ? 'warn' : ''}"><i style="width:${Math.min(100, pct)}%"></i></div><div class="small muted">Real ${S(realG)} de ${S(bud)}</div>` : ''}
        ${g.items.filter((it) => it.vals[i] || getV('real', k + '|' + it.name) !== undefined).map((it) => { const r = getV('real', k + '|' + it.name); return `<div class="row"><div class="grow"><div class="t">${esc(it.name)}</div>${it.note ? `<div class="s">${esc(it.note)}</div>` : ''}</div>
          <div style="text-align:right"><div class="num">${S(it.vals[i])}</div>${r !== undefined ? `<div class="small ${r > it.vals[i] ? 'muted' : 'muted'}">Real ${S(r)}</div>` : ''}<button class="edit" data-act="real" data-key="${esc(k + '|' + it.name)}" data-name="${esc(it.name)}">Real</button></div></div>`; }).join('')}
      </div></details>`;
    }
    const m = P().metas;
    h += `<details class="group"><summary><span class="chev">›</span><span style="flex:1">Metas y dinero personal</span><span class="num">${S(c.metas + c.personal)}</span></summary><div class="body">
      <div class="row"><div class="grow t">Prepago hipotecario</div><span class="num">${S(m.amort[i])}</span></div>
      <div class="row"><div class="grow t">Viaje Cusco</div><span class="num">${S(m.viaje[i])}</span></div>
      <div class="row"><div class="grow t">Tecnología</div><span class="num">${S(m.tec[i])}</span></div>
      <div class="row"><div class="grow t">Personal Sofía</div><span class="num">${S(m.sof[i])}</span></div>
      <div class="row"><div class="grow t">Personal Renán</div><span class="num">${S(m.ren[i])}</span></div>
      ${m.reserva[i] ? `<div class="row"><div class="grow t">Reserva cuota doble</div><span class="num">${S(m.reserva[i])}</span></div>` : ''}
    </div></details>`;
    return h;
  }
  const cap1 = (s) => s.charAt(0) + s.slice(1).toLowerCase();
  function realTotal(i) { const k = P().months[i]; return sum(Object.keys(st.real).filter((x) => x.startsWith(k + '|')).map((x) => st.real[x].v || 0)); }

  // ---------- diálogos ----------
  const dlg = $('#dlg'), form = $('#dlgForm');
  function ask({ title, text = '', fields = [], ok = 'Guardar', extra = '' }) {
    form.innerHTML = `<h3>${esc(title)}</h3>${text ? `<p class="small muted">${text}</p>` : ''}
      ${fields.map((f, n) => `<label for="f${n}">${esc(f.label)}</label>${f.options ? `<select id="f${n}">${f.options.map((o) => `<option value="${esc(o[0])}" ${o[0] === f.value ? 'selected' : ''}>${esc(o[1])}</option>`).join('')}</select>` : `<input id="f${n}" type="${f.type || 'number'}" inputmode="${f.type === 'text' || f.type === 'password' ? 'text' : 'decimal'}" step="any" value="${f.value ?? ''}" ${f.min !== undefined ? `min="${f.min}"` : ''} ${f.max !== undefined ? `max="${f.max}"` : ''}>`}`).join('')}
      ${extra}
      <div class="btns"><button class="btn" value="cancel">Cancelar</button>${fields.length || ok ? `<button class="btn primary" value="ok" id="dlgOk">${esc(ok)}</button>` : ''}</div>`;
    return new Promise((res) => {
      dlg.onclose = () => res(dlg.returnValue === 'ok' ? fields.map((f, n) => $('#f' + n, form).value) : null);
      dlg.showModal();
      const first = $('input,select', form); if (first) first.focus();
    });
  }
  const num = (v) => { const n = parseFloat(String(v).replace(',', '.')); return isFinite(n) ? n : null; };

  function settings() {
    form.innerHTML = `<h3>Ajustes</h3>
      <label for="sMe">¿Quién usa este celular?</label>
      <select id="sMe"><option value="">—</option><option ${st.me === 'Sofía' ? 'selected' : ''}>Sofía</option><option ${st.me === 'Renán' ? 'selected' : ''}>Renán</option></select>
      <label for="sTheme">Tema</label>
      <select id="sTheme"><option value="auto" ${st.theme === 'auto' ? 'selected' : ''}>Automático</option><option value="light" ${st.theme === 'light' ? 'selected' : ''}>Claro</option><option value="dark" ${st.theme === 'dark' ? 'selected' : ''}>Oscuro</option></select>
      <label for="sFx">Tipo de cambio US$</label><input id="sFx" type="number" step="0.001" inputmode="decimal" value="${fx() || ''}">
      <label>Sincronización en línea</label>
      <div id="cloudBox" class="small">${cloudBoxHtml()}</div>
      <label>Respaldo manual</label>
      <p class="small muted" style="margin:0 0 8px">Por si acaso: guarda una copia de tus datos en un archivo, o importa uno.</p>
      <div class="btns" style="justify-content:flex-start"><button type="button" class="btn primary" data-act="export">Exportar respaldo</button><button type="button" class="btn" data-act="import">Importar archivo</button></div>
      <label>Zona de peligro</label>
      <div class="btns" style="justify-content:flex-start"><button type="button" class="btn" data-act="wipe" style="color:var(--danger)">Borrar datos de este celular</button></div>
      <div class="btns"><button class="btn primary" value="ok">Listo</button></div>`;
    dlg.onclose = () => {
      if (dlg.returnValue === 'ok') {
        st.me = $('#sMe', form).value; st.theme = $('#sTheme', form).value;
        const f = num($('#sFx', form).value); if (f) st.fx = f;
        save(); render();
      }
    };
    dlg.showModal();
  }

  // ---------- import / export ----------
  function exportData() {
    const data = { kind: 'respaldo-nuestra-plata', exportedAt: new Date().toISOString(), by: st.me || '', state: { ...st, me: undefined, theme: undefined, pw: undefined } };
    const name = 'nuestra-plata-' + new Date().toISOString().slice(0, 10) + (st.me ? '-' + st.me.normalize('NFD').replace(/[^\w]/g, '') : '') + '.json';
    const blob = new Blob([JSON.stringify(data)], { type: 'application/json' });
    const file = new File([blob], name, { type: 'application/json' });
    if (navigator.canShare && navigator.canShare({ files: [file] })) {
      navigator.share({ files: [file], title: 'Presviz', text: 'Respaldo de Presviz' }).catch(() => download(blob, name));
    } else download(blob, name);
  }
  function download(blob, name) { const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name; document.body.appendChild(a); a.click(); setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 500); toast('Respaldo descargado'); }
  function mergeBucket(a = {}, b = {}) { const out = { ...a }; for (const k in b) { if (!b[k] || typeof b[k].t !== 'number') continue; if (!out[k] || out[k].t < b[k].t) out[k] = b[k]; } return out; }
  function importData(obj) {
    if (obj && obj.kind === 'plan-familiar' && Array.isArray(obj.months)) {
      st.plan = obj; save(); initMonth(); toast('Plan cargado ✓'); render(); return;
    }
    if (obj && obj.kind === 'respaldo-nuestra-plata' && obj.state) {
      const o = obj.state;
      if (o.plan && (!st.plan || (o.plan.version || '') >= (st.plan.version || ''))) st.plan = o.plan;
      for (const b of ['paid', 'bal', 'real', 'days', 'amt', 'wish']) st[b] = mergeBucket(st[b], o[b]);
      if (o.cap && (!st.cap || st.cap.t < o.cap.t)) st.cap = o.cap;
      if (!st.fx && o.fx) st.fx = o.fx;
      save(); if (st.plan) initMonth(); toast('Respaldo de ' + (obj.by || 'tu pareja') + ' combinado ✓'); render(); return;
    }
    toast('Ese archivo no es un plan ni un respaldo de Presviz');
  }
  $('#fileIn').addEventListener('change', (e) => {
    const f = e.target.files[0]; if (!f) return;
    const r = new FileReader();
    r.onload = () => { try { importData(JSON.parse(r.result)); } catch (err) { toast('No se pudo leer el archivo'); } };
    r.readAsText(f); e.target.value = '';
  });

  // ---------- eventos ----------
  document.addEventListener('click', async (e) => {
    const go = e.target.closest('[data-go]'); if (go) { tab = go.dataset.go; render(); scrollTo(0, 0); return; }
    const t = e.target.closest('[data-tab]'); if (t) { tab = t.dataset.tab; render(); scrollTo(0, 0); return; }
    const a = e.target.closest('[data-act]'); if (!a) return;
    const act = a.dataset.act;
    if (act === 'import') { if (dlg.open) dlg.close(); $('#fileIn').click(); return; }
    if (act === 'export') { exportData(); return; }
    if (act === 'unlock') { syncPlan(true); return; }
    if (act === 'login') { if (dlg.open) dlg.close(); cloudLogin(); return; }
    if (act === 'logout') { if (fb) { await fb.signOut(); toast('Sesión cerrada'); } if (dlg.open) dlg.close(); return; }
    if (act === 'verified') { if (fb && fb.user) { await fb.user.reload(); await fb.user.getIdToken(true); onUser(fb.auth.currentUser); } if (dlg.open) dlg.close(); return; }
    if (act === 'resend') { if (fb && fb.user) { await fb.fn.sendEmailVerification(fb.user); toast('Correo de verificación enviado'); } return; }
    if (act === 'wipe') { if (confirm('¿Borrar todos los datos de este celular? Exporta un respaldo antes.')) { st = blank(); save(); dlg.close(); render(); } return; }
    if (act === 'paid' || act === 'wish') return; // lo maneja 'change'
    if (act === 'amt') { const r = await ask({ title: 'Monto del pago', text: 'Ej.: el total del estado de cuenta.', fields: [{ label: 'Monto (S/)', value: getV('amt', a.dataset.key) ?? '' }] }); if (r && num(r[0]) !== null) { setK('amt', a.dataset.key, num(r[0])); render(); } return; }
    if (act === 'day') { const r = await ask({ title: 'Día de pago', text: 'Se usará todos los meses.', fields: [{ label: 'Día del mes (1–31)', value: getV('days', a.dataset.id) ?? '', min: 1, max: 31 }] }); const d = r && Math.round(num(r[0])); if (d >= 1 && d <= 31) { setK('days', a.dataset.id, d); render(); } return; }
    if (act === 'bal') { const b = P().bolsas.find((x) => x.id === a.dataset.id); const r = await ask({ title: 'Saldo real · ' + b.name, text: 'Lo que ves hoy en la cuenta.', fields: [{ label: 'Saldo (S/)', value: getV('bal', b.id) ?? '' }] }); if (r && num(r[0]) !== null) { setK('bal', b.id, num(r[0])); render(); } return; }
    if (act === 'real') { const r = await ask({ title: 'Gasto real', text: esc(a.dataset.name), fields: [{ label: 'Monto real del mes (S/)', value: getV('real', a.dataset.key) ?? '' }] }); if (r) { setK('real', a.dataset.key, num(r[0])); render(); } return; }
    if (act === 'cap') { const r = await ask({ title: 'Capital pendiente', text: 'Cópialo de la app BBVA (Préstamo → Capital pendiente).', fields: [{ label: 'Capital (S/)', value: st.cap ? st.cap.v : P().hip.capital }] }); if (r && num(r[0])) { st.cap = stamp(num(r[0])); save(); cloudPushTop('cap', st.cap); render(); } return; }
    if (act === 'prepago') { const r = await ask({ title: 'Simular prepago anual', text: 'Monto que prepagan cada setiembre. El plan es S/ 8,500 (termina ene-2040).', fields: [{ label: 'Prepago anual (S/)', value: st.prepago ?? P().hip.prepagoAnual }] }); if (r && num(r[0]) !== null) { st.prepago = num(r[0]); save(); render(); } return; }
  });
  document.addEventListener('change', (e) => {
    const a = e.target.closest('[data-act]'); if (!a) return;
    if (a.dataset.act === 'paid') { setK('paid', a.dataset.key, a.checked); render(); }
    if (a.dataset.act === 'wish') { setK('wish', a.dataset.id, a.checked); render(); }
  });
  $('#prevMonth').onclick = () => { if (mi > 0) { mi--; render(); } };
  $('#nextMonth').onclick = () => { if (P() && mi < P().months.length - 1) { mi++; render(); } };
  $('#openSettings').onclick = settings;

  function applyTheme() { const r = document.documentElement; if (st.theme === 'auto') r.removeAttribute('data-theme'); else r.setAttribute('data-theme', st.theme); }
  let tt; function toast(msg) { const el = $('#toast'); el.textContent = msg; el.classList.add('show'); clearTimeout(tt); tt = setTimeout(() => el.classList.remove('show'), 2600); }

  // ---------- plan cifrado incluido en la app ----------
  const b64 = (x) => Uint8Array.from(atob(x), (c) => c.charCodeAt(0));
  async function decryptPlan(enc, pw) {
    const base = await crypto.subtle.importKey('raw', new TextEncoder().encode(pw), 'PBKDF2', false, ['deriveKey']);
    const key = await crypto.subtle.deriveKey({ name: 'PBKDF2', salt: b64(enc.salt), iterations: enc.iter, hash: 'SHA-256' }, base, { name: 'AES-GCM', length: 256 }, false, ['decrypt']);
    const pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: b64(enc.iv) }, key, b64(enc.data));
    return JSON.parse(new TextDecoder().decode(pt));
  }
  let syncing = false;
  async function syncPlan(manual) {
    if (syncing || !(window.crypto && crypto.subtle)) return;
    syncing = true;
    try {
      let enc = null;
      try { const r = await fetch('plan.enc.json', { cache: 'no-store' }); if (r.ok) enc = await r.json(); } catch (e) { /* sin conexión */ }
      if (!enc || enc.kind !== 'plan-cifrado') { if (manual) toast('No se encontró el plan en la app'); return; }
      if (st.plan && (st.plan.version || '') >= enc.version) { if (manual) toast('Ya tienes la última versión del plan'); return; }
      let pw = st.pw;
      for (let n = 0; n < 3; n++) {
        if (!pw) {
          const r = await ask({ title: st.plan ? 'Hay una versión nueva del plan' : 'Abrir nuestro plan', text: 'Ingresa la clave que te pasó Sofía.', fields: [{ label: 'Clave', type: 'password' }], ok: 'Abrir' });
          if (!r) return;
          pw = r[0].trim();
        }
        try {
          const plan = await decryptPlan(enc, pw);
          const nuevo = !!st.plan;
          st.plan = plan; st.pw = pw; save(); initMonth(); render(); cloudSavePw();
          toast(nuevo ? 'Plan actualizado ✓' : 'Plan cargado ✓');
          return;
        } catch (e) { pw = ''; st.pw = ''; toast('Clave incorrecta'); }
      }
    } finally { syncing = false; }
  }

  // ---------- nube (Firebase) ----------
  let fb = null, unsub = null, firstSnap = true;
  const cloudState = () => (!window.PRESVIZ_FIREBASE ? 'off' : !fb ? 'loading' : !fb.user ? 'out' : !fb.user.emailVerified ? 'verify' : fb.online ? 'on' : 'sync');
  function cloudBoxHtml() {
    const c = cloudState();
    if (c === 'off') return '<span class="muted">Aún no está configurada.</span>';
    if (c === 'loading') return '<span class="muted">Conectando…</span>';
    if (c === 'out') return '<p class="muted" style="margin:0 0 8px">Inicia sesión para que los dos vean lo mismo al instante.</p><button type="button" class="btn primary" data-act="login">Iniciar sesión</button>';
    if (c === 'verify') return `<p class="muted" style="margin:0 0 8px">Te enviamos un correo a <b>${esc(fb.user.email)}</b>. Abre el enlace y luego toca “Ya verifiqué”.</p><div class="btns" style="justify-content:flex-start"><button type="button" class="btn primary" data-act="verified">Ya verifiqué</button><button type="button" class="btn" data-act="resend">Reenviar</button><button type="button" class="btn" data-act="logout">Salir</button></div>`;
    return `<p style="margin:0 0 8px">✅ Conectado como <b>${esc(fb.user.email)}</b>${c === 'sync' ? ' <span class="muted">(sin conexión: se sube al volver)</span>' : ''}</p><button type="button" class="btn" data-act="logout">Cerrar sesión</button>`;
  }
  function cloudDot() {
    const el = $('#cloudDot'); if (!el) return;
    const c = cloudState();
    el.hidden = c === 'off';
    el.style.background = c === 'on' ? 'var(--ok)' : c === 'sync' || c === 'loading' ? 'var(--warn)' : 'var(--muted)';
    el.title = { on: 'Sincronizado', sync: 'Sin conexión', loading: 'Conectando', out: 'Sin sesión', verify: 'Verifica tu correo' }[c] || '';
    const box = $('#cloudBox'); if (box) box.innerHTML = cloudBoxHtml();
  }
  async function initCloud() {
    const cfg = window.PRESVIZ_FIREBASE; if (!cfg) return;
    const base = 'https://www.gstatic.com/firebasejs/10.14.1/';
    try {
      const [A, U, F] = await Promise.all([import(base + 'firebase-app.js'), import(base + 'firebase-auth.js'), import(base + 'firebase-firestore.js')]);
      const app = A.initializeApp(cfg);
      const auth = U.getAuth(app);
      let db;
      try { db = F.initializeFirestore(app, { localCache: F.persistentLocalCache({ tabManager: F.persistentMultipleTabManager() }) }); } catch (e) { db = F.getFirestore(app); }
      fb = { auth, db, F, fn: U, user: null, online: false, signOut: () => U.signOut(auth) };
      U.onAuthStateChanged(auth, onUser);
    } catch (e) { toast('No se pudo conectar a la nube'); }
    cloudDot();
  }
  const estadoRef = () => fb.F.doc(fb.db, 'presviz', 'estado');
  const configRef = () => fb.F.doc(fb.db, 'presviz', 'config');
  const cloudReady = () => !!(fb && fb.user && fb.user.emailVerified);
  function onUser(u) {
    fb.user = u; firstSnap = true;
    if (unsub) { unsub(); unsub = null; }
    if (u && u.emailVerified) {
      unsub = fb.F.onSnapshot(estadoRef(), { includeMetadataChanges: true }, (snap) => {
        fb.online = !snap.metadata.fromCache;
        applyRemote(snap.data() || {});
        cloudDot();
      }, () => { toast('Sin permiso en la nube: tu correo no está autorizado'); });
      fb.F.getDoc(configRef()).then((c) => {
        const pw = c.exists() && c.data().pw;
        if (pw && !st.pw) { st.pw = pw; save(); syncPlan(false); } else if (st.pw && !pw) cloudSavePw();
      }).catch(() => {});
    }
    cloudDot(); render();
  }
  function applyRemote(d) {
    let changed = false; const push = {};
    for (const b of BUCKETS) {
      const r = d[b] || {};
      for (const k in r) { const x = r[k]; if (x && typeof x.t === 'number' && (!st[b][k] || st[b][k].t < x.t)) { st[b][k] = x; changed = true; } }
      if (firstSnap) for (const k in st[b]) { if (!r[k] || r[k].t < st[b][k].t) { push[b] = push[b] || {}; push[b][k] = st[b][k]; } }
    }
    if (d.cap && (!st.cap || st.cap.t < d.cap.t)) { st.cap = d.cap; changed = true; }
    else if (firstSnap && st.cap && (!d.cap || d.cap.t < st.cap.t)) push.cap = st.cap;
    if (firstSnap && Object.keys(push).length) fb.F.setDoc(estadoRef(), push, { merge: true }).catch(() => {});
    firstSnap = false;
    if (changed) { save(); if (P()) render(); }
  }
  function cloudPush(bucket, key, val) { if (cloudReady()) fb.F.setDoc(estadoRef(), { [bucket]: { [key]: val } }, { merge: true }).catch(() => toast('No se pudo sincronizar')); }
  function cloudPushTop(field, val) { if (cloudReady()) fb.F.setDoc(estadoRef(), { [field]: val }, { merge: true }).catch(() => {}); }
  function cloudSavePw() { if (cloudReady() && st.pw) fb.F.setDoc(configRef(), { pw: st.pw }, { merge: true }).catch(() => {}); }
  async function cloudLogin() {
    if (!fb) { toast('Conectando… intenta en unos segundos'); return; }
    const r = await ask({ title: 'Iniciar sesión', text: 'Usa tu correo. La primera vez elige “Crear cuenta”.', fields: [
      { label: 'Correo', type: 'email' }, { label: 'Contraseña (mínimo 6 caracteres)', type: 'password' },
      { label: '¿Qué quieres hacer?', options: [['in', 'Entrar'], ['new', 'Crear cuenta'], ['reset', 'Olvidé mi contraseña']], value: 'in' }], ok: 'Continuar' });
    if (!r) return;
    const email = r[0].trim(), pass = r[1], mode = r[2];
    try {
      if (mode === 'reset') { await fb.fn.sendPasswordResetEmail(fb.auth, email); toast('Te enviamos un correo para cambiarla'); return; }
      if (mode === 'new') { const c = await fb.fn.createUserWithEmailAndPassword(fb.auth, email, pass); await fb.fn.sendEmailVerification(c.user); toast('Cuenta creada. Revisa tu correo para verificarla'); settings(); }
      else { await fb.fn.signInWithEmailAndPassword(fb.auth, email, pass); toast('Sesión iniciada ✓'); }
    } catch (e) {
      const m = { 'auth/invalid-credential': 'Correo o contraseña incorrectos', 'auth/email-already-in-use': 'Ese correo ya tiene cuenta: elige “Entrar”', 'auth/weak-password': 'La contraseña debe tener al menos 6 caracteres', 'auth/invalid-email': 'Correo no válido', 'auth/too-many-requests': 'Demasiados intentos, espera un momento' }[e.code];
      toast(m || 'No se pudo: ' + (e.code || e.message));
    }
  }
  addEventListener('online', cloudDot);
  addEventListener('offline', () => { if (fb) fb.online = false; cloudDot(); });

  if (P()) initMonth();
  render();
  syncPlan(false);
  initCloud();

  if ('serviceWorker' in navigator && location.protocol !== 'file:') navigator.serviceWorker.register('sw.js').catch(() => {});
})();
