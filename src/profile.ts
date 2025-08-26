import * as THREE from 'three';
import { theme2D } from './theme';
import { HeightFunction } from './surface';

export interface ProfileData {
	chainages: number[];
	elevations: number[]; // existing ground along alignment
	minZ: number;
	maxZ: number;
	length: number;
	gradeStartZ: number; // design grade IP at start, matched to surface
	gradeEndZ: number;   // design grade IP at end, matched to surface
	gradeIPs?: { s: number; z: number }[]; // optional editable IPs including ends
}

export class ProfileOverlay {
	private readonly container: HTMLDivElement;
	private readonly canvas: HTMLCanvasElement;
	private readonly ctx: CanvasRenderingContext2D;
	public active = false;
	private isDragging = false;
	private dragOffsetX = 0;
	private dragOffsetY = 0;
	// Pan/zoom state
	private viewXMin?: number;
	private viewXMax?: number;
	private viewYMin?: number;
	private viewYMax?: number;
	private isPanningPlot = false;
	private panLastX = 0;
	private panLastY = 0;
	// Grade editing state
	public onGradeChange?: (o: { startZ?: number; endZ?: number }) => void;
	private designStartZ?: number;
	private designEndZ?: number;
	private draggingHandle: null | 'start' | 'end' = null;
	private resizeObserver?: ResizeObserver;
	private lastProfile?: ProfileData;
	private gradeIPs: { s: number; z: number }[] = [];
	private lastTitle?: string;
	private lastMarkerChainage?: number;

	constructor(containerId = 'profile-overlay', canvasId = 'profile-canvas') {
		const container = document.getElementById(containerId) as HTMLDivElement | null;
		const canvas = document.getElementById(canvasId) as HTMLCanvasElement | null;
		if (!container || !canvas) throw new Error('ProfileOverlay DOM not found');
		const ctx = canvas.getContext('2d');
		if (!ctx) throw new Error('2D context not available');

		this.container = container;
		this.canvas = canvas;
		this.ctx = ctx;

		this.setupDrag();
		this.setupInteractions();
		this.setupResizeObserver();
	}

	public setActive(on: boolean) {
		this.active = on;
		this.container.classList.toggle('hidden', !on);
		if (on && this.lastProfile) {
			this.draw(this.lastProfile, this.lastTitle, this.lastMarkerChainage);
		}
	}

	private setupInteractions() {
		// Wheel zoom and drag pan inside plot area
		this.canvas.addEventListener('wheel', (e: WheelEvent) => {
			if (!this.active || !this.lastProfile) return;
			e.preventDefault();
			const rect = this.canvas.getBoundingClientRect();
			const px = e.clientX - rect.left;
			const py = e.clientY - rect.top;
			const w = this.container.clientWidth;
			const h = this.container.clientHeight - 32;
			const padL = 44, padR = 12, padT = 10, padB = 26;
			const plotW = Math.max(10, w - padL - padR);
			const plotH = Math.max(10, h - padT - padB);
			if (px < padL || px > padL + plotW || py < padT || py > padT + plotH) return;
			const p = this.lastProfile;
			const dataXMin = 0;
			const dataXMax = Math.max(1, p.length);
			const minX = this.viewXMin ?? dataXMin;
			const maxX = this.viewXMax ?? dataXMax;
			const minYData = this.viewYMin ?? p.minZ;
			const maxYData = this.viewYMax ?? p.maxZ;
			const rangeX = Math.max(1e-6, maxX - minX);
			const rangeY = Math.max(1e-6, maxYData - minYData);
			const xAtCursor = minX + ((px - padL) / plotW) * rangeX;
			const yAtCursor = maxYData - ((py - padT) / plotH) * rangeY;
			const factor = Math.pow(1.0015, -e.deltaY);
			if (e.shiftKey) {
				// Zoom Y only
				const newRangeY = THREE.MathUtils.clamp(rangeY / factor, 0.5, (p.maxZ - p.minZ) * 10 + 1000);
				const newMinY = yAtCursor - (yAtCursor - minYData) * (newRangeY / rangeY);
				const newMaxY = newMinY + newRangeY;
				this.viewYMin = newMinY;
				this.viewYMax = newMaxY;
			} else {
				// Zoom X only
				const newRangeX = THREE.MathUtils.clamp(rangeX / factor, 1, (dataXMax - dataXMin) * 10 + 1000);
				const newMinX = xAtCursor - (xAtCursor - minX) * (newRangeX / rangeX);
				const newMaxX = newMinX + newRangeX;
				this.viewXMin = newMinX;
				this.viewXMax = newMaxX;
			}
			this.draw(this.lastProfile, this.lastTitle, this.lastMarkerChainage);
		}, { passive: false });

		// Prevent default context menu so right-click can add an IP cleanly
		this.canvas.addEventListener('contextmenu', (e: MouseEvent) => {
			e.preventDefault();
			return false as unknown as void;
		});

		this.canvas.addEventListener('mousedown', (e: MouseEvent) => {
			if (!this.active || !this.lastProfile) return;
			const isLeft = e.button === 0;
			const isRight = e.button === 2;
			if (!isLeft && !isRight) return;
			const rect = this.canvas.getBoundingClientRect();
			const px = e.clientX - rect.left;
			const py = e.clientY - rect.top;
			const w = this.container.clientWidth;
			const h = this.container.clientHeight - 32;
			const padL = 44, padR = 12, padT = 10, padB = 26;
			const plotW = Math.max(10, w - padL - padR);
			const plotH = Math.max(10, h - padT - padB);
			if (px < padL || px > padL + plotW || py < padT || py > padT + plotH) return;
			// Handle hit test near grade IPs
			const minX = this.viewXMin ?? 0;
			const maxX = this.viewXMax ?? Math.max(1, this.lastProfile.length);
			const minY = this.viewYMin ?? this.lastProfile.minZ;
			const maxY = this.viewYMax ?? this.lastProfile.maxZ;
			const xToPx = (x: number) => padL + ((x - minX) / (maxX - minX)) * plotW;
			const yToPx = (y: number) => padT + (1 - (y - minY) / (maxY - minY)) * plotH;
			const ips = [...this.gradeIPs].sort((a, b) => a.s - b.s);
			const r = 8;
			// Right-click adds a new IP snapped to grade line at clicked s
			if (isRight) {
				const sAt = minX + ((px - padL) / plotW) * (maxX - minX);
				// Evaluate current grade at sAt by segment interpolation
				let zAt = ips[0]?.z ?? this.lastProfile.gradeStartZ;
				for (let i = 0; i < ips.length - 1; i++) {
					const a = ips[i];
					const b = ips[i + 1];
					if (sAt >= a.s && sAt <= b.s) {
						const t = (sAt - a.s) / Math.max(1e-9, (b.s - a.s));
						zAt = THREE.MathUtils.lerp(a.z, b.z, t);
						break;
					}
				}
				this.gradeIPs.push({ s: THREE.MathUtils.clamp(sAt, 0, this.lastProfile.length), z: zAt });
				this.gradeIPs.sort((a, b) => a.s - b.s);
				this.onGradeChange?.({});
				this.draw(this.lastProfile, this.lastTitle, this.lastMarkerChainage);
				e.preventDefault();
				return;
			}
			// Left: try dragging an existing IP (nearest within radius)
			let closestIdx = -1;
			let closestDist = Infinity;
			for (let i = 0; i < ips.length; i++) {
				const pxIP = xToPx(THREE.MathUtils.clamp(ips[i].s, 0, this.lastProfile.length));
				const pyIP = yToPx(ips[i].z);
				const d = Math.hypot(px - pxIP, py - pyIP);
				if (d < closestDist) { closestDist = d; closestIdx = i; }
			}
			if (closestIdx !== -1 && closestDist <= r) {
				// Mark which handle logically: start/end if at ends; else a generic drag via storing index in startZ
				if (closestIdx === 0) this.draggingHandle = 'start';
				else if (closestIdx === ips.length - 1) this.draggingHandle = 'end';
				else this.draggingHandle = 'end'; // reuse path, but we will update by index
				// Store index using panLastX as a slot (avoid new fields):
				(this as any)._dragIPIndex = closestIdx;
				e.preventDefault();
				return;
			}
			this.isPanningPlot = true;
			this.panLastX = px;
			this.panLastY = py;
			e.preventDefault();
		});

		window.addEventListener('mousemove', (e: MouseEvent) => {
			if (!this.lastProfile) return;
			const rect = this.canvas.getBoundingClientRect();
			const px = e.clientX - rect.left;
			const py = e.clientY - rect.top;
			const w = this.container.clientWidth;
			const h = this.container.clientHeight - 32;
			const padL = 44, padR = 12, padT = 10, padB = 26;
			const plotW = Math.max(10, w - padL - padR);
			const plotH = Math.max(10, h - padT - padB);
			const minX = this.viewXMin ?? 0;
			const maxX = this.viewXMax ?? Math.max(1, this.lastProfile.length);
			const minY = this.viewYMin ?? this.lastProfile.minZ;
			const maxY = this.viewYMax ?? this.lastProfile.maxZ;
			if (this.draggingHandle) {
				const yToVal = (pyPix: number) => minY + (1 - (pyPix - padT) / plotH) * (maxY - minY);
				const newZ = yToVal(py);
				const ips = [...this.gradeIPs].sort((a, b) => a.s - b.s);
				const idx = (this as any)._dragIPIndex as number | undefined;
				if (idx !== undefined) {
					// Update Z always
					ips[idx].z = newZ;
					// Allow horizontal move for intermediate IPs (keep ends fixed at 0 and length)
					if (idx > 0 && idx < ips.length - 1) {
						const sAt = minX + ((px - padL) / plotW) * (maxX - minX);
						const leftBound = ips[idx - 1].s + 0.001;
						const rightBound = ips[idx + 1].s - 0.001;
						ips[idx].s = THREE.MathUtils.clamp(sAt, leftBound, rightBound);
					}
					this.gradeIPs = ips;
					this.onGradeChange?.({});
				} else if (this.draggingHandle === 'start') {
					ips[0].z = newZ;
					this.gradeIPs = ips;
					this.onGradeChange?.({ startZ: newZ });
				} else if (this.draggingHandle === 'end') {
					ips[ips.length - 1].z = newZ;
					this.gradeIPs = ips;
					this.onGradeChange?.({ endZ: newZ });
				}
				this.draw(this.lastProfile, this.lastTitle, this.lastMarkerChainage);
				return;
			}
			if (!this.isPanningPlot) return;
			const rangeX = Math.max(1e-6, maxX - minX);
			const rangeY = Math.max(1e-6, maxY - minY);
			const metersPerPxX = rangeX / plotW;
			const metersPerPxY = rangeY / plotH;
			const dx = (this.panLastX - px) * metersPerPxX;
			const dy = (py - this.panLastY) * metersPerPxY; // drag up moves view up
			this.viewXMin = minX + dx;
			this.viewXMax = maxX + dx;
			this.viewYMin = minY + dy;
			this.viewYMax = maxY + dy;
			this.panLastX = px;
			this.panLastY = py;
			this.draw(this.lastProfile, this.lastTitle, this.lastMarkerChainage);
		});

		window.addEventListener('mouseup', () => {
			this.isPanningPlot = false;
			this.draggingHandle = null;
			(this as any)._dragIPIndex = undefined;
		});

		this.canvas.addEventListener('dblclick', () => {
			// Reset view
			this.viewXMin = undefined;
			this.viewXMax = undefined;
			this.viewYMin = undefined;
			this.viewYMax = undefined;
			if (this.lastProfile) this.draw(this.lastProfile, this.lastTitle, this.lastMarkerChainage);
		});
	}

	private setupDrag() {
		const header = this.container.querySelector('.overlay-header') as HTMLDivElement | null;
		if (!header) return;
		const closeBtn = header.querySelector('.overlay-close') as HTMLButtonElement | null;
		if (closeBtn) {
			closeBtn.addEventListener('mousedown', (e: MouseEvent) => {
				e.stopPropagation();
				e.preventDefault();
			});
			closeBtn.addEventListener('click', (e: MouseEvent) => {
				e.stopPropagation();
				this.setActive(false);
			});
		}

		header.addEventListener('mousedown', (e: MouseEvent) => {
			this.isDragging = true;
			const rect = this.container.getBoundingClientRect();
			this.dragOffsetX = e.clientX - rect.left;
			this.dragOffsetY = e.clientY - rect.top;
			e.preventDefault();
		});

		window.addEventListener('mousemove', (e: MouseEvent) => {
			if (!this.isDragging) return;
			const maxLeft = Math.max(0, window.innerWidth - this.container.clientWidth);
			const maxTop = Math.max(0, window.innerHeight - this.container.clientHeight);
			let left = e.clientX - this.dragOffsetX;
			let top = e.clientY - this.dragOffsetY;
			left = Math.min(Math.max(0, left), maxLeft);
			top = Math.min(Math.max(0, top), maxTop);
			this.container.style.left = `${left}px`;
			this.container.style.top = `${top}px`;
		});

		window.addEventListener('mouseup', () => {
			this.isDragging = false;
		});
	}

	public computeProfile(
		centerline: readonly THREE.Vector2[],
		heightFn: HeightFunction
	): ProfileData {
		const chainages: number[] = [0];
		const elevations: number[] = [];
		let minZ = Number.POSITIVE_INFINITY;
		let maxZ = Number.NEGATIVE_INFINITY;

		for (let i = 1; i < centerline.length; i++) {
			const d = centerline[i].distanceTo(centerline[i - 1]);
			chainages.push(chainages[i - 1] + d);
		}
		for (let i = 0; i < centerline.length; i++) {
			const p = centerline[i];
			const z = heightFn(p.x, p.y);
			elevations.push(z);
			if (z < minZ) minZ = z;
			if (z > maxZ) maxZ = z;
		}

		const length = chainages[chainages.length - 1] ?? 0;
		const gradeStartZ = elevations[0] ?? 0;
		const gradeEndZ = elevations[elevations.length - 1] ?? 0;

		// Expand slight margin
		if (Math.abs(maxZ - minZ) < 1e-3) {
			maxZ += 0.5;
			minZ -= 0.5;
		}

		return { chainages, elevations, minZ, maxZ, length, gradeStartZ, gradeEndZ };
	}

	public draw(profile: ProfileData, title?: string, markerChainage?: number) {
		// Cache for redraws
		this.lastProfile = profile;
		this.lastTitle = title;
		this.lastMarkerChainage = markerChainage;
		// Ensure grade IPs include ends
		if (this.gradeIPs.length === 0) {
			this.gradeIPs = [
				{ s: 0, z: this.designStartZ ?? profile.gradeStartZ },
				{ s: profile.length, z: this.designEndZ ?? profile.gradeEndZ }
			];
		}
		const w = this.container.clientWidth;
		const h = this.container.clientHeight - 32;
		if (w <= 0 || h <= 0) return;
		this.canvas.width = w;
		this.canvas.height = h;

		const ctx = this.ctx;
		ctx.clearRect(0, 0, w, h);

		const padL = 44, padR = 12, padT = 10, padB = 26;
		const plotW = Math.max(10, w - padL - padR);
		const plotH = Math.max(10, h - padT - padB);

		const minX = this.viewXMin ?? 0;
		const maxX = this.viewXMax ?? Math.max(1, profile.length);
		const minY = this.viewYMin ?? profile.minZ;
		const maxY = this.viewYMax ?? profile.maxZ;
		const xToPx = (x: number) => padL + ((x - minX) / (maxX - minX)) * plotW;
		const yToPx = (y: number) => padT + (1 - (y - minY) / (maxY - minY)) * plotH;

		// Grid
		ctx.strokeStyle = theme2D.grid;
		ctx.lineWidth = 1;
		ctx.beginPath();
		for (let i = 0; i <= 4; i++) {
			const y = padT + (i / 4) * plotH;
			ctx.moveTo(padL, y); ctx.lineTo(padL + plotW, y);
		}
		for (let i = 0; i <= 8; i++) {
			const x = padL + (i / 8) * plotW;
			ctx.moveTo(x, padT); ctx.lineTo(x, padT + plotH);
		}
		ctx.stroke();

		// Axes border
		ctx.strokeStyle = theme2D.axes;
		ctx.lineWidth = 1.2;
		ctx.beginPath();
		ctx.rect(padL, padT, plotW, plotH);
		ctx.stroke();

		// Labels
		ctx.fillStyle = theme2D.labels;
		ctx.font = '11px ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Ubuntu, Cantarell, Noto Sans';
		ctx.fillText(`${title ?? ''}`, padL + 6, padT + 14);
		ctx.fillText(`z [m]`, 6, padT + 12);
		ctx.fillText(`s [m]`, w - 42, h - 6);

		// Existing ground profile polyline
		ctx.strokeStyle = theme2D.polyline;
		ctx.lineWidth = 2;
		ctx.beginPath();
		for (let i = 0; i < profile.chainages.length; i++) {
			const x = xToPx(profile.chainages[i]);
			const y = yToPx(profile.elevations[i]);
			if (i === 0) ctx.moveTo(x, y);
			else ctx.lineTo(x, y);
		}
		ctx.stroke();

		// Tracking marker at current chainage, if provided
		if (markerChainage !== undefined) {
			const s = THREE.MathUtils.clamp(markerChainage, minX, maxX);
			const xm = xToPx(s);
			ctx.strokeStyle = theme2D.daylight;
			ctx.lineWidth = 1.6;
			ctx.setLineDash([4, 3]);
			ctx.beginPath();
			ctx.moveTo(xm, padT);
			ctx.lineTo(xm, padT + plotH);
			ctx.stroke();
			ctx.setLineDash([]);
		}

		// Piecewise-linear grade line using gradeIPs
		const ips = [...this.gradeIPs].sort((a, b) => a.s - b.s);
		ctx.strokeStyle = theme2D.axes;
		ctx.lineWidth = 1.8;
		ctx.setLineDash([6, 6]);
		ctx.beginPath();
		for (let i = 0; i < ips.length; i++) {
			const px = xToPx(THREE.MathUtils.clamp(ips[i].s, 0, profile.length));
			const py = yToPx(ips[i].z);
			if (i === 0) ctx.moveTo(px, py);
			else ctx.lineTo(px, py);
		}
		ctx.stroke();
		ctx.setLineDash([]);

		// IP markers (draggable) – draw each circle in its own path to avoid polygon fill
		ctx.fillStyle = theme2D.marker;
		for (const ip of ips) {
			const px = xToPx(THREE.MathUtils.clamp(ip.s, 0, profile.length));
			const py = yToPx(ip.z);
			ctx.beginPath();
			ctx.arc(px, py, 3, 0, Math.PI * 2);
			ctx.fill();
		}
	}

	public setDesignOverrides(startZ?: number, endZ?: number) {
		this.designStartZ = startZ;
		this.designEndZ = endZ;
		if (this.lastProfile) this.draw(this.lastProfile, this.lastTitle, this.lastMarkerChainage);
	}

	private setupResizeObserver() {
		if (!('ResizeObserver' in window)) return;
		this.resizeObserver = new ResizeObserver(() => {
			if (!this.active) return;
			if (this.lastProfile) {
				this.draw(this.lastProfile, this.lastTitle, this.lastMarkerChainage);
			}
		});
		this.resizeObserver.observe(this.container);
	}

	public getGradeProfile(): { s: number; z: number }[] {
		return [...this.gradeIPs].sort((a, b) => a.s - b.s);
	}
}


