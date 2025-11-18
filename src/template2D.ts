import * as THREE from 'three';

export type Template2D = {
	name: string;
	// Closed loop; last segment connects back to first (outer boundary)
	vertices: { x: number; y: number }[];
	materials?: {
		name: string;
		color: number; // hex RGB
		// Closed loop inside outer boundary; non-overlapping with other materials
		polygon: { x: number; y: number }[];
	}[];
};

export function getTemplates(): Template2D[] {
	return [
		{
			name: 'R921 Footing Trench',
			vertices: [
				{ x: -0.6, y: 0.0 },
				{ x: 0.6, y: 0.0 },
				{ x: 0.6, y: -0.8 },
				{ x: -0.6, y: -0.8 }
			],
			materials: [
				{
					name: 'Excavation',
					color: 0xe67e22,
					polygon: [
						{ x: -2.5, y: 0.0 },
						{ x: 2.5, y: 0.0 },
						{ x: 0.5, y: -2.0 },
						{ x: -0.5, y: -2.0 }
					]
				},
				{
					name: 'Bedding',
					color: 0xFFDE59,
					polygon: [
						{ x: -0.8, y: -1.7 },
						{ x: 0.8, y: -1.7 },
						{ x: 0.5, y: -2.0 },
						{ x: -0.5, y: -2.0 }
					]
				},
				{
					name: 'Backfill-1',
					color: 0x7DDA58,
					polygon: [
						{ x: -2.5, y: 0.0 },
						{ x: -0.25, y: 0.0 },
						{ x: -0.25, y: -1.7 },
						{ x: -0.8, y: -1.7 }
					]
				},
				{
					name: 'Backfill-2',
					color: 0x7DDA58,
					polygon: [
						{ x: 2.5, y: 0.0 },
						{ x: 0.25, y: 0.0 },
						{ x: 0.25, y: -1.7 },
						{ x: 0.8, y: -1.7 }
					]
				}
			]
		},
		{
			name: 'Square 1.0 × 1.0 m',
			vertices: [
				{ x: -0.5, y: 0.0 },
				{ x: 0.5, y: 0.0 },
				{ x: 0.5, y: -1.0 },
				{ x: -0.5, y: -1.0 }
			],
			materials: [
				{
					name: 'Excavation',
					color: 0xc0392b,
					polygon: [
						{ x: -0.5, y: 0.0 },
						{ x: 0.5, y: 0.0 },
						{ x: 0.5, y: -1.0 },
						{ x: -0.5, y: -1.0 }
					]
				}
			]
		},
		{
			name: 'Rectangle 1.2 × 0.8 m',
			vertices: [
				{ x: -0.6, y: 0.0 },
				{ x: 0.6, y: 0.0 },
				{ x: 0.6, y: -0.8 },
				{ x: -0.6, y: -0.8 }
			],
			materials: [
				{
					name: 'Excavation',
					color: 0xe67e22,
					polygon: [
						{ x: -0.6, y: 0.0 },
						{ x: 0.6, y: 0.0 },
						{ x: 0.6, y: -1.8 },
						{ x: -0.6, y: -1.8 }
					]
				},
				{
					name: 'Backfill',
					color: 0x3498db,
					polygon: [
						{ x: -0.4, y: 0.0 },
						{ x: 0.4, y: 0.0 },
						{ x: 0.4, y: -0.6 },
						{ x: -0.4, y: -0.6 }
					]
				}
			]
		}
	];
}

export function polygonArea(vertices: { x: number; y: number }[]): number {
	const v = vertices;
	let area = 0;
	for (let i = 0; i < v.length; i++) {
		const a = v[i];
		const b = v[(i + 1) % v.length];
		area += a.x * b.y - b.x * a.y;
	}
	return Math.abs(area) * 0.5;
}

export function computeTemplateArea(template: Template2D): number {
	// Ignore template.vertices for calculations; use sum of material polygon areas instead
	const mats = template.materials ?? [];
	if (mats.length === 0) return 0;
	return mats.reduce((sum, m) => sum + polygonArea(m.polygon), 0);
}

export function computePathLength(points3D: readonly THREE.Vector3[]): number {
	let len = 0;
	for (let i = 1; i < points3D.length; i++) {
		len += points3D[i].distanceTo(points3D[i - 1]);
	}
	return len;
}

export function computeSweepVolume(template: Template2D, path3D: readonly THREE.Vector3[]): number {
	// Ignore template.vertices for volume; sum volumes of material polygons only
	const vols = computeMaterialVolumes(template, path3D);
	return vols.reduce((sum, v) => sum + v.volume, 0);
}

export function computeMaterialVolumes(template: Template2D, path3D: readonly THREE.Vector3[]): { materialName: string; color: number; volume: number }[] {
	const L = computePathLength(path3D);
	const mats = template.materials ?? [];
	return mats.map(m => ({
		materialName: m.name,
		color: m.color,
		volume: polygonArea(m.polygon) * L
	}));
}

export function sweepTemplateAlong(path3D: readonly THREE.Vector3[], template: Template2D): THREE.Mesh {
	if (path3D.length < 2 || template.vertices.length < 3) {
		return new THREE.Mesh(new THREE.BufferGeometry(), new THREE.MeshBasicMaterial({ visible: false }));
	}

	const up = new THREE.Vector3(0, 0, 1);

	const cols = template.vertices.length;
	const rows = path3D.length;
	const positions: number[] = [];
	const normals: number[] = [];
	const indices: number[] = [];

	// Build frames and vertices
	for (let i = 0; i < rows; i++) {
		const pPrev = path3D[Math.max(0, i - 1)];
		const pNext = path3D[Math.min(rows - 1, i + 1)];
		const tanXY = new THREE.Vector2(pNext.x - pPrev.x, pNext.y - pPrev.y);
		if (tanXY.lengthSq() < 1e-12) tanXY.set(1, 0);
		tanXY.normalize();
		const left = new THREE.Vector3(-tanXY.y, tanXY.x, 0).normalize();
		const down = up.clone().multiplyScalar(-1);
		const p = path3D[i];

		for (let j = 0; j < cols; j++) {
			const { x, y } = template.vertices[j];
			// CAD convention: negative x = left of path, negative y = down
			const vx = -left.x * x + up.x * y;
			const vy = -left.y * x + up.y * y;
			const vz = -left.z * x + up.z * y;
			positions.push(p.x + vx, p.y + vy, p.z + vz);
			// Approx normal (side normal pointing outward roughly along left)
			normals.push(left.x, left.y, left.z);
		}
	}

	// Connect rings
	for (let r = 0; r < rows - 1; r++) {
		for (let c = 0; c < cols; c++) {
			const cNext = (c + 1) % cols;
			const i0 = r * cols + c;
			const i1 = r * cols + cNext;
			const i2 = (r + 1) * cols + c;
			const i3 = (r + 1) * cols + cNext;
			indices.push(i0, i2, i1);
			indices.push(i1, i2, i3);
		}
	}

	const geom = new THREE.BufferGeometry();
	geom.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
	geom.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
	geom.setIndex(indices);
	geom.computeVertexNormals();

	const mat = new THREE.MeshStandardMaterial({
		color: 0x16a085,
		metalness: 0.0,
		roughness: 1.0,
		side: THREE.DoubleSide,
		transparent: true,
		opacity: 0.45
	});
	const mesh = new THREE.Mesh(geom, mat);
	mesh.renderOrder = 4;
	return mesh;
}

export function sweepPolygonAlong(path3D: readonly THREE.Vector3[], vertices: { x: number; y: number }[], color: number, opacity = 0.45): THREE.Mesh {
	if (path3D.length < 2 || vertices.length < 3) {
		return new THREE.Mesh(new THREE.BufferGeometry(), new THREE.MeshBasicMaterial({ visible: false }));
	}
	const up = new THREE.Vector3(0, 0, 1);
	const cols = vertices.length;
	const rows = path3D.length;
	const positions: number[] = [];
	const normals: number[] = [];
	const indices: number[] = [];
	for (let i = 0; i < rows; i++) {
		const pPrev = path3D[Math.max(0, i - 1)];
		const pNext = path3D[Math.min(rows - 1, i + 1)];
		const tanXY = new THREE.Vector2(pNext.x - pPrev.x, pNext.y - pPrev.y);
		if (tanXY.lengthSq() < 1e-12) tanXY.set(1, 0);
		tanXY.normalize();
		const left = new THREE.Vector3(-tanXY.y, tanXY.x, 0).normalize();
		const down = up.clone().multiplyScalar(-1);
		const p = path3D[i];
		for (let j = 0; j < cols; j++) {
			const { x, y } = vertices[j];
			// CAD convention: negative x = left of path, negative y = down
			const vx = -left.x * x + up.x * y;
			const vy = -left.y * x + up.y * y;
			const vz = -left.z * x + up.z * y;
			positions.push(p.x + vx, p.y + vy, p.z + vz);
			normals.push(left.x, left.y, left.z);
		}
	}
	for (let r = 0; r < rows - 1; r++) {
		for (let c = 0; c < cols; c++) {
			const cNext = (c + 1) % cols;
			const i0 = r * cols + c;
			const i1 = r * cols + cNext;
			const i2 = (r + 1) * cols + c;
			const i3 = (r + 1) * cols + cNext;
			indices.push(i0, i2, i1);
			indices.push(i1, i2, i3);
		}
	}
	const geom = new THREE.BufferGeometry();
	geom.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
	geom.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
	geom.setIndex(indices);
	geom.computeVertexNormals();
	const mat = new THREE.MeshStandardMaterial({
		color,
		metalness: 0.0,
		roughness: 1.0,
		side: THREE.DoubleSide,
		transparent: true,
		opacity
	});
	const mesh = new THREE.Mesh(geom, mat);
	mesh.renderOrder = 4;
	return mesh;
}

export function sweepTemplateGroupAlong(path3D: readonly THREE.Vector3[], template: Template2D): THREE.Group {
	const group = new THREE.Group();
	// Do not render template.vertices; only render material polygons
	for (const m of (template.materials ?? [])) {
		group.add(sweepPolygonAlong(path3D, m.polygon, m.color, 0.45));
	}
	return group;
}

