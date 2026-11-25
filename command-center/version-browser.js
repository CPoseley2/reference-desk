(() => {
  const entries = new Map(window.CATALOG.entries.map(e => [e.id, e]));
  const created = window.VERSION_CREATED || {};
  const storageKey = 'owl-storyboard-version-pins-v1';
  let pins;
  try { pins = new Set(JSON.parse(localStorage.getItem(storageKey) || '[]')); } catch { pins = new Set(); }
  const dayFormat = new Intl.DateTimeFormat('en-US', { timeZone: 'America/Los_Angeles', year: 'numeric', month: '2-digit', day: '2-digit' });
  function day(value) {
    if (!value) return '';
    const date = new Date(value); if (!Number.isFinite(date.getTime())) return '';
    const p = Object.fromEntries(dayFormat.formatToParts(date).map(x => [x.type, x.value]));
    return `${p.year}-${p.month}-${p.day}`;
  }
  const lists = [];
  document.querySelectorAll('.version[data-version-id]').forEach(row => {
    const id = row.dataset.versionId, entry = entries.get(id);
    const button = document.createElement('button'); button.type = 'button'; button.className = 'version-pin';
    button.innerHTML = '<svg aria-hidden="true" viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.7"><path d="m9 3 6 0-1 6 4 4v2H6v-2l4-4-1-6ZM12 15v7"/></svg>';
    function update() { const on = pins.has(id); button.setAttribute('aria-pressed', String(on)); button.setAttribute('aria-label', `${on ? 'Unpin' : 'Pin'} ${entry.title}`); button.title = on ? 'Unpin version' : 'Pin version'; }
    update(); row.prepend(button);
    button.addEventListener('click', () => {
      const on = pins.has(id); on ? pins.delete(id) : pins.add(id);
      try { localStorage.setItem(storageKey, JSON.stringify([...pins])); } catch { on ? pins.add(id) : pins.delete(id); alert('The pin could not be saved. Please allow local storage and try again.'); }
      update(); lists.forEach(list => list());
    });
    const stamp = row.querySelector('.version-date');
    if (created[id]) { stamp.textContent = 'Created ' + formatPacificTimestamp(created[id]); stamp.title = 'Source file creation time · Pacific'; }
    else { stamp.textContent = 'Modified ' + formatPacificTimestamp(entry.modified); stamp.title = 'Creation date unavailable; showing last modified time'; }
  });
  const parents = new Set([...document.querySelectorAll('.version[data-version-id]')].map(row => row.parentElement));
  for (const parent of parents) {
    const rows = [...parent.children].filter(el => el.classList.contains('version') && el.dataset.versionId);
    const controls = document.createElement('div'); controls.className = 'version-controls';
    controls.innerHTML = '<label>Name<input type="search" class="version-name" placeholder="Search versions…"></label><div class="version-date-range"><label>Created from<input type="date" class="version-from"></label><label>Created through<input type="date" class="version-through"></label></div><label>Sort<select class="version-sort"><option value="newest">Newest created first</option><option value="oldest">Oldest created first</option><option value="name">Name A–Z</option><option value="pinned">Pinned first</option></select></label><div class="version-filter-footer"><label><input type="checkbox" class="version-pinned"> Pinned only</label><button type="button" class="version-clear">Clear filters</button></div><small class="version-result" role="status" aria-live="polite"></small>';
    parent.insertBefore(controls, rows[0]);
    const input = controls.querySelector('.version-name'), from = controls.querySelector('.version-from'), through = controls.querySelector('.version-through'), sort = controls.querySelector('.version-sort'), pinned = controls.querySelector('.version-pinned'), result = controls.querySelector('.version-result');
    const filterDisclosure = document.createElement('details');
    filterDisclosure.className = 'version-filter-panel';
    const filterToggle = document.createElement('summary');
    filterToggle.className = 'catalog-action';
    filterToggle.title = 'Version filters'; filterToggle.setAttribute('aria-label', 'Version filters');
    filterToggle.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M3 4h18l-7 8v7l-4 2v-9L3 4Z"/></svg>';
    controls.before(filterDisclosure); filterDisclosure.append(filterToggle, controls); filterDisclosure.after(result);
    function render() {
      const query = input.value.trim().toLowerCase(); let visible = 0;
      const ordered = rows.slice().sort((a, b) => {
        const ai = a.dataset.versionId, bi = b.dataset.versionId;
        if (sort.value === 'pinned' && pins.has(ai) !== pins.has(bi)) return pins.has(ai) ? -1 : 1;
        if (sort.value === 'name') return entries.get(ai).title.localeCompare(entries.get(bi).title);
        const at = Date.parse(created[ai]) || 0, bt = Date.parse(created[bi]) || 0;
        if (!at || !bt) return at ? -1 : bt ? 1 : 0;
        return sort.value === 'oldest' ? at - bt : bt - at;
      });
      ordered.forEach(row => {
        const id = row.dataset.versionId, e = entries.get(id), date = day(created[id]);
        const name = (e.title + ' ' + e.path.split('/').slice(-2).join(' ')).toLowerCase();
        row.hidden = !(name.includes(query) && (!pinned.checked || pins.has(id)) && (!from.value || date && date >= from.value) && (!through.value || date && date <= through.value));
        if (!row.hidden) visible++; parent.append(row);
      });
      result.textContent = `${visible} of ${rows.length} versions` + (from.value && through.value && from.value > through.value ? ' · Start date must precede end date' : '');
    }
    controls.addEventListener('input', render); controls.addEventListener('change', render);
    controls.querySelector('.version-clear').onclick = () => { input.value = from.value = through.value = ''; pinned.checked = false; sort.value = 'newest'; render(); };
    lists.push(render); render();
  }
})();
