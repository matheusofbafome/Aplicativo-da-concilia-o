/* ========= Núcleo de dados (IndexedDB) ========= */
const DB_NAME = 'conciliaDB';
const STORE = 'lancamentos';
let db;

function idbOpen(){
  return new Promise((resolve, reject)=>{
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = e => {
      const db = e.target.result;
      const store = db.createObjectStore(STORE, { keyPath:'id', autoIncrement:true });
      store.createIndex('data','data',{});
      store.createIndex('conta','conta',{});
      store.createIndex('status','status',{});
      store.createIndex('tipo','tipo',{});
      store.createIndex('valor','valor',{});
    };
    req.onsuccess = e => { db = e.target.result; resolve(db); };
    req.onerror = e => reject(e.target.error);
  });
}
function tx(store, mode='readonly'){ return db.transaction(store, mode).objectStore(store); }
function idbAddMany(items){
  return new Promise((resolve,reject)=>{
    const t = db.transaction(STORE,'readwrite');
    const s = t.objectStore(STORE);
    items.forEach(it => s.add(it));
    t.oncomplete = ()=> resolve(true);
    t.onerror = e => reject(e.target.error);
  });
}
function idbGetAll(){
  return new Promise((resolve,reject)=>{
    const req = tx(STORE).getAll();
    req.onsuccess = ()=> resolve(req.result || []);
    req.onerror = e => reject(e.target.error);
  });
}
function idbPut(item){
  return new Promise((resolve,reject)=>{
    const req = tx(STORE,'readwrite').put(item);
    req.onsuccess = ()=> resolve(true);
    req.onerror = e => reject(e.target.error);
  });
}
function idbDelete(id){
  return new Promise((resolve,reject)=>{
    const req = tx(STORE,'readwrite').delete(id);
    req.onsuccess = ()=> resolve(true);
    req.onerror = e => reject(e.target.error);
  });
}
function idbClear(){
  return new Promise((resolve,reject)=>{
    const req = tx(STORE,'readwrite').clear();
    req.onsuccess = ()=> resolve(true);
    req.onerror = e => reject(e.target.error);
  });
}

/* ========= Estado & Utilitários ========= */
const $ = s => document.querySelector(s);
const $$ = s => Array.from(document.querySelectorAll(s));

const State = {
  raw: [],        // todos os registros na memória
  filtered: [],   // após filtro/ordenação
  sortKey: 'data',
  sortDir: 'desc',
  page: 1,
  pageSize: 25,
  contas: new Set(),
};

const Status = ['PENDENTE','EM ANDAMENTO','CONCILIADO','DIVERGÊNCIA'];
const Tipo = ['CRÉDITO','DÉBITO'];

function money(n){
  const v = (Number(n)||0);
  return v.toLocaleString('pt-BR',{style:'currency',currency:'BRL'});
}
function parseMoney(s){
  if (typeof s === 'number') return s;
  if (!s) return 0;
  s = (''+s).replace(/\./g,'').replace(',','.');
  const n = Number(s.replace(/[^\d\.-]/g,''));
  return isFinite(n) ? n : 0;
}
function toISODate(s){
  if (!s) return '';
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  // tenta formatos dd/mm/aaaa ou mm/dd/aaaa
  const m = s.match(/^(\d{1,2})[\/.-](\d{1,2})[\/.-](\d{4})$/);
  if (m){
    const [_,a,b,y]=m;
    if (Number(a) > 12) { // dd/mm
      const d = a, mo = b;
      return `${y.padStart(4,'0')}-${mo.padStart(2,'0')}-${d.padStart(2,'0')}`;
    }
    if (Number(b) > 12) { // mm/dd
      const mo = a, d = b;
      return `${y.padStart(4,'0')}-${mo.padStart(2,'0')}-${d.padStart(2,'0')}`;
    }
    // ambos <=12: assume dd/mm
    const d = a, mo = b;
    return `${y.padStart(4,'0')}-${mo.padStart(2,'0')}-${d.padStart(2,'0')}`;
  }
  // fallback Date.parse
  const dt = new Date(s);
  if (!isNaN(dt)) return dt.toISOString().slice(0,10);
  return '';
}
function debounce(fn,ms=250){ let t; return (...a)=>{ clearTimeout(t); t=setTimeout(()=>fn(...a),ms);} }
function uid(){ return Math.random().toString(36).slice(2); }

/* ========= CSV ========= */
function parseCSV(text, sep=','){
  // robusto o suficiente para aspas e quebras de linha
  const rows = []; let i=0, field='', row=[], inQ=false;
  for(; i<text.length; i++){
    const c = text[i];
    if (inQ){
      if (c === '"'){
        if (text[i+1] === '"'){ field+='"'; i++; } else { inQ=false; }
      } else field += c;
    } else {
      if (c === '"'){ inQ=true; }
      else if (c === sep){ row.push(field); field=''; }
      else if (c === '\n'){ row.push(field); rows.push(row); row=[]; field=''; }
      else if (c === '\r'){ /* ignore */ }
      else field += c;
    }
  }
  if (field.length || row.length) { row.push(field); rows.push(row); }
  return rows;
}
function toCSV(rows, sep=','){
  return rows.map(r=>r.map(v=>{
    if (v==null) v='';
    v = String(v);
    if (/[",\n\r;]/.test(v)) v='"'+v.replace(/"/g,'""')+'"';
    return v;
  }).join(sep)).join('\n');
}
function download(filename, content, type='text/plain'){
  const blob = new Blob([content], {type});
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  a.click();
  URL.revokeObjectURL(a.href);
}

/* ========= UI: carregamento inicial ========= */
if (typeof window !== 'undefined') {
  (async function init(){
    await idbOpen();
    const all = await idbGetAll();
    State.raw = all;
    refreshContaOptions();
    applyFilters();
    bindUI();
  })();
}

/* ========= UI: tabela ========= */
function render(){
  // ordenar
  const key = State.sortKey, dir = State.sortDir;
  State.filtered.sort((a,b)=>{
    let va=a[key], vb=b[key];
    if (key==='valor'){ va=Number(va)||0; vb=Number(vb)||0; }
    if (key==='data'){ va=(va||''); vb=(vb||''); }
    if (va<vb) return dir==='asc'?-1:1;
    if (va>vb) return dir==='asc'?1:-1;
    return 0;
  });

  const total = State.filtered.length;
  const pageSize = State.pageSize;
  const maxPage = Math.max(1, Math.ceil(total/pageSize));
  State.page = Math.min(State.page, maxPage);
  const start = (State.page-1)*pageSize;
  const slice = State.filtered.slice(start, start+pageSize);

  const tbody = $('#tbody');
  tbody.innerHTML = '';
  for (const it of slice){
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td data-k="data" contenteditable="true">${it.data||''}</td>
      <td data-k="conta" contenteditable="true">${it.conta||''}</td>
      <td data-k="descricao" contenteditable="true">${it.descricao||''}</td>
      <td data-k="documento" contenteditable="true">${it.documento||''}</td>
      <td>
        <select data-k="tipo">
          ${Tipo.map(t=>`<option ${it.tipo===t?'selected':''}>${t}</option>`).join('')}
        </select>
      </td>
      <td data-k="valor" contenteditable="true">${(Number(it.valor)||0).toFixed(2)}</td>
      <td>
        <select data-k="status">
          ${Status.map(s=>`<option ${it.status===s?'selected':''}>${s}</option>`).join('')}
        </select>
      </td>
      <td data-k="observacoes" contenteditable="true">${it.observacoes||''}</td>
      <td class="actions">
        <button data-act="save" title="Salvar linha" aria-label="Salvar linha">💾</button>
        <button data-act="dup" title="Duplicar" aria-label="Duplicar">📄</button>
        <button data-act="del" class="btn-danger" title="Excluir" aria-label="Excluir">🗑️</button>
      </td>
    `;
    tr.dataset.id = it.id;
    tbody.appendChild(tr);
  }

  // KPIs
  const sumCred = State.filtered.filter(r=>r.tipo==='CRÉDITO').reduce((a,b)=>a+(Number(b.valor)||0),0);
  const sumDeb = State.filtered.filter(r=>r.tipo==='DÉBITO').reduce((a,b)=>a+(Number(b.valor)||0),0);
  const sumAll = sumCred - sumDeb;
  const conc = State.filtered.length ? Math.round(State.filtered.filter(r=>r.status==='CONCILIADO').length*100/State.filtered.length) : 0;
  $('#kCreditos').textContent = money(sumCred);
  $('#kDebitos').textContent = money(sumDeb);
  $('#kSaldo').textContent = money(sumAll);
  $('#kConciliado').textContent = conc+'%';

  // counters/paginação
  $('#countTotal').textContent = State.raw.length;
  $('#countShown').textContent = State.filtered.length;
  $('#pageInfo').textContent = `${State.page}/${maxPage}`;

  // status pills (visual nas selects)
  // (mantemos selects por acessibilidade; as classes abaixo são para cabeçalho visual)
}
function applyFilters(){
  const q = $('#fSearch').value.toLowerCase().trim();
  const st = $('#fStatus').value;
  const tp = $('#fTipo').value;
  const cta = $('#fConta').value;
  const di = $('#fDataIni').value;
  const df = $('#fDataFim').value;
  const vmin = parseMoney($('#fValorMin').value);
  const vmax = parseMoney($('#fValorMax').value);

  State.filtered = State.raw.filter(r=>{
    if (q){
      const hay = [r.descricao,r.documento,r.conta].join(' ').toLowerCase();
      if (!hay.includes(q)) return false;
    }
    if (st && r.status !== st) return false;
    if (tp && r.tipo !== tp) return false;
    if (cta && r.conta !== cta) return false;
    if (di && (r.data||'') < di) return false;
    if (df && (r.data||'') > df) return false;
    const val = Number(r.valor)||0;
    if ($('#fValorMin').value && val < vmin) return false;
    if ($('#fValorMax').value && val > vmax) return false;
    return true;
  });
  render();
}
function refreshContaOptions(){
  State.contas = new Set(State.raw.map(r=>r.conta).filter(Boolean));
  const sel = $('#fConta');
  const current = sel.value;
  sel.innerHTML = `<option value="">Conta — todas</option>` + [...State.contas].sort().map(c=>`<option ${current===c?'selected':''}>${c}</option>`).join('');
}

/* ========= UI: eventos ========= */
function bindUI(){
  $('#btnApplyFilters').addEventListener('click', applyFilters);
  $('#fSearch').addEventListener('input', debounce(applyFilters, 300));
  ['fStatus','fTipo','fConta','fDataIni','fDataFim','fValorMin','fValorMax'].forEach(id=>{
    $('#'+id).addEventListener('change', applyFilters);
  });

  // Ordenação
  $$('#tbl thead th.sortable').forEach(th=>{
    th.style.cursor='pointer';
    th.addEventListener('click', ()=>{
      const k = th.dataset.key;
      if (State.sortKey===k) State.sortDir = (State.sortDir==='asc'?'desc':'asc');
      else { State.sortKey=k; State.sortDir='asc'; }
      render();
    });
  });

  // paginação
  $('#pageSize').addEventListener('change', e=>{
    State.pageSize = Number(e.target.value)||25;
    State.page = 1;
    render();
  });
  $('#prevPage').addEventListener('click', ()=>{ State.page=Math.max(1, State.page-1); render();});
  $('#nextPage').addEventListener('click', ()=>{
    const maxPage = Math.max(1, Math.ceil(State.filtered.length/State.pageSize));
    State.page=Math.min(maxPage, State.page+1); render();
  });

  // ações da tabela
  $('#tbody').addEventListener('click', async (e)=>{
    const btn = e.target.closest('button');
    if (!btn) return;
    const tr = e.target.closest('tr');
    const id = Number(tr.dataset.id);
    const row = State.raw.find(r=>r.id===id);
    if (!row) return;

    if (btn.dataset.act==='save'){
      const obj = collectRow(tr, row);
      await idbPut(obj);
      Object.assign(row, obj);
      refreshContaOptions();
      applyFilters();
    }
    if (btn.dataset.act==='del'){
      if (confirm('Excluir este lançamento?')) {
        await idbDelete(id);
        State.raw = State.raw.filter(r=>r.id!==id);
        refreshContaOptions();
        applyFilters();
      }
    }
    if (btn.dataset.act==='dup'){
      const obj = collectRow(tr, row);
      delete obj.id;
      const added = await addOne(obj);
      State.raw.push(added);
      refreshContaOptions();
      applyFilters();
    }
  });

  // botões principais
  $('#btnAdd').addEventListener('click', async ()=>{
    const obj = {
      data: new Date().toISOString().slice(0,10),
      conta: '',
      descricao: '',
      documento: '',
      tipo: 'CRÉDITO',
      valor: 0,
      status: 'PENDENTE',
      observacoes: ''
    };
    const added = await addOne(obj);
    State.raw.push(added);
    State.page = 1;
    refreshContaOptions();
    applyFilters();
  });

  $('#btnClear').addEventListener('click', async ()=>{
    if (!confirm('Isto apagará TODOS os registros da base local. Continuar?')) return;
    await idbClear();
    State.raw = [];
    refreshContaOptions();
    applyFilters();
  });

  // Importar
  $('#btnImport').addEventListener('click', ()=> $('#fileInput').click());
  $('#fileInput').addEventListener('change', onFileSelected);

  // Exportar
  $('#btnExportCSV').addEventListener('click', ()=>{
    const rows = [['data','conta','descricao','documento','tipo','valor','status','observacoes']];
    for (const r of State.filtered){ // exporta filtrados; mude para State.raw se quiser todos
      rows.push([r.data,r.conta,r.descricao,r.documento,r.tipo,(Number(r.valor)||0).toFixed(2),r.status,r.observacoes||'']);
    }
    download(`conciliacao_${new Date().toISOString().slice(0,10)}.csv`, toCSV(rows), 'text/csv;charset=utf-8;');
  });

  // Backup/Restore
  $('#btnBackup').addEventListener('click', ()=>{
    const dump = JSON.stringify({exportedAt:new Date().toISOString(), items: State.raw}, null, 2);
    download(`backup_concilia_${Date.now()}.json`, dump, 'application/json');
  });
  $('#btnRestore').addEventListener('click', ()=> $('#restoreInput').click());
  $('#restoreInput').addEventListener('change', async (e)=>{
    const f = e.target.files[0];
    if (!f) return;
    const text = await f.text();
    try{
      const json = JSON.parse(text);
      if (!Array.isArray(json.items)) throw new Error('Arquivo inválido');
      if (!confirm(`Isto substituirá a base atual por ${json.items.length} registros. Continuar?`)) return;
      await idbClear();
      // remover ids para reindexar
      const cleans = json.items.map(({id, ...rest})=>rest);
      await idbAddMany(cleans);
      State.raw = await idbGetAll();
      refreshContaOptions();
      applyFilters();
      alert('Restauração concluída.');
    }catch(err){
      alert('Falha ao restaurar: '+err.message);
    }
  });

  // Modelo CSV
  $('#btnModel').addEventListener('click', ()=>{
    const rows = [
      ['data','conta','descricao','documento','tipo','valor','status','observacoes'],
      ['2025-01-05','Conta Corrente 001','Recebimento Cliente A','NF-123','CRÉDITO','1500.00','PENDENTE',''],
      ['2025-01-05','Conta Corrente 001','Pagamento Fornecedor Z','BOL-998','DÉBITO','-750.00','PENDENTE',''],
      ['2025-01-06','Conta Poupança','Juros Mensais','','CRÉDITO','12.35','CONCILIADO','Automático']
    ];
    download('modelo_conciliacao.csv', toCSV(rows), 'text/csv;charset=utf-8;');
  });

  // Normalização
  $('#btnNormalize').addEventListener('click', ()=> $('#dlgNormalize').showModal());
  $('#cancelNmz').addEventListener('click', ()=> $('#dlgNormalize').close());
  $('#applyNmz').addEventListener('click', doNormalize);

  // Sugestão de conciliação
  $('#btnSuggest').addEventListener('click', suggestConciliations);
}

function collectRow(tr, row){
  // lê células editáveis e selects
  const get = k => {
    const sel = tr.querySelector(`[data-k="${k}"]`);
    if (!sel) return row[k];
    if (sel.tagName==='SELECT') return sel.value;
    return sel.textContent.trim();
  };
  const obj = {
    id: row.id,
    data: toISODate(get('data')) || '',
    conta: get('conta') || '',
    descricao: get('descricao') || '',
    documento: get('documento') || '',
    tipo: (get('tipo')||'').toUpperCase(),
    valor: parseMoney(get('valor')),
    status: (get('status')||'PENDENTE').toUpperCase(),
    observacoes: get('observacoes') || ''
  };
  // normalizações rápidas
  if (!Tipo.includes(obj.tipo)) obj.tipo = (obj.valor>=0?'CRÉDITO':'DÉBITO');
  if (!Status.includes(obj.status)) obj.status = 'PENDENTE';
  return obj;
}
async function addOne(obj){
  return new Promise((resolve,reject)=>{
    const t = db.transaction(STORE,'readwrite');
    const s = t.objectStore(STORE);
    const req = s.add(obj);
    req.onsuccess = async ()=> {
      const id = req.result;
      const get = s.get(id);
      get.onsuccess = ()=> resolve(get.result);
      get.onerror = e => reject(e.target.error);
    };
    req.onerror = e => reject(e.target.error);
  });
}

/* ========= Importação: CSV + mapeamento ========= */
let csvHeaders = [];
let csvRows = [];

async function onFileSelected(e){
  const f = e.target.files[0];
  e.target.value = '';
  if (!f) return;
  const text = await f.text();

  if (f.name.toLowerCase().endsWith('.json')){
    // importa como restauração parcial (append)
    try{
      const json = JSON.parse(text);
      const items = Array.isArray(json.items) ? json.items : (Array.isArray(json) ? json : []);
      if (!Array.isArray(items)) throw new Error('JSON sem array de items');
      const cleans = items.map(({id, ...rest})=>rest);
      await idbAddMany(cleans);
      State.raw = await idbGetAll();
      refreshContaOptions();
      applyFilters();
      alert(`Importados ${cleans.length} registros do JSON.`);
    }catch(err){
      alert('Falha no JSON: '+err.message);
    }
    return;
  }

  // CSV
  const rows = parseCSV(text);
  if (!rows.length){ alert('CSV vazio.'); return; }
  csvHeaders = rows[0].map(h=>h.trim());
  csvRows = rows.slice(1);

  openMapDialog(csvHeaders);
}

function openMapDialog(headers){
  const fields = [
    {k:'data', label:'Data (AAAA-MM-DD)'},
    {k:'conta', label:'Conta'},
    {k:'descricao', label:'Descrição'},
    {k:'documento', label:'Documento'},
    {k:'tipo', label:'Tipo (CRÉDITO/DÉBITO)'},
    {k:'valor', label:'Valor (positivo crédito, negativo débito)'},
    {k:'status', label:'Status'},
    {k:'observacoes', label:'Observações'}
  ];
  const grid = $('#mapGrid');
  grid.innerHTML = '';
  for (const f of fields){
    const div = document.createElement('div');
    div.className = 'field';
    const sel = `<select data-map="${f.k}">
      <option value="">-- não importar --</option>
      ${headers.map(h=>`<option value="${h}">${h}</option>`).join('')}
    </select>`;
    div.innerHTML = `<div class="soft">${f.label}</div>${sel}`;
    grid.appendChild(div);
  }
  $('#dlgMap').showModal();

  $('#cancelMap').onclick = ()=> $('#dlgMap').close();
  $('#confirmMap').onclick = async ()=>{
    const map = {};
    $$('#mapGrid [data-map]').forEach(s => map[s.dataset.map] = s.value || null);

    const imported = [];
    for (const r of csvRows){
      const obj = {};
      for (const [k, col] of Object.entries(map)){
        if (!col) continue;
        const idx = csvHeaders.indexOf(col);
        obj[k] = r[idx] ?? '';
      }
      // ajustes básicos
      obj.data = toISODate(obj.data || '');
      obj.tipo = (obj.tipo||'').toUpperCase();
      if (!Tipo.includes(obj.tipo)){
        // inferir pelo sinal do valor
        const v = parseMoney(obj.valor);
        obj.tipo = v>=0 ? 'CRÉDITO' : 'DÉBITO';
      }
      obj.valor = parseMoney(obj.valor);
      obj.status = (obj.status||'PENDENTE').toUpperCase();
      if (!Status.includes(obj.status)) obj.status = 'PENDENTE';
      imported.push(obj);
    }
    await idbAddMany(imported);
    State.raw = await idbGetAll();
    $('#dlgMap').close();
    refreshContaOptions();
    applyFilters();
    alert(`Importados ${imported.length} registros do CSV.`);
  };
}

/* ========= Normalização rápida ========= */
async function doNormalize(){
  const doTrim = $('#nmzTrim').checked;
  const upTipo = $('#nmzUpperTipo').checked;
  const mapSt = $('#nmzStatusMap').checked;
  const fixDate = $('#nmzDate').checked;

  const mapStatus = {
    'PENDENTE':'PENDENTE','PEND':'PENDENTE','PENDING':'PENDENTE',
    'EM ANDAMENTO':'EM ANDAMENTO','ANDAMENTO':'EM ANDAMENTO','ABERTO':'EM ANDAMENTO','IN PROGRESS':'EM ANDAMENTO',
    'CONCILIADO':'CONCILIADO','CONC':'CONCILIADO','OK':'CONCILIADO','MATCH':'CONCILIADO',
    'DIVERGÊNCIA':'DIVERGÊNCIA','DIVERGENCIA':'DIVERGÊNCIA','ERRO':'DIVERGÊNCIA','ALERTA':'DIVERGÊNCIA'
  };

  for (const r of State.raw){
    if (doTrim){
      ['conta','descricao','documento','observacoes','status','tipo'].forEach(k=>{
        if (typeof r[k]==='string') r[k]=r[k].trim();
      });
    }
    if (upTipo){
      r.tipo = (r.tipo||'').toUpperCase();
      if (!Tipo.includes(r.tipo)){
        r.tipo = (Number(r.valor)||0) >= 0 ? 'CRÉDITO' : 'DÉBITO';
      }
    }
    if (mapSt){
      const s = (r.status||'').toUpperCase();
      r.status = mapStatus[s] || (Status.includes(s)?s:'PENDENTE');
    }
    if (fixDate){
      r.data = toISODate(r.data||'');
    }
    r.valor = Number(r.valor)||0;
    await idbPut(r);
  }
  $('#dlgNormalize').close();
  refreshContaOptions();
  applyFilters();
  alert('Normalização aplicada.');
}

/* ========= Heurística: sugerir conciliações =========
   Estratégia simples: para cada (conta, data opcional, |valor|) com pelo menos 1 CRÉDITO e 1 DÉBITO,
   marcar ambos como CONCILIADO quando ainda não conciliados.
   Obs: é uma aproximação; para regras específicas, podemos evoluir.
*/
async function suggestConciliations(){
  const byKey = new Map();
  for (const r of State.raw){
    if (r.status==='CONCILIADO') continue;
    const key = [r.conta, Math.abs(Number(r.valor)||0).toFixed(2)].join('|');
    if (!byKey.has(key)) byKey.set(key, {C:[], D:[]});
    (r.tipo==='CRÉDITO' ? byKey.get(key).C : byKey.get(key).D).push(r);
  }
  let marks = 0;
  for (const [_, grp] of byKey){
    const m = Math.min(grp.C.length, grp.D.length);
    for (let i=0;i<m;i++){
      grp.C[i].status='CONCILIADO';
      grp.D[i].status='CONCILIADO';
      await idbPut(grp.C[i]); await idbPut(grp.D[i]);
      marks += 2;
    }
  }
  applyFilters();
  alert(marks ? `Marcados ${marks} lançamentos como CONCILIADO.` : 'Nenhuma sugestão encontrada.');
}

/* ========= Estilos visuais para status nos cabeçalhos (opcional) ========= */

if (typeof navigator !== 'undefined' && 'serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('service-worker.js');
  });
}

// Export functions for tests (Node environment)
if (typeof module !== 'undefined') {
  module.exports = { parseCSV, parseMoney, toISODate };
}

