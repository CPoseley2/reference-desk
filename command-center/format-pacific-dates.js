(function () {
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Los_Angeles',
    month: '2-digit', day: '2-digit', year: '2-digit',
    hour: '2-digit', minute: '2-digit', hourCycle: 'h23'
  });
  window.formatPacificTimestamp = function (value) {
    if (!value) return 'Date unavailable';
    const date = new Date(value);
    if (!Number.isFinite(date.getTime())) return 'Date unavailable';
    const parts = Object.fromEntries(formatter.formatToParts(date).map(p => [p.type, p.value]));
    return `${parts.month}/${parts.day}/${parts.year} @ ${parts.hour}:${parts.minute} PT`;
  };
})();
