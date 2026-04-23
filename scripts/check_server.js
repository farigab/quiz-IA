(async () => {
  const base = process.argv[2] || 'http://localhost:3001';
  const paths = ['/', '/index.html', '/config.js', '/package.json', '/server.js'];

  for (const p of paths) {
    try {
      const url = base + p;
      const res = await fetch(url);
      const text = await res.text().catch(() => '');
      const snippet = text ? text.slice(0, 240).replace(/\s+/g, ' ') : '(no body)';
      console.log(`${p} -> ${res.status} ${res.statusText} - ${snippet}`);
    } catch (err) {
      console.error(`${p} -> ERROR ${err.message}`);
    }
  }
})();
