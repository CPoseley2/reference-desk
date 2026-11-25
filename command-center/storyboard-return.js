(() => {
  const params = new URLSearchParams(location.search);
  const back = document.querySelector('.banner > a[href="index.html"]');
  if (back) {
    const id = params.get('id');
    if (id) back.href = 'index.html?storyboard=' + encodeURIComponent(id);
    return;
  }
  const id = params.get('storyboard');
  if (!id || !window.CATALOG || !window.COMMAND_CENTER) return;
  const entry = window.CATALOG.entries.find(e => e.id === id);
  const films = window.COMMAND_CENTER.acts.flatMap(a => a.films);
  const film = films.find(f => f.entry_id === id || f.versions.includes(id)) || (entry && films.find(f => f.catalog_song === entry.song));
  const card = film
    ? [...document.querySelectorAll('article.card[data-film]')].find(c => c.dataset.film === film.id)
    : [...document.querySelectorAll('#songs article.card')].find(c => [...c.querySelectorAll('a[href]')].some(a => new URL(a.href).searchParams.get('id') === id));
  if (!card) return;
  for (let ancestor = card.parentElement; ancestor; ancestor = ancestor.parentElement) {
    if (ancestor.tagName === 'DETAILS') ancestor.open = true;
  }
  const center = () => requestAnimationFrame(() => requestAnimationFrame(() => {
    card.scrollIntoView({ block: 'center', inline: 'center', behavior: 'instant' });
    const heading = card.querySelector('h2');
    if (heading) { heading.tabIndex = -1; heading.focus({ preventScroll: true }); }
  }));
  // Keep the return target centered while initial analysis panels settle.
  // Stop immediately on user input so later scrolling remains under their control.
  let stopped = false, pendingFrame;
  const observer = new ResizeObserver(() => {
    if (stopped) return;
    cancelAnimationFrame(pendingFrame);
    pendingFrame = requestAnimationFrame(() => { if (!stopped) card.scrollIntoView({ block: 'center', inline: 'center', behavior: 'instant' }); });
  });
  const stop = () => { stopped = true; observer.disconnect(); cancelAnimationFrame(pendingFrame); };
  observer.observe(document.querySelector('main')); observer.observe(card);
  for (const event of ['wheel', 'touchstart', 'pointerdown', 'keydown']) window.addEventListener(event, stop, { once: true, passive: true });
  setTimeout(stop, 5000);
  if (document.readyState === 'complete') center();
  else window.addEventListener('load', center, { once: true });
})();
