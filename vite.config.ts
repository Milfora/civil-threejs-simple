import { defineConfig } from 'vite';
import fs from 'fs';
import path from 'path';

export default defineConfig({
	base: './',
	build: {
		outDir: 'dist',
		emptyOutDir: true
	},
	server: {
		open: true
	},
	plugins: [
		{
			name: 'alignment-save-middleware',
			configureServer(server) {
				server.middlewares.use('/api/save-alignment', (req, res, next) => {
					if (req.method !== 'POST') return next();
					let body = '';
					req.on('data', (chunk) => { body += chunk; });
					req.on('end', () => {
						try {
							const json = JSON.parse(body || '{}');
							const fileSafe = (s: string) => s.replace(/[^a-z0-9-_\.]/gi, '_');
							const dir = path.join(process.cwd(), 'data');
							fs.mkdirSync(dir, { recursive: true });
							const filename = fileSafe(json?.filename ?? 'alignment.json');
							const outPath = path.join(dir, filename);
							const payload = json?.alignment ?? json;
							fs.writeFileSync(outPath, JSON.stringify(payload, null, 2), 'utf-8');
							res.setHeader('Content-Type', 'application/json');
							res.end(JSON.stringify({ ok: true, path: outPath }));
						} catch (err: any) {
							res.statusCode = 500;
							res.setHeader('Content-Type', 'application/json');
							res.end(JSON.stringify({ ok: false, error: String(err?.message ?? err) }));
						}
					});
				});
			}
		}
	]
});


