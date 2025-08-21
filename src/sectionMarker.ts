import * as THREE from 'three';

export class SectionMarker {
	public readonly line: THREE.Line;
	private readonly geometry: THREE.BufferGeometry;
	private readonly positions: Float32Array;
	private readonly sphere: THREE.Mesh;

	constructor(color = 0xcad0d7) {
		// Two-point line segment
		this.positions = new Float32Array(2 * 3);
		this.geometry = new THREE.BufferGeometry();
		this.geometry.setAttribute('position', new THREE.BufferAttribute(this.positions, 3));
		const material = new THREE.LineBasicMaterial({ color, linewidth: 1 });
		this.line = new THREE.Line(this.geometry, material);
		this.line.visible = false;
		this.line.renderOrder = 10;

		// Persistent sphere child to mark the section location (added to the line object)
		const sphereGeometry = new THREE.SphereGeometry(0.15, 8, 6);
		const sphereMaterial = new THREE.MeshBasicMaterial({ color: 0xff6b35 });
		this.sphere = new THREE.Mesh(sphereGeometry, sphereMaterial);
		this.sphere.renderOrder = 11;
		this.line.add(this.sphere);
	}

	public setVisible(v: boolean) {
		this.line.visible = v;
	}

	public update(center: THREE.Vector2, perpDir: THREE.Vector2, halfWidth: number, zAt: (x: number, y: number) => number) {
		const n = perpDir.clone().normalize();
		const a = new THREE.Vector2(center.x - n.x * halfWidth, center.y - n.y * halfWidth);
		const b = new THREE.Vector2(center.x + n.x * halfWidth, center.y + n.y * halfWidth);

		// Place bar slightly above the alignment plane (alignment is at Z=0)
		const zCenter = 0.04;
		this.positions[0] = a.x; this.positions[1] = a.y; this.positions[2] = zCenter;
		this.positions[3] = b.x; this.positions[4] = b.y; this.positions[5] = zCenter;
		(this.geometry.attributes.position as THREE.BufferAttribute).needsUpdate = true;
		this.geometry.computeBoundingSphere();

		// Update sphere position slightly above the alignment plane
		this.sphere.position.set(center.x, center.y, 0.08);
	}
}


