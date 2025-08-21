import * as THREE from 'three';
import { HeightFunction } from './surface';

export interface ProfileData {
	chainages: number[];
	elevations: number[]; // existing ground along alignment
	minZ: number;
	maxZ: number;
	length: number;
	gradeStartZ: number; // design grade IP at start, matched to surface
	gradeEndZ: number;   // design grade IP at end, matched to surface
}

export class ProfileOverlay {
	private readonly container: HTMLDivElement;
	private readonly canvas: HTMLCanvasElement;
	private readonly ctx: CanvasRenderingContext2D;
	public active = false;
	private isDragging = false;
	private dragOffsetX = 0;
	private dragOffsetY = 0;
	private resizeObserver?: ResizeObserver;
	private lastProfile?: ProfileData;
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
		this.setupResizeObserver();
	}

	public setActive(on: boolean) {
		this.active = on;
		this.container.classList.toggle('hidden', !on);
		if (on && this.lastProfile) {
			this.draw(this.lastProfile, this.lastTitle, this.lastMarkerChainage);
		}
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

		const minX = 0;
		const maxX = Math.max(1, profile.length);
		const minY = profile.minZ;
		const maxY = profile.maxZ;
		const xToPx = (x: number) => padL + ((x - minX) / (maxX - minX)) * plotW;
		const yToPx = (y: number) => padT + (1 - (y - minY) / (maxY - minY)) * plotH;

		// Grid
		ctx.strokeStyle = '#2b2f3a';
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
		ctx.strokeStyle = '#aab0c0';
		ctx.lineWidth = 1.2;
		ctx.beginPath();
		ctx.rect(padL, padT, plotW, plotH);
		ctx.stroke();

		// Labels
		ctx.fillStyle = '#aab0c0';
		ctx.font = '11px ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Ubuntu, Cantarell, Noto Sans';
		ctx.fillText(`${title ?? ''}`, padL + 6, padT + 14);
		ctx.fillText(`z [m]`, 6, padT + 12);
		ctx.fillText(`s [m]`, w - 42, h - 6);

		// Existing ground profile polyline
		ctx.strokeStyle = '#ffd166';
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
			ctx.strokeStyle = '#56ccf2';
			ctx.lineWidth = 1.6;
			ctx.setLineDash([4, 3]);
			ctx.beginPath();
			ctx.moveTo(xm, padT);
			ctx.lineTo(xm, padT + plotH);
			ctx.stroke();
			ctx.setLineDash([]);
		}

		// Two-IP grade line from surface elevations at start and end
		const x0 = xToPx(0);
		const y0 = yToPx(profile.gradeStartZ);
		const x1 = xToPx(profile.length);
		const y1 = yToPx(profile.gradeEndZ);
		ctx.strokeStyle = '#9aa3ad';
		ctx.lineWidth = 1.8;
		ctx.setLineDash([6, 6]);
		ctx.beginPath();
		ctx.moveTo(x0, y0);
		ctx.lineTo(x1, y1);
		ctx.stroke();
		ctx.setLineDash([]);

		// IP markers
		ctx.fillStyle = '#ff6b35';
		ctx.beginPath();
		ctx.arc(x0, y0, 3, 0, Math.PI * 2);
		ctx.arc(x1, y1, 3, 0, Math.PI * 2);
		ctx.fill();
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
}


