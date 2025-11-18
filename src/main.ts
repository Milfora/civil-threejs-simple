import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { createSurfaceMesh, heightAt } from './surface';
import { Alignment } from './alignment';
import { theme3D } from './theme';
import { CrossSectionOverlay } from './crossSection';
import { SectionMarker } from './sectionMarker';
import { createRoadwayMesh, createRoadEdges, RoadTemplate, createRoadwayMeshFromTwoIPs, createRoadEdgesFromTwoIPs, createDaylightMeshFromTwoIPs, createCorridorFromTwoIPs, createParabolicEvaluator } from './roadway';
import { ProfileOverlay } from './profile';
import { DrapedPolyline } from './polyline';
import { getTemplates, type Template2D, sweepTemplateGroupAlong, computeSweepVolume, computeMaterialVolumes, computeTemplateArea } from './template2D';

// Z-up world for all objects
THREE.Object3D.DEFAULT_UP.set(0, 0, 1);

const app = document.getElementById('app') as HTMLDivElement;
if (!app) throw new Error('App container not found');

const scene = new THREE.Scene();
scene.background = new THREE.Color(theme3D.background);

// Camera
const camera = new THREE.PerspectiveCamera(55, window.innerWidth / window.innerHeight, 0.1, 2000);
camera.position.set(-30, -40, 28);
camera.up.set(0, 0, 1);
camera.lookAt(0, 0, 0);

// Renderer
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.domElement.classList.add('canvas3d');
app.appendChild(renderer.domElement);

// Controls
const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = false; // snappier feel
controls.rotateSpeed = 1.1;
controls.zoomSpeed = 1.1;
controls.panSpeed = 1.0;
controls.enablePan = true;
controls.screenSpacePanning = true;
controls.target.set(0, 0, 0);

// Lights
const hemi = new THREE.HemisphereLight(0xffffff, 0xcfd8dc, 0.65);
scene.add(hemi);
const dir = new THREE.DirectionalLight(0xffffff, 0.55);
dir.position.set(-60, -40, 120);
scene.add(dir);

// Grid on XY plane (rotate default XZ grid to XY)
// Engineering-like muted grey grid on ground (XY plane)
const grid = new THREE.GridHelper(400, 80, theme3D.gridMajor, theme3D.gridMinor);
grid.rotation.x = Math.PI / 2;
grid.position.set(0, 0, -0.001);
grid.renderOrder = 0;
scene.add(grid);

// Surface
const surface = createSurfaceMesh(200, 200, heightAt);
surface.renderOrder = 1;
scene.add(surface);

// Alignment
const alignment = new Alignment();
scene.add(alignment.object3d);

// IP handles (draggable)
const ipHandleGroup = new THREE.Group();
ipHandleGroup.renderOrder = 4;
scene.add(ipHandleGroup);
let ipHandleMeshes: THREE.Mesh[] = [];
const ipHandleRadius = 0.3;
const ipHandleGeom = new THREE.SphereGeometry(ipHandleRadius, 16, 12);
const ipMatEnd = new THREE.MeshBasicMaterial({ color: theme3D.ipEnd });
const ipMatInterior = new THREE.MeshBasicMaterial({ color: theme3D.ipInterior });

function refreshIPHandles() {
	const ips = alignment.getIPs();
	// Recreate meshes if count mismatches
	if (ipHandleMeshes.length !== ips.length) {
		for (const m of ipHandleMeshes) {
			ipHandleGroup.remove(m);
			m.geometry.dispose();
			(m.material as THREE.Material).dispose();
		}
		ipHandleMeshes = [];
		for (let i = 0; i < ips.length; i++) {
			const isEnd = i === 0 || i === ips.length - 1;
			const mat = (isEnd ? ipMatEnd : ipMatInterior).clone();
			const mesh = new THREE.Mesh(ipHandleGeom.clone(), mat);
			(mesh as any).userData = { index: i, origColor: (mat.color.getHex()) };
			mesh.renderOrder = 5;
			ipHandleGroup.add(mesh);
			ipHandleMeshes.push(mesh);
		}
	}
	for (let i = 0; i < ips.length; i++) {
		const p = ips[i];
		const mesh = ipHandleMeshes[i];
		if (!mesh) continue;
		mesh.position.set(p.x, p.y, 0);
		const isEnd = i === 0 || i === ips.length - 1;
		const mat = mesh.material as THREE.MeshBasicMaterial;
		mat.color.set(isEnd ? 0xf2994a : 0x56ccf2);
	}
}

// Roadway visualization
let roadTemplate: RoadTemplate = {
	laneWidth: 0.5,
	crossfallLane: -0.03,
	pavementThickness: 0.3,
	kerbWidth: 0.25,
	kerbHeight: 0.12,
	footpathWidth: 0.5,
	footpathThickness: 0.05,
	crossfallFootpath: -0.02
};
let daylightHtoV = 2; // 2H:1V by default
const initialRoadTemplate: RoadTemplate = { ...roadTemplate };
const initialDaylightHtoV = daylightHtoV;
// Use two-IP vertical profile (start/end from existing ground) for roadway modeling
let designStartZOverride: number | undefined = undefined;
let designEndZOverride: number | undefined = undefined;
let corridorGroup = createCorridorFromTwoIPs(alignment.getPoints(), heightAt, roadTemplate, designStartZOverride, designEndZOverride, []);
scene.add(corridorGroup);
let daylightMesh = createDaylightMeshFromTwoIPs(alignment.getPoints(), heightAt, roadTemplate, daylightHtoV, designStartZOverride, designEndZOverride, []);
scene.add(daylightMesh);
refreshIPHandles();

// Floating popup for editing alignment fillet radius (per-corner)
let radiusPopupEl: HTMLDivElement | null = null;
let radiusPopupTargetCorner: number | null = null;
function closeRadiusPopup() {
    if (!radiusPopupEl) return;
    document.body.removeChild(radiusPopupEl);
    radiusPopupEl = null;
    controls.enabled = true;
    radiusPopupTargetCorner = null;
}
function openRadiusPopup(clientX: number, clientY: number, initialRadius: number, cornerIndex: number | null) {
    closeRadiusPopup();
    controls.enabled = false;
    radiusPopupTargetCorner = cornerIndex;
    const div = document.createElement('div');
    div.style.position = 'fixed';
    div.style.left = `${clientX}px`;
    div.style.top = `${clientY}px`;
    div.style.transform = 'translate(8px, 8px)';
    div.style.background = '#ffffff';
    div.style.color = '#3d4451';
    div.style.border = '1px solid #d9dee5';
    div.style.borderRadius = '4px';
    div.style.padding = '6px 8px';
    div.style.boxShadow = '0 4px 12px rgba(0,0,0,0.35)';
    div.style.zIndex = '10000';
    div.style.fontFamily = 'ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Arial';
    div.style.fontSize = '12px';

    const label = document.createElement('div');
    label.textContent = 'Curve radius';
    label.style.marginBottom = '4px';
    label.style.opacity = '0.9';
    div.appendChild(label);

    const input = document.createElement('input');
    input.type = 'number';
    input.step = '0.1';
    input.min = '0';
    input.value = String(initialRadius);
    input.style.width = '120px';
    input.style.padding = '4px 6px';
    input.style.background = '#f7f9fb';
    input.style.color = '#2f3542';
    input.style.border = '1px solid #cfd6df';
    input.style.borderRadius = '3px';
    input.style.outline = 'none';
    input.addEventListener('keydown', (e: KeyboardEvent) => {
        if (e.key === 'Escape') {
            e.preventDefault();
            closeRadiusPopup();
        } else if (e.key === 'Enter') {
            e.preventDefault();
            const v = Number.parseFloat(input.value);
            if (Number.isFinite(v) && v > 0) {
                if (radiusPopupTargetCorner !== null) {
                    alignment.setCornerRadius(radiusPopupTargetCorner, v);
                } else {
                    alignment.setDefaultRadius(v);
                }
                rebuildCorridor();
                // refresh profile overlay if visible
                if (profileOverlay.active) {
                    const profile = profileOverlay.computeProfile(alignment.getPoints(), heightAt);
                    profileOverlay.draw(profile, `s ∈ [0, ${profile.length.toFixed(1)}] m`);
                }
                updateVolumesHUD();
            }
            closeRadiusPopup();
        }
    });
    div.appendChild(input);

    const hint = document.createElement('div');
    hint.textContent = 'Enter to confirm, Esc to cancel';
    hint.style.marginTop = '4px';
    hint.style.opacity = '0.6';
    div.appendChild(hint);

    document.body.appendChild(div);
    radiusPopupEl = div;
    setTimeout(() => input.focus({ preventScroll: true }), 0);
}

// Load road template JSON (editable) and rebuild
async function loadRoadTemplateFromJSON(url: string) {
	try {
		const res = await fetch(url, { cache: 'no-cache' });
		if (!res.ok) throw new Error(`Failed to fetch template: ${res.status}`);
		const json = await res.json();
		// Map JSON to internal template type; allow both flat and componentized
		const tpl: RoadTemplate = {
			laneWidth: Number(json.laneWidth) ?? roadTemplate.laneWidth,
			crossfallLane: Number(json.crossfallLane) ?? roadTemplate.crossfallLane,
			pavementThickness: json.components?.pavement?.thickness ?? json.pavementThickness ?? roadTemplate.pavementThickness,
			kerbWidth: json.components?.kerb?.width ?? json.kerbWidth ?? roadTemplate.kerbWidth,
			kerbHeight: json.components?.kerb?.height ?? json.kerbHeight ?? roadTemplate.kerbHeight,
			footpathWidth: json.components?.footpath?.width ?? json.footpathWidth ?? roadTemplate.footpathWidth,
			footpathThickness: json.components?.footpath?.thickness ?? json.footpathThickness ?? roadTemplate.footpathThickness,
			crossfallFootpath: json.components?.footpath?.crossfall ?? json.crossfallFootpath ?? roadTemplate.crossfallFootpath,
			components: json.components
		};
		roadTemplate = tpl;
		const dl = json.components?.daylight?.slopeHtoV;
		if (typeof dl === 'number' && dl > 0) daylightHtoV = dl;
		rebuildCorridor();
		populateSettingsInputs();
	} catch (err) {
		console.warn('Template JSON load failed:', err);
	}
}

// Kick off load from public folder; user can edit and reload the page
loadRoadTemplateFromJSON('/templates/default-road-template.json');

function rebuildCorridor() {
	// Remove and dispose old objects
	scene.remove(corridorGroup);
	const disposeNode = (obj: THREE.Object3D) => {
		obj.traverse((child: any) => {
			if ((child as THREE.Mesh).geometry) {
				(child as THREE.Mesh).geometry.dispose();
			}
			if ((child as THREE.Mesh).material) {
				const mat = (child as THREE.Mesh).material as any;
				if (Array.isArray(mat)) mat.forEach((m: THREE.Material) => m.dispose());
				else (mat as THREE.Material).dispose();
			}
		});
	};
	disposeNode(corridorGroup);
	scene.remove(daylightMesh);
	daylightMesh.geometry.dispose();
	(daylightMesh.material as THREE.Material).dispose();
	// Recreate with current parameters
	corridorGroup = createCorridorFromTwoIPs(
		alignment.getPoints(),
		heightAt,
		roadTemplate,
		designStartZOverride,
		designEndZOverride,
		profileOverlay.getGradeProfile()
	);
	scene.add(corridorGroup);
	daylightMesh = createDaylightMeshFromTwoIPs(
		alignment.getPoints(),
		heightAt,
		roadTemplate,
		// Prefer daylight slope from template components if present
		(roadTemplate.components?.daylight?.slopeHtoV ?? daylightHtoV),
		designStartZOverride,
		designEndZOverride,
		profileOverlay.getGradeProfile()
	);
	scene.add(daylightMesh);
	updateVolumesHUD();
}

// Coordinate HUD (bottom-right)
const coordEl = document.getElementById('coord-overlay') as HTMLDivElement | null;
if (!coordEl) throw new Error('Coordinate overlay not found');
const volumeEl = document.getElementById('volume-overlay') as HTMLDivElement | null;
if (!volumeEl) throw new Error('Volume overlay not found');

// Cross-section overlay
const overlay = new CrossSectionOverlay();
const marker = new SectionMarker();
scene.add(marker.line);
const toggleBtn = document.getElementById('btn-cross-section') as HTMLButtonElement;
toggleBtn.addEventListener('click', () => {
	overlay.setActive(!overlay.active);
	marker.setVisible(false);
});

// Profile overlay
const profileOverlay = new ProfileOverlay();
// When user drags start/end handles in profile, override two-IP grade and rebuild
profileOverlay.onGradeChange = ({ startZ, endZ }) => {
    if (startZ !== undefined) designStartZOverride = startZ;
    if (endZ !== undefined) designEndZOverride = endZ;
    rebuildCorridor();
    // refresh profile overlay with current overrides
    if (profileOverlay.active) {
        const profile = profileOverlay.computeProfile(alignment.getPoints(), heightAt);
        profileOverlay.setDesignOverrides(designStartZOverride, designEndZOverride);
        profileOverlay.draw(profile, `s ∈ [0, ${profile.length.toFixed(1)}] m`);
    }
};
const btnProfile = document.getElementById('btn-profile') as HTMLButtonElement;
btnProfile.addEventListener('click', () => {
	profileOverlay.setActive(!profileOverlay.active);
	if (profileOverlay.active) {
		const profile = profileOverlay.computeProfile(alignment.getPoints(), heightAt);
		profileOverlay.draw(profile, `s ∈ [0, ${profile.length.toFixed(1)}] m`);
	}
});

// Tool modes
type ToolMode = 'select' | 'createAlignment' | 'createPolyline' | 'sweepTemplate' | 'editPolyline';
let toolMode: ToolMode = 'select';

// Alignment creation command (click to add IPs; right-click/Enter to finish; Escape to cancel)
const btnAlign = document.getElementById('btn-align') as HTMLButtonElement | null;
const btnPolyline = document.getElementById('btn-polyline') as HTMLButtonElement | null;
let createdIPs: THREE.Vector2[] = [];
let previewLine: THREE.Line | null = null;
let savedAlignmentPoints: THREE.Vector2[] | null = null;
let savedAlignmentIPs: THREE.Vector2[] | null = null;
const defaultFilletRadius = 10; // world units

// --- Alignment JSON export helpers ---
function alignmentToPlainObject(al: Alignment) {
	const ips = al.getIPs().map(p => ({ x: p.x, y: p.y }));
	const pts = al.getPoints().map(p => ({ x: p.x, y: p.y }));
	const radii: (number | null)[] = ips.map((_p, i) => {
		const r = al.getCornerRadius(i);
		return (typeof r === 'number') ? r : null;
	});
	return {
		meta: {
			version: 1,
			createdAt: new Date().toISOString()
		},
		defaultFilletRadius: al.getDefaultRadius(),
		ips,
		points: pts,
		cornerRadii: radii
	};
}

async function saveAlignmentJSON(al: Alignment) {
	const payload = alignmentToPlainObject(al);
	const ts = new Date().toISOString().replace(/[:.]/g, '-');
	const filename = `alignment-${ts}.json`;
	try {
		const res = await fetch('/api/save-alignment', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ filename, alignment: payload })
		});
		if (!res.ok) throw new Error(`HTTP ${res.status}`);
		console.log('Alignment saved to \\data:', await res.json());
	} catch (_err) {
		// Fallback: trigger client-side download
		const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
		const url = URL.createObjectURL(blob);
		const a = document.createElement('a');
		a.href = url;
		a.download = filename;
		document.body.appendChild(a);
		a.click();
		document.body.removeChild(a);
		URL.revokeObjectURL(url);
		console.warn('Dev save API unavailable, downloaded alignment JSON locally.');
	}
}

function setAlignmentCreateMode(on: boolean) {
	toolMode = on ? 'createAlignment' : 'select';
	controls.enabled = !on;
	ipHandleGroup.visible = !on;
	if (!on) {
		if (previewLine) {
			scene.remove(previewLine);
			previewLine.geometry.dispose();
			(previewLine.material as THREE.Material).dispose();
			previewLine = null;
		}
		createdIPs = [];
	}
}

function ensurePreviewLine() {
	if (previewLine) return;
	const mat = new THREE.LineBasicMaterial({ color: 0xF80404, linewidth: 5 });
	const geom = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3()]);
	previewLine = new THREE.Line(geom, mat);
	previewLine.renderOrder = 3;
	scene.add(previewLine);
}

function updatePreview(currentMouse?: THREE.Vector3) {
	if (!previewLine) return;
	const pts: THREE.Vector3[] = [];
	for (const p of createdIPs) pts.push(new THREE.Vector3(p.x, p.y, 0));
	if (currentMouse) pts.push(new THREE.Vector3(currentMouse.x, currentMouse.y, 0));
	if (pts.length < 2) {
		pts.push(pts[0] ?? new THREE.Vector3());
	}
	const geom = new THREE.BufferGeometry().setFromPoints(pts);
	previewLine.geometry.dispose();
	(previewLine as any).geometry = geom;
}

function finishAlignmentCreation(commit: boolean) {
	if (commit && createdIPs.length >= 2) {
		alignment.buildFromIPs(createdIPs, defaultFilletRadius, 1.0, 1.0);
		rebuildCorridor();
		refreshIPHandles();
		// Save alignment JSON to /data (dev) or download as fallback
		void saveAlignmentJSON(alignment);
		// refresh profile overlay if visible
		if (profileOverlay.active) {
			const profile = profileOverlay.computeProfile(alignment.getPoints(), heightAt);
			profileOverlay.draw(profile, `s ∈ [0, ${profile.length.toFixed(1)}] m`);
		}
	} else if (!commit) {
		// restore previous alignment
		if (savedAlignmentIPs) {
			alignment.setIPs(savedAlignmentIPs);
		} else if (savedAlignmentPoints) {
			alignment.setPolyline(savedAlignmentPoints);
		}
		rebuildCorridor();
		refreshIPHandles();
	}
	savedAlignmentPoints = null;
	savedAlignmentIPs = null;
	setAlignmentCreateMode(false);
}

btnAlign?.addEventListener('click', () => {
	if (toolMode === 'createAlignment') {
		finishAlignmentCreation(false);
		return;
	}
	// save current alignment and start new creation
	savedAlignmentPoints = alignment.getPoints().map(p => p.clone());
	savedAlignmentIPs = alignment.getIPs().map(p => p.clone());
	createdIPs = [];
	ensurePreviewLine();
	updatePreview();
	setAlignmentCreateMode(true);
});

// ----- Draped Polyline Creation -----
const drapedPolylines: DrapedPolyline[] = [];
let polyCreatePoints: THREE.Vector2[] = [];
let polyPreview: THREE.Line | null = null;
type QuickCorridor = {
	mesh: THREE.Group;
	path3D: THREE.Vector3[];
	template: Template2D;
	sourcePolyline: DrapedPolyline | null;
};
const quickCorridors: QuickCorridor[] = [];
let selectedCorridor: QuickCorridor | null = null;
let selectedPolyline: DrapedPolyline | null = null;
const polylineHandleGroup = new THREE.Group();
polylineHandleGroup.renderOrder = 5;
scene.add(polylineHandleGroup);
let polylineHandleMeshes: THREE.Mesh[] = [];
const polyHandleGeom = new THREE.SphereGeometry(0.35, 14, 10);
const polyHandleMat = new THREE.MeshBasicMaterial({ color: 0xffd166 });
let draggingPolyHandleIndex: number | null = null;
let hoveredPolyHandle: THREE.Mesh | null = null;

function ensurePolylinePreview() {
	if (polyPreview) return;
	const mat = new THREE.LineBasicMaterial({ color: 0x2EE6B5, linewidth: 3 });
	const geom = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3()]);
	polyPreview = new THREE.Line(geom, mat);
	polyPreview.renderOrder = 4;
	scene.add(polyPreview);
}
function updatePolylinePreview(currentMouse?: THREE.Vector3) {
	if (!polyPreview) return;
	const pts: THREE.Vector3[] = [];
	for (const p of polyCreatePoints) pts.push(new THREE.Vector3(p.x, p.y, 0));
	if (currentMouse) pts.push(new THREE.Vector3(currentMouse.x, currentMouse.y, 0));
	if (pts.length < 2) {
		pts.push(pts[0] ?? new THREE.Vector3());
	}
	const geom = new THREE.BufferGeometry().setFromPoints(pts);
	polyPreview.geometry.dispose();
	(polyPreview as any).geometry = geom;
}
function setPolylineCreateMode(on: boolean) {
	toolMode = on ? 'createPolyline' : 'select';
	controls.enabled = !on;
	ipHandleGroup.visible = !on;
	polylineHandleGroup.visible = false;
	if (!on) {
		if (polyPreview) {
			scene.remove(polyPreview);
			polyPreview.geometry.dispose();
			(polyPreview.material as THREE.Material).dispose();
			polyPreview = null;
		}
		polyCreatePoints = [];
	}
}
function finishPolylineCreation(commit: boolean) {
	if (commit && polyCreatePoints.length >= 2) {
		const poly = new DrapedPolyline(heightAt, 1.0);
		for (const p of polyCreatePoints) poly.addPoint(p);
		poly.finalize();
		scene.add(poly.getLineObject());
		drapedPolylines.push(poly);
	}
	setPolylineCreateMode(false);
}

function refreshPolylineHandles() {
	// Clear and rebuild handles for selected polyline
	for (const m of polylineHandleMeshes) {
		polylineHandleGroup.remove(m);
		m.geometry.dispose();
		(m.material as THREE.Material).dispose();
	}
	polylineHandleMeshes = [];
	if (!selectedPolyline) { polylineHandleGroup.visible = false; return; }
	const count = selectedPolyline.getControlPointCount();
	const pts = selectedPolyline.getControlPoints();
	for (let i = 0; i < count; i++) {
		const p = pts[i];
		const z = heightAt(p.x, p.y);
		const mesh = new THREE.Mesh(polyHandleGeom.clone(), polyHandleMat.clone());
		(mesh as any).userData = { index: i };
		mesh.position.set(p.x, p.y, z);
		mesh.renderOrder = 6;
		polylineHandleGroup.add(mesh);
		polylineHandleMeshes.push(mesh);
	}
	polylineHandleGroup.visible = true;
}
function enterPolylineEditMode(poly: DrapedPolyline) {
	selectedPolyline = poly;
	toolMode = 'editPolyline';
	controls.enabled = true; // allow orbit when not dragging
	ipHandleGroup.visible = false;
	refreshPolylineHandles();
}
function exitPolylineEditMode() {
	selectedPolyline = null;
	toolMode = 'select';
	controls.enabled = true;
	draggingPolyHandleIndex = null;
	hoveredPolyHandle = null;
	for (const m of polylineHandleMeshes) {
		polylineHandleGroup.remove(m);
		m.geometry.dispose();
		(m.material as THREE.Material).dispose();
	}
	polylineHandleMeshes = [];
	polylineHandleGroup.visible = false;
}

function rebuildCorridorsForPolyline(poly: DrapedPolyline) {
	for (const c of quickCorridors) {
		if (c.sourcePolyline !== poly) continue;
		const newPath = poly.getSampledPoints3D();
		// Replace group
		scene.remove(c.mesh);
		disposeNode(c.mesh);
		const newGroup = sweepTemplateGroupAlong(newPath, c.template);
		scene.add(newGroup);
		c.mesh = newGroup;
		c.path3D = newPath;
		// If selected, keep selection and update overlay
		if (selectedCorridor === c) {
			setCorridorHighlight(c, true);
			updateCorridorInfoOverlay();
		}
	}
}

btnPolyline?.addEventListener('click', () => {
	if (toolMode === 'createPolyline') {
		finishPolylineCreation(false);
		return;
	}
	polyCreatePoints = [];
	ensurePolylinePreview();
	updatePolylinePreview();
	setPolylineCreateMode(true);
});

// Settings overlay
const settingsOverlay = document.getElementById('settings-overlay') as HTMLDivElement;
const btnSettings = document.getElementById('btn-settings') as HTMLButtonElement;
const form = document.getElementById('settings-form') as HTMLFormElement;
const inLane = document.getElementById('laneWidth') as HTMLInputElement;
const inCrossfallLane = document.getElementById('crossfallLane') as HTMLInputElement;
const inDaylight = document.getElementById('daylightHtoV') as HTMLInputElement;
const btnApply = document.getElementById('btn-settings-apply') as HTMLButtonElement;
const btnReset = document.getElementById('btn-settings-reset') as HTMLButtonElement;
const closeSettings = settingsOverlay.querySelector('.overlay-close') as HTMLButtonElement | null;

function populateSettingsInputs() {
	inLane.value = String(roadTemplate.laneWidth);
	inCrossfallLane.value = String(roadTemplate.crossfallLane);
	inDaylight.value = String(roadTemplate.components?.daylight?.slopeHtoV ?? daylightHtoV);
}

btnSettings.addEventListener('click', () => {
	populateSettingsInputs();
	settingsOverlay.classList.remove('hidden');
});
closeSettings?.addEventListener('mousedown', (e: MouseEvent) => { e.stopPropagation(); e.preventDefault(); });
closeSettings?.addEventListener('click', (e: MouseEvent) => {
	e.stopPropagation();
	settingsOverlay.classList.add('hidden');
});

btnApply.addEventListener('click', () => {
	const lane = Number.parseFloat(inLane.value);
	const cLane = Number.parseFloat(inCrossfallLane.value);
	const dHtoV = Number.parseFloat(inDaylight.value);
	if (Number.isFinite(lane) && lane >= 0) roadTemplate.laneWidth = lane;
	if (Number.isFinite(cLane)) roadTemplate.crossfallLane = cLane;
	if (Number.isFinite(dHtoV) && dHtoV > 0) {
		daylightHtoV = dHtoV;
		if (!roadTemplate.components) roadTemplate.components = {};
		if (!roadTemplate.components.daylight) roadTemplate.components.daylight = {};
		roadTemplate.components.daylight.slopeHtoV = dHtoV;
	}
	rebuildCorridor();
});

btnReset.addEventListener('click', () => {
	roadTemplate = { ...initialRoadTemplate };
	daylightHtoV = initialDaylightHtoV;
	populateSettingsInputs();
	rebuildCorridor();
});

// Template library overlay
const templateOverlay = document.getElementById('template-overlay') as HTMLDivElement;
const templateClose = templateOverlay.querySelector('.overlay-close') as HTMLButtonElement | null;
const templateListEl = document.getElementById('template-list') as HTMLDivElement;
const btnTemplateConfirm = document.getElementById('btn-template-confirm') as HTMLButtonElement;
const btnTemplateCancel = document.getElementById('btn-template-cancel') as HTMLButtonElement;
const btnTemplateEdit = document.getElementById('btn-template-edit') as HTMLButtonElement | null;
const trenchVolumeEl = document.getElementById('trench-volume-overlay') as HTMLDivElement | null;
const corridorInfoOverlay = document.getElementById('corridor-info-overlay') as HTMLDivElement | null;
const corridorInfoClose = corridorInfoOverlay?.querySelector('.overlay-close') as HTMLButtonElement | null;
const corridorInfoName = document.getElementById('corridor-info-name') as HTMLDivElement | null;
const corridorInfoTotal = document.getElementById('corridor-info-total') as HTMLDivElement | null;
const corridorInfoMaterials = document.getElementById('corridor-info-materials') as HTMLDivElement | null;
// Totals overlay refs
const btnCalcAll = document.getElementById('btn-calc-all') as HTMLButtonElement | null;
const totalsOverlay = document.getElementById('totals-overlay') as HTMLDivElement | null;
const totalsClose = totalsOverlay?.querySelector('.overlay-close') as HTMLButtonElement | null;
const totalsInfo = document.getElementById('totals-info') as HTMLDivElement | null;
const totalsMaterials = document.getElementById('totals-materials') as HTMLDivElement | null;
const btnExportTotalsCsv = document.getElementById('btn-export-totals-csv') as HTMLButtonElement | null;
// Template editor refs
const tplEditor = document.getElementById('template-editor-overlay') as HTMLDivElement | null;
const tplEditorClose = tplEditor?.querySelector('.overlay-close') as HTMLButtonElement | null;
const inTplName = document.getElementById('tpl-name') as HTMLInputElement | null;
const inTplMaterialsJson = document.getElementById('tpl-materials-json') as HTMLTextAreaElement | null;
const btnTplSave = document.getElementById('btn-tpl-save') as HTMLButtonElement | null;
const btnTplCancel = document.getElementById('btn-tpl-cancel') as HTMLButtonElement | null;
const templates: Template2D[] = getTemplates();
let selectedTemplateIndex: number | null = null;

function renderTemplateList() {
	templateListEl.innerHTML = '';
	templates.forEach((tpl, idx) => {
		const div = document.createElement('div');
		div.className = 'template-item' + (selectedTemplateIndex === idx ? ' selected' : '');
		const thumb = document.createElement('div');
		thumb.className = 'thumb';
		thumb.textContent = tpl.name.startsWith('Square') ? '□' : '▭';
		const label = document.createElement('div');
		label.textContent = tpl.name;
		label.style.fontSize = '12px';
		div.appendChild(thumb);
		div.appendChild(label);
		div.addEventListener('click', () => {
			selectedTemplateIndex = idx;
			renderTemplateList();
		});
		templateListEl.appendChild(div);
	});
}

document.getElementById('btn-template')?.addEventListener('click', () => {
	selectedTemplateIndex = selectedTemplateIndex ?? 0;
	renderTemplateList();
	templateOverlay.classList.remove('hidden');
});
templateClose?.addEventListener('mousedown', (e: MouseEvent) => { e.preventDefault(); e.stopPropagation(); });
templateClose?.addEventListener('click', (e: MouseEvent) => {
	e.stopPropagation();
	templateOverlay.classList.add('hidden');
	// Exit change mode if we were in it
	templateChangeTarget = null;
});
btnTemplateCancel.addEventListener('click', () => {
	templateOverlay.classList.add('hidden');
	templateChangeTarget = null;
});
btnTemplateConfirm.addEventListener('click', () => {
	if (selectedTemplateIndex === null) return;
	// If confirming a change for an existing corridor, rebuild it
	if (templateChangeTarget) {
		const tpl = templates[selectedTemplateIndex];
		templateOverlay.classList.add('hidden');
		// Replace mesh
		scene.remove(templateChangeTarget.mesh);
		disposeNode(templateChangeTarget.mesh);
		const newGroup = sweepTemplateGroupAlong(templateChangeTarget.path3D, tpl);
		scene.add(newGroup);
		templateChangeTarget.mesh = newGroup;
		templateChangeTarget.template = tpl;
		// Maintain selection/highlight and info overlay
		if (selectedCorridor === templateChangeTarget) {
			setCorridorHighlight(templateChangeTarget, true);
			updateCorridorInfoOverlay();
		}
		templateChangeTarget = null;
		return;
	}
	// Otherwise enter sweep mode to create a new corridor with the chosen template
	templateOverlay.classList.add('hidden');
	toolMode = 'sweepTemplate';
	controls.enabled = false;
});
function setCorridorHighlight(c: QuickCorridor | null, on: boolean) {
	if (!c) return;
	c.mesh.traverse((obj: any) => {
		if (!obj.isMesh) return;
		const mat = obj.material as THREE.MeshStandardMaterial;
		if (!mat) return;
		mat.emissive = new THREE.Color(on ? 0x00ffff : 0x000000);
		mat.emissiveIntensity = on ? 0.2 : 0.0;
	});
}
function selectCorridor(c: QuickCorridor | null) {
	if (selectedCorridor && selectedCorridor !== c) setCorridorHighlight(selectedCorridor, false);
	selectedCorridor = c;
	if (selectedCorridor) setCorridorHighlight(selectedCorridor, true);
	updateCorridorInfoOverlay();
}
function updateCorridorInfoOverlay() {
	if (!corridorInfoOverlay || !corridorInfoName || !corridorInfoTotal || !corridorInfoMaterials) return;
	if (!selectedCorridor) {
		corridorInfoOverlay.classList.add('hidden');
		return;
	}
	const tpl = selectedCorridor.template;
	const totalVol = computeSweepVolume(tpl, selectedCorridor.path3D);
	corridorInfoName.textContent = tpl.name;
	corridorInfoTotal.textContent = `Total volume: ${totalVol.toFixed(1)} m³  (A=${computeTemplateArea(tpl).toFixed(3)} m², L=${selectedCorridor.path3D.length} pts)`;
	const matVolumes = computeMaterialVolumes(tpl, selectedCorridor.path3D);
	corridorInfoMaterials.innerHTML = '';
	for (const m of matVolumes) {
		const row = document.createElement('div');
		row.className = 'mat-row';
		const chip = document.createElement('div');
		chip.className = 'mat-chip';
		chip.style.background = `#${m.color.toString(16).padStart(6, '0')}`;
		const label = document.createElement('div');
		label.textContent = `${m.materialName}: ${m.volume.toFixed(1)} m³`;
		row.appendChild(chip);
		row.appendChild(label);
		corridorInfoMaterials.appendChild(row);
	}
	corridorInfoOverlay.classList.remove('hidden');
}
corridorInfoClose?.addEventListener('mousedown', (e: MouseEvent) => { e.preventDefault(); e.stopPropagation(); });
corridorInfoClose?.addEventListener('click', (e: MouseEvent) => {
	e.stopPropagation();
	if (corridorInfoOverlay) corridorInfoOverlay.classList.add('hidden');
});
btnTemplateEdit?.addEventListener('click', () => {
	if (selectedTemplateIndex === null) return;
	openTemplateEditor(selectedTemplateIndex);
});

// ----- All Corridors Aggregate Totals -----
type MaterialTotal = { materialName: string; color: number; volume: number };
function computeAggregateTotals(): { totalVolume: number; materials: MaterialTotal[] } {
	let totalVolume = 0;
	const matMap = new Map<string, MaterialTotal>();
	for (const c of quickCorridors) {
		const tpl = c.template;
		const path = c.path3D;
		totalVolume += computeSweepVolume(tpl, path);
		const mats = computeMaterialVolumes(tpl, path);
		for (const m of mats) {
			const key = `${m.materialName}|${m.color}`;
			const prev = matMap.get(key);
			if (prev) {
				prev.volume += m.volume;
			} else {
				matMap.set(key, { materialName: m.materialName, color: m.color, volume: m.volume });
			}
		}
	}
	return { totalVolume, materials: Array.from(matMap.values()) };
}
function showTotalsOverlay() {
	if (!totalsOverlay || !totalsInfo || !totalsMaterials) return;
	const { totalVolume, materials } = computeAggregateTotals();
	totalsInfo.textContent = (quickCorridors.length === 0)
		? 'No corridors to total.'
		: `Corridors: ${quickCorridors.length}   Total volume: ${totalVolume.toFixed(1)} m³`;
	totalsMaterials.innerHTML = '';
	for (const m of materials) {
		const row = document.createElement('div');
		row.style.display = 'flex';
		row.style.alignItems = 'center';
		row.style.gap = '6px';
		const chip = document.createElement('span');
		chip.style.display = 'inline-block';
		chip.style.width = '12px';
		chip.style.height = '12px';
		chip.style.borderRadius = '2px';
		chip.style.background = `#${(m.color >>> 0).toString(16).padStart(6, '0')}`;
		const label = document.createElement('span');
		label.textContent = `${m.materialName}: ${m.volume.toFixed(1)} m³`;
		row.appendChild(chip);
		row.appendChild(label);
		totalsMaterials.appendChild(row);
	}
	totalsOverlay.classList.remove('hidden');
}
function exportTotalsCsv() {
	const { totalVolume, materials } = computeAggregateTotals();
	const lines: string[] = [];
	lines.push('Type,Name,Volume_m3');
	for (const m of materials) {
		const safeName = `"${m.materialName.replace(/"/g, '""')}"`;
		lines.push(`Material,${safeName},${m.volume.toFixed(3)}`);
	}
	lines.push(`Total,All,${totalVolume.toFixed(3)}`);
	const csv = lines.join('\n');
	const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
	const url = URL.createObjectURL(blob);
	const a = document.createElement('a');
	const ts = new Date().toISOString().replace(/[:.]/g, '-');
	a.href = url;
	a.download = `corridors-total-${ts}.csv`;
	document.body.appendChild(a);
	a.click();
	document.body.removeChild(a);
	URL.revokeObjectURL(url);
}
btnCalcAll?.addEventListener('click', () => { showTotalsOverlay(); });
totalsClose?.addEventListener('click', (e: MouseEvent) => {
	e.stopPropagation();
	if (totalsOverlay) totalsOverlay.classList.add('hidden');
});
btnExportTotalsCsv?.addEventListener('click', () => { exportTotalsCsv(); });

function openTemplateEditor(idx: number) {
	const tpl = templates[idx];
	if (!tplEditor || !inTplName || !inTplMaterialsJson) return;
	inTplName.value = tpl.name;
	const mats = (tpl.materials ?? []).map(m => ({
		name: m.name,
		color: `#${m.color.toString(16).padStart(6, '0')}`,
		polygon: m.polygon
	}));
	inTplMaterialsJson.value = JSON.stringify(mats, null, 2);
	tplEditor.classList.remove('hidden');
}
tplEditorClose?.addEventListener('mousedown', (e: MouseEvent) => { e.preventDefault(); e.stopPropagation(); });
tplEditorClose?.addEventListener('click', (e: MouseEvent) => {
	e.stopPropagation();
	tplEditor?.classList.add('hidden');
});
btnTplCancel?.addEventListener('click', () => {
	tplEditor?.classList.add('hidden');
});
btnTplSave?.addEventListener('click', () => {
	if (selectedTemplateIndex === null) return;
	if (!inTplName || !inTplMaterialsJson) return;
	const name = inTplName.value.trim() || templates[selectedTemplateIndex].name;
	let matsParsed: any;
	try {
		matsParsed = JSON.parse(inTplMaterialsJson.value);
		if (!Array.isArray(matsParsed)) throw new Error('Materials must be an array');
		for (const m of matsParsed) {
			if (typeof m.name !== 'string' || typeof m.color !== 'string' || !Array.isArray(m.polygon)) throw new Error('Invalid material entry');
			for (const v of m.polygon) {
				if (typeof v.x !== 'number' || typeof v.y !== 'number') throw new Error('Polygon vertices must be numeric');
			}
		}
	} catch (e) {
		alert('Invalid materials JSON: ' + (e as Error).message);
		return;
	}
	// Apply
	templates[selectedTemplateIndex].name = name;
	templates[selectedTemplateIndex].materials = matsParsed.map((m: any) => ({
		name: m.name,
		color: parseInt((m.color as string).replace('#', ''), 16),
		polygon: m.polygon
	}));
	// Refresh library list if open
	if (!templateOverlay.classList.contains('hidden')) renderTemplateList();
	tplEditor?.classList.add('hidden');
});

// Make Corridor Info overlay draggable by header
if (corridorInfoOverlay) {
	const header = corridorInfoOverlay.querySelector('.overlay-header') as HTMLDivElement | null;
	let draggingOverlay = false;
	let dragOffsetX = 0, dragOffsetY = 0;
	header?.addEventListener('mousedown', (e: MouseEvent) => {
		draggingOverlay = true;
		const rect = corridorInfoOverlay.getBoundingClientRect();
		dragOffsetX = e.clientX - rect.left;
		dragOffsetY = e.clientY - rect.top;
		e.preventDefault();
	});
	window.addEventListener('mousemove', (e: MouseEvent) => {
		if (!draggingOverlay) return;
		const x = Math.max(0, Math.min(window.innerWidth - 40, e.clientX - dragOffsetX));
		const y = Math.max(0, Math.min(window.innerHeight - 40, e.clientY - dragOffsetY));
		corridorInfoOverlay.style.left = `${x}px`;
		corridorInfoOverlay.style.top = `${y}px`;
	});
	window.addEventListener('mouseup', () => { draggingOverlay = false; });
}
// Make Totals overlay draggable by header
if (totalsOverlay) {
	const header = totalsOverlay.querySelector('.overlay-header') as HTMLDivElement | null;
	let draggingOverlay = false;
	let dragOffsetX = 0, dragOffsetY = 0;
	header?.addEventListener('mousedown', (e: MouseEvent) => {
		draggingOverlay = true;
		const rect = totalsOverlay.getBoundingClientRect();
		dragOffsetX = e.clientX - rect.left;
		dragOffsetY = e.clientY - rect.top;
		e.preventDefault();
	});
	window.addEventListener('mousemove', (e: MouseEvent) => {
		if (!draggingOverlay) return;
		const x = Math.max(0, Math.min(window.innerWidth - 40, e.clientX - dragOffsetX));
		const y = Math.max(0, Math.min(window.innerHeight - 40, e.clientY - dragOffsetY));
		totalsOverlay.style.left = `${x}px`;
		totalsOverlay.style.top = `${y}px`;
	});
	window.addEventListener('mouseup', () => { draggingOverlay = false; });
}
// Mouse → XY-plane world position
const raycaster = new THREE.Raycaster();
const mouse = new THREE.Vector2();
const planeXY = new THREE.Plane(new THREE.Vector3(0, 0, 1), 0); // z = 0
// Mouse drag tracking to distinguish clicks from orbit/pan drags
let isLeftDown = false;
let leftDownX = 0, leftDownY = 0;
let leftDragMoved = false;

// Dragging state for IPs
let draggingIPIndex: number | null = null;
let hoveredIPHandle: THREE.Mesh | null = null;

renderer.domElement.addEventListener('mousemove', (ev: MouseEvent) => {
	// Track left-drag distance to avoid treating orbit drags as clicks
	if (isLeftDown) {
		const dx = ev.clientX - leftDownX;
		const dy = ev.clientY - leftDownY;
		if (!leftDragMoved && (dx * dx + dy * dy) > 16) leftDragMoved = true; // 4px threshold
	}
	mouse.x = (ev.clientX / renderer.domElement.clientWidth) * 2 - 1;
	mouse.y = -(ev.clientY / renderer.domElement.clientHeight) * 2 + 1;
	raycaster.setFromCamera(mouse, camera);

	const hit = new THREE.Vector3();
	if (!raycaster.ray.intersectPlane(planeXY, hit)) return;

	// Update alignment preview in creation mode regardless of overlay state
	if (toolMode === 'createAlignment') {
		ensurePreviewLine();
		updatePreview(hit);
	}
	// Update polyline preview in creation mode
	if (toolMode === 'createPolyline') {
		ensurePolylinePreview();
		updatePolylinePreview(hit);
	}
	// Dragging polyline grips
	if (toolMode === 'editPolyline' && draggingPolyHandleIndex !== null && selectedPolyline) {
		const newXY = new THREE.Vector2(hit.x, hit.y);
		selectedPolyline.moveControlPoint(draggingPolyHandleIndex, newXY);
		refreshPolylineHandles();
		rebuildCorridorsForPolyline(selectedPolyline);
	} else if (toolMode === 'editPolyline') {
		// Hover highlight for grips when not dragging
		const hits = raycaster.intersectObjects(polylineHandleGroup.children, true);
		const top = hits[0]?.object as THREE.Mesh | undefined;
		if (top && top !== hoveredPolyHandle) {
			// Reset previous
			if (hoveredPolyHandle) {
				const matPrev = hoveredPolyHandle.material as THREE.MeshBasicMaterial;
				matPrev.color.set(0xffd166);
				hoveredPolyHandle.scale.set(1, 1, 1);
			}
			hoveredPolyHandle = top;
			const mat = hoveredPolyHandle.material as THREE.MeshBasicMaterial;
			mat.color.set(0x00e5ff);
			hoveredPolyHandle.scale.set(1.3, 1.3, 1.3);
		} else if (!top && hoveredPolyHandle) {
			// No hover now; reset previous
			const matPrev = hoveredPolyHandle.material as THREE.MeshBasicMaterial;
			matPrev.color.set(0xffd166);
			hoveredPolyHandle.scale.set(1, 1, 1);
			hoveredPolyHandle = null;
		}
	} else {
		// Hover highlight for alignment IP handles when not editing polyline and not dragging IP
		if (draggingIPIndex === null && ipHandleGroup.visible) {
			const hitsIP = raycaster.intersectObjects(ipHandleGroup.children, true);
			const topIP = hitsIP[0]?.object as THREE.Mesh | undefined;
			if (topIP && topIP !== hoveredIPHandle) {
				// Reset previous
				if (hoveredIPHandle) {
					const prevMat = hoveredIPHandle.material as THREE.MeshBasicMaterial;
					const orig = (hoveredIPHandle as any).userData?.origColor as number | undefined;
					if (typeof orig === 'number') prevMat.color.set(orig);
					hoveredIPHandle.scale.set(1, 1, 1);
				}
				hoveredIPHandle = topIP;
				const mat = hoveredIPHandle.material as THREE.MeshBasicMaterial;
				mat.color.set(0x00e5ff);
				hoveredIPHandle.scale.set(1.3, 1.3, 1.3);
			} else if (!topIP && hoveredIPHandle) {
				// No hover now; reset previous
				const prevMat = hoveredIPHandle.material as THREE.MeshBasicMaterial;
				const orig = (hoveredIPHandle as any).userData?.origColor as number | undefined;
				if (typeof orig === 'number') prevMat.color.set(orig);
				hoveredIPHandle.scale.set(1, 1, 1);
				hoveredIPHandle = null;
			}
		}
	}

	if (!overlay.active) { marker.setVisible(false); return; }

	// Closest on alignment (in XY)
	const closest = alignment.closestPointTo(hit.x, hit.y);

	// Only show when near alignment
	const nearThreshold = 2.8; // world units
	if (closest.distance > nearThreshold) { marker.setVisible(false); return; }

	// Perpendicular (to tangent) direction in XY
	const perp = new THREE.Vector2(-closest.tangent.y, closest.tangent.x).normalize();

	// Compute and draw section
	const halfWidth = 10;
	const samples = 240;

	// Compute center elevation at this chainage from current vertical profile (parabolic if available)
	const centerline = alignment.getPoints();
	let sAccum = 0;
	for (let i = 1; i < centerline.length; i++) {
		const segLen = centerline[i].distanceTo(centerline[i - 1]);
		if (closest.segmentIndex < i) break;
		sAccum += segLen;
	}
	const segA = centerline[closest.segmentIndex];
	const segB = centerline[closest.segmentIndex + 1] ?? segA;
	const segLen = segB.distanceTo(segA) || 1;
	const segT = THREE.MathUtils.clamp(segLen > 0 ? closest.point.distanceTo(segA) / segLen : 0, 0, 1);
	const sHere = sAccum + segLen * segT;
	const gradeIPsForEval = profileOverlay.getGradeProfile();
	let profileCenterZ: number;
	if (gradeIPsForEval.length >= 2) {
		profileCenterZ = createParabolicEvaluator(gradeIPsForEval).evalZ(sHere);
	} else {
		const totalLen = centerline.reduce((acc, p, idx) => idx === 0 ? 0 : acc + p.distanceTo(centerline[idx - 1]), 0);
		const zStart = heightAt(centerline[0].x, centerline[0].y);
		const zEnd = heightAt(centerline[centerline.length - 1].x, centerline[centerline.length - 1].y);
		const tGrade = totalLen > 0 ? sHere / totalLen : 0;
		profileCenterZ = THREE.MathUtils.lerp(zStart, zEnd, tGrade);
	}

	const section = overlay.computeSection(closest.point, perp, halfWidth, samples, heightAt, profileCenterZ, roadTemplate, daylightHtoV);
	overlay.draw(section, `s ≈ ${closest.chainage.toFixed(1)} m  (⊥ span ${2 * halfWidth} m)`, roadTemplate);

	// Update profile overlay marker if visible
	if (profileOverlay.active) {
		const profile = profileOverlay.computeProfile(centerline, heightAt);
		profileOverlay.draw(profile, `s ∈ [0, ${profile.length.toFixed(1)}] m`, sHere);
	}

	// Update visual bar marker at section location
	marker.update(closest.point, perp, halfWidth, heightAt);
	marker.setVisible(true);
});

// Start dragging an IP handle
renderer.domElement.addEventListener('mousedown', (ev: MouseEvent) => {
	if (toolMode === 'createAlignment') return;
	mouse.x = (ev.clientX / renderer.domElement.clientWidth) * 2 - 1;
	mouse.y = -(ev.clientY / renderer.domElement.clientHeight) * 2 + 1;
	raycaster.setFromCamera(mouse, camera);
	const hits = raycaster.intersectObjects(ipHandleGroup.children, true);
	if (hits.length > 0) {
		const obj = hits[0].object as THREE.Mesh;
		const idx = (obj as any).userData?.index as number | undefined;
		if (typeof idx === 'number') {
			draggingIPIndex = idx;
			controls.enabled = false;
			ev.preventDefault();
			ev.stopPropagation();
		}
	}
});

// Update drag
renderer.domElement.addEventListener('mousemove', (ev: MouseEvent) => {
	if (draggingIPIndex === null) return;
	mouse.x = (ev.clientX / renderer.domElement.clientWidth) * 2 - 1;
	mouse.y = -(ev.clientY / renderer.domElement.clientHeight) * 2 + 1;
	raycaster.setFromCamera(mouse, camera);
	const hit = new THREE.Vector3();
	if (!raycaster.ray.intersectPlane(planeXY, hit)) return;
	alignment.moveIP(draggingIPIndex, new THREE.Vector2(hit.x, hit.y));
	refreshIPHandles();
	rebuildCorridor();
	if (profileOverlay.active) {
		const profile = profileOverlay.computeProfile(alignment.getPoints(), heightAt);
		profileOverlay.draw(profile, `s ∈ [0, ${profile.length.toFixed(1)}] m`);
	}
});

function endDrag() {
	let changed = false;
	if (draggingIPIndex !== null) { draggingIPIndex = null; changed = true; }
	if (draggingPolyHandleIndex !== null) { draggingPolyHandleIndex = null; changed = true; }
	if (changed) controls.enabled = true;
}

renderer.domElement.addEventListener('mouseup', () => endDrag());
renderer.domElement.addEventListener('mouseleave', () => endDrag());

// Clicks for alignment creation
renderer.domElement.addEventListener('mousedown', (ev: MouseEvent) => {
	// Record left-down for click-vs-drag discrimination
	if (ev.button === 0) {
		isLeftDown = true;
		leftDownX = ev.clientX;
		leftDownY = ev.clientY;
		leftDragMoved = false;
	}
	// Start dragging a polyline handle in edit mode
	if (toolMode === 'editPolyline') {
		mouse.x = (ev.clientX / renderer.domElement.clientWidth) * 2 - 1;
		mouse.y = -(ev.clientY / renderer.domElement.clientHeight) * 2 + 1;
		raycaster.setFromCamera(mouse, camera);
		const hits = raycaster.intersectObjects(polylineHandleGroup.children, true);
		if (hits.length > 0) {
			const obj = hits[0].object as THREE.Mesh;
			const idx = (obj as any).userData?.index as number | undefined;
			if (typeof idx === 'number') {
				draggingPolyHandleIndex = idx;
				controls.enabled = false;
				ev.preventDefault();
				ev.stopPropagation();
				return;
			}
		}
	}
	// Sweep: select a draped polyline to sweep along
	if (toolMode === 'sweepTemplate') {
		mouse.x = (ev.clientX / renderer.domElement.clientWidth) * 2 - 1;
		mouse.y = -(ev.clientY / renderer.domElement.clientHeight) * 2 + 1;
		raycaster.setFromCamera(mouse, camera);
		const lineObjs = drapedPolylines.map(p => p.getLineObject());
		const hits = raycaster.intersectObjects(lineObjs, true);
		if (hits.length > 0) {
			const idx = lineObjs.indexOf(hits[0].object as THREE.Line);
			if (idx >= 0 && selectedTemplateIndex !== null) {
				const path = drapedPolylines[idx].getSampledPoints3D();
				const tpl = templates[selectedTemplateIndex];
				const mesh = sweepTemplateGroupAlong(path, tpl);
				scene.add(mesh);
				const qc: QuickCorridor = { mesh, path3D: path, template: tpl, sourcePolyline: drapedPolylines[idx] ?? null };
				quickCorridors.push(qc);
				selectCorridor(qc);
				// Done with selection
				toolMode = 'select';
				controls.enabled = true;
				ev.preventDefault();
				ev.stopPropagation();
				return;
			}
		}
		// If click didn't hit a polyline, do nothing (remain in sweep mode)
		return;
	}

	if (toolMode !== 'createAlignment') return;
	// Left click to add IP; right click to finish
	if (ev.button === 0) {
		mouse.x = (ev.clientX / renderer.domElement.clientWidth) * 2 - 1;
		mouse.y = -(ev.clientY / renderer.domElement.clientHeight) * 2 + 1;
		raycaster.setFromCamera(mouse, camera);
		const hit = new THREE.Vector3();
		if (raycaster.ray.intersectPlane(planeXY, hit)) {
			createdIPs.push(new THREE.Vector2(hit.x, hit.y));
			ensurePreviewLine();
			updatePreview(hit);
		}
		ev.preventDefault();
		ev.stopPropagation();
	} else if (ev.button === 2) {
		finishAlignmentCreation(true);
		ev.preventDefault();
		ev.stopPropagation();
	}
});

// Clicks for draped polyline creation
renderer.domElement.addEventListener('mousedown', (ev: MouseEvent) => {
	if (toolMode !== 'createPolyline') return;
	// Left click to add vertex; right click to finish
	if (ev.button === 0) {
		mouse.x = (ev.clientX / renderer.domElement.clientWidth) * 2 - 1;
		mouse.y = -(ev.clientY / renderer.domElement.clientHeight) * 2 + 1;
		raycaster.setFromCamera(mouse, camera);
		// Prefer surface intersection for precise XY under cursor
		const intersections = raycaster.intersectObject(surface, true);
		const p = intersections[0]?.point;
		const x = p ? p.x : ((): number => { const v = new THREE.Vector3(); raycaster.ray.intersectPlane(planeXY, v); return v.x; })();
		const y = p ? p.y : ((): number => { const v = new THREE.Vector3(); raycaster.ray.intersectPlane(planeXY, v); return v.y; })();
		polyCreatePoints.push(new THREE.Vector2(x, y));
		ensurePolylinePreview();
		updatePolylinePreview(p ? p : new THREE.Vector3(x, y, 0));
		ev.preventDefault();
		ev.stopPropagation();
	} else if (ev.button === 2) {
		finishPolylineCreation(true);
		ev.preventDefault();
		ev.stopPropagation();
	}
});

// Double-click also ends polyline creation
renderer.domElement.addEventListener('dblclick', (ev: MouseEvent) => {
	if (toolMode !== 'createPolyline') return;
	finishPolylineCreation(true);
	ev.preventDefault();
	ev.stopPropagation();
});

// Helper: map a raycast hit object back to its owning corridor group
function getCorridorFromHitObject(obj: THREE.Object3D): QuickCorridor | null {
	let node: THREE.Object3D | null = obj;
	while (node) {
		const match = quickCorridors.find(c => c.mesh === node);
		if (match) return match;
		node = node.parent as THREE.Object3D | null;
	}
	return null;
}

// Prevent context menu during creation
renderer.domElement.addEventListener('contextmenu', (ev: MouseEvent) => {
	// If right-clicked over a corridor mesh, show corridor context menu to delete
	mouse.x = (ev.clientX / renderer.domElement.clientWidth) * 2 - 1;
	mouse.y = -(ev.clientY / renderer.domElement.clientHeight) * 2 + 1;
	raycaster.setFromCamera(mouse, camera);
	const corrHits = raycaster.intersectObjects(quickCorridors.map(c => c.mesh), true);
	if (corrHits.length > 0) {
		const qc = getCorridorFromHitObject(corrHits[0].object);
		if (qc) {
			showCorridorCtxMenu(ev.clientX, ev.clientY, qc);
			ev.preventDefault();
			ev.stopPropagation();
			return;
		}
	}
	// If not creating, allow context menu only if not near alignment; otherwise we will show radius popup
	const hit = new THREE.Vector3();
	if (raycaster.ray.intersectPlane(planeXY, hit)) {
		const closest = alignment.closestPointTo(hit.x, hit.y);
		const nearThreshold = 2.0;
		if (closest.distance <= nearThreshold && toolMode !== 'createAlignment') {
			// Find nearest interior corner (IP index 1..n-2)
			const cornerIndex = alignment.getNearestCornerIndexTo(hit.x, hit.y);
			if (cornerIndex !== null) {
				const ips = alignment.getIPs();
				const cornerPos = ips[cornerIndex];
				const distToCorner = Math.hypot(cornerPos.x - hit.x, cornerPos.y - hit.y);
				const cornerThreshold = 2.0;
				if (distToCorner <= cornerThreshold) {
					// Open popup to edit only this corner's radius
					ev.preventDefault();
					ev.stopPropagation();
					const initial = alignment.getCornerRadius(cornerIndex) ?? alignment.getDefaultRadius();
					openRadiusPopup(ev.clientX, ev.clientY, initial, cornerIndex);
					return false as unknown as void;
				}
			}
		}
	}
	if (toolMode === 'createAlignment' || toolMode === 'createPolyline' || toolMode === 'editPolyline') {
		if (toolMode === 'editPolyline') exitPolylineEditMode();
		ev.preventDefault();
		return false as unknown as void;
	}
});

// Keyboard: Enter to finish, Escape to cancel
window.addEventListener('keydown', (ev: KeyboardEvent) => {
	if (radiusPopupEl) {
		if (ev.key === 'Escape') { ev.preventDefault(); closeRadiusPopup(); }
		return;
	}
	if (toolMode === 'createAlignment') {
		if (ev.key === 'Enter') {
			finishAlignmentCreation(true);
			ev.preventDefault();
		} else if (ev.key === 'Escape') {
			finishAlignmentCreation(false);
			ev.preventDefault();
		}
	} else if (toolMode === 'createPolyline') {
		if (ev.key === 'Enter') {
			finishPolylineCreation(true);
			ev.preventDefault();
		} else if (ev.key === 'Escape') {
			finishPolylineCreation(false);
			ev.preventDefault();
		}
	} else if (toolMode === 'sweepTemplate') {
		if (ev.key === 'Escape') {
			toolMode = 'select';
			controls.enabled = true;
			ev.preventDefault();
		}
	} else if (toolMode === 'editPolyline') {
		if (ev.key === 'Escape') {
			exitPolylineEditMode();
			ev.preventDefault();
		}
	} else if (toolMode === 'select') {
		// Deselect on Escape
		if (ev.key === 'Escape') {
			let handled = false;
			if (selectedCorridor) { selectCorridor(null); handled = true; }
			// If somehow a polyline edit was left active, ensure exit
			if (selectedPolyline) { exitPolylineEditMode(); handled = true; }
			if (handled) ev.preventDefault();
		}
	}
});

// Corridor/polyline selection on click; also deselect polyline when clicking away
renderer.domElement.addEventListener('mouseup', (ev: MouseEvent) => {
	if (!(toolMode === 'select' || toolMode === 'editPolyline')) return;
	// Only respond to left-click releases (avoid ending edit after panning with right/middle)
	if (ev.button !== 0) return;
// Suppress selection/deselection if it was an orbit drag
if (leftDragMoved) { isLeftDown = false; leftDragMoved = false; return; }
isLeftDown = false;
	mouse.x = (ev.clientX / renderer.domElement.clientWidth) * 2 - 1;
	mouse.y = -(ev.clientY / renderer.domElement.clientHeight) * 2 + 1;
	raycaster.setFromCamera(mouse, camera);
	// Prefer selecting a draped polyline for edit if one is under the cursor
	const lineObjs = drapedPolylines.map(p => p.getLineObject());
	const hitsLine = raycaster.intersectObjects(lineObjs, true);
	if (hitsLine.length > 0) {
		const obj = hitsLine[0].object as THREE.Line;
		const idx = lineObjs.indexOf(obj);
		if (idx >= 0) {
			enterPolylineEditMode(drapedPolylines[idx]);
			selectCorridor(null);
			ev.preventDefault();
			ev.stopPropagation();
			return;
		}
	}
	// Otherwise, try select a quick corridor mesh
	const hitsCorr = raycaster.intersectObjects(quickCorridors.map(c => c.mesh), true);
	if (hitsCorr.length > 0) {
		const qc = getCorridorFromHitObject(hitsCorr[0].object);
		if (qc) {
			selectCorridor(qc);
			// Exiting any polyline edit mode if active
			if (toolMode === 'editPolyline') exitPolylineEditMode();
			ev.preventDefault();
			ev.stopPropagation();
			return;
		}
	}
	// Clicked away: if currently editing a polyline, deselect it
	if (toolMode === 'editPolyline') {
		exitPolylineEditMode();
	}
});

// Delete button/menu logic
const btnDelete = document.getElementById('btn-delete') as HTMLButtonElement | null;
const deleteMenu = document.getElementById('delete-menu') as HTMLDivElement | null;
const btnDelCorridor = document.getElementById('btn-del-corridor') as HTMLButtonElement | null;
const btnDelSource = document.getElementById('btn-del-source') as HTMLButtonElement | null;

function showDeleteMenu(show: boolean) {
	if (!deleteMenu) return;
	if (show) deleteMenu.classList.remove('hidden');
	else deleteMenu.classList.add('hidden');
}
btnDelete?.addEventListener('click', (e: MouseEvent) => {
	e.stopPropagation();
	showDeleteMenu(deleteMenu?.classList.contains('hidden') ?? true);
});
document.addEventListener('click', () => showDeleteMenu(false));

function disposeNode(root: THREE.Object3D) {
	root.parent?.remove(root);
	root.traverse((obj: any) => {
		if (obj.isMesh) {
			if (obj.geometry) obj.geometry.dispose();
			const mat = obj.material as THREE.Material | THREE.Material[];
			if (Array.isArray(mat)) mat.forEach(m => m.dispose()); else mat?.dispose?.();
		}
	});
}

btnDelCorridor?.addEventListener('click', () => {
	if (!selectedCorridor) return;
	disposeNode(selectedCorridor.mesh);
	const idx = quickCorridors.indexOf(selectedCorridor);
	if (idx >= 0) quickCorridors.splice(idx, 1);
	selectCorridor(null);
	showDeleteMenu(false);
});

btnDelSource?.addEventListener('click', () => {
	if (!selectedCorridor) return;
	const src = selectedCorridor.sourcePolyline;
	if (!src) return;
	// Remove all corridors based on this source
	const toRemove = quickCorridors.filter(c => c.sourcePolyline === src);
	for (const c of toRemove) disposeNode(c.mesh);
	for (const c of toRemove) {
		const i = quickCorridors.indexOf(c);
		if (i >= 0) quickCorridors.splice(i, 1);
	}
	// Remove the source polyline object from scene and array
	const lineObj = src.getLineObject();
	scene.remove(lineObj);
	lineObj.geometry.dispose();
	(lineObj.material as THREE.Material).dispose();
	const pi = drapedPolylines.indexOf(src);
	if (pi >= 0) drapedPolylines.splice(pi, 1);
	selectCorridor(null);
	showDeleteMenu(false);
});

// Corridor right-click context menu on canvas
const corridorCtxMenu = document.getElementById('corridor-ctx-menu') as HTMLDivElement | null;
const ctxDelCorridor = document.getElementById('ctx-del-corridor') as HTMLButtonElement | null;
const ctxChangeTemplate = document.getElementById('ctx-change-template') as HTMLButtonElement | null;
let corridorCtxTarget: QuickCorridor | null = null;
function showCorridorCtxMenu(x: number, y: number, target: QuickCorridor) {
	if (!corridorCtxMenu) return;
	corridorCtxTarget = target;
	corridorCtxMenu.style.left = `${x}px`;
	corridorCtxMenu.style.top = `${y}px`;
	corridorCtxMenu.classList.remove('hidden');
}
function hideCorridorCtxMenu() {
	if (!corridorCtxMenu) return;
	corridorCtxMenu.classList.add('hidden');
	corridorCtxTarget = null;
}
document.addEventListener('click', () => hideCorridorCtxMenu());
ctxDelCorridor?.addEventListener('click', () => {
	if (!corridorCtxTarget) return;
	disposeNode(corridorCtxTarget.mesh);
	const idx = quickCorridors.indexOf(corridorCtxTarget);
	if (idx >= 0) quickCorridors.splice(idx, 1);
	if (selectedCorridor === corridorCtxTarget) selectCorridor(null);
	hideCorridorCtxMenu();
});

// Change template for an existing corridor via context menu
let templateChangeTarget: QuickCorridor | null = null;
ctxChangeTemplate?.addEventListener('click', () => {
	if (!corridorCtxTarget) return;
	templateChangeTarget = corridorCtxTarget;
	hideCorridorCtxMenu();
	// Preselect current template if found
	const idx = templates.indexOf(templateChangeTarget.template);
	selectedTemplateIndex = idx >= 0 ? idx : (selectedTemplateIndex ?? 0);
	renderTemplateList();
	templateOverlay.classList.remove('hidden');
});
// Coordinate HUD updater: show E/N/Z when hovering surface or road/daylight
raycaster.params.Line = { ...raycaster.params.Line, threshold: 0.5 };
renderer.domElement.addEventListener('mousemove', (ev: MouseEvent) => {
	mouse.x = (ev.clientX / renderer.domElement.clientWidth) * 2 - 1;
	mouse.y = -(ev.clientY / renderer.domElement.clientHeight) * 2 + 1;
	raycaster.setFromCamera(mouse, camera);

	const selectableMeshes = quickCorridors.map(c => c.mesh);
	const intersections = raycaster.intersectObjects([daylightMesh, corridorGroup, surface, ...selectableMeshes], true);
	const hit = intersections[0];
	if (hit && hit.point) {
		const p = hit.point;
		coordEl.textContent = `E: ${p.x.toFixed(2)}  N: ${p.y.toFixed(2)}  Z: ${p.z.toFixed(2)}`;
	} else {
		coordEl.textContent = 'E: —  N: —  Z: —';
	}
});

// Resize
window.addEventListener('resize', () => {
	const w = window.innerWidth, h = window.innerHeight;
	camera.aspect = w / h;
	camera.updateProjectionMatrix();
	renderer.setSize(w, h);
});

// Animate
function animate() {
	requestAnimationFrame(animate);
	controls.update();
	renderer.render(scene, camera);
}
animate();
// === End-Area Volume Computation (Two-IP roadway vs existing ground) ===
function computeCrossSectionAreaAt(pointOnCenter: THREE.Vector2, perpDir: THREE.Vector2, template: RoadTemplate, samples = 200): { cut: number; fill: number } {
	// Approximate area between design crossfall plane and existing ground along the normal within template half width
	const dir = perpDir.clone().normalize();
	const laneW = template.laneWidth;
	const half = laneW;
	const offsets: number[] = [];
	for (let i = 0; i < samples; i++) {
		const t = i / (samples - 1);
		offsets.push(-half + 2 * half * t);
	}
	// Compute center elevation from current vertical profile (parabolic if available)
	const pts = alignment.getPoints();
	const closest = alignment.closestPointTo(pointOnCenter.x, pointOnCenter.y);
	const gradeIPs = profileOverlay.getGradeProfile();
	const centerZ = (gradeIPs.length >= 2)
		? createParabolicEvaluator(gradeIPs).evalZ(closest.chainage)
		: (() => {
			const zStart = heightAt(pts[0].x, pts[0].y);
			const zEnd = heightAt(pts[pts.length - 1].x, pts[pts.length - 1].y);
			const totalLen = pts.reduce((acc, p, idx) => idx === 0 ? 0 : acc + p.distanceTo(pts[idx - 1]), 0) || 1;
			const tGrade = THREE.MathUtils.clamp(closest.chainage / totalLen, 0, 1);
			return THREE.MathUtils.lerp(zStart, zEnd, tGrade);
		})();
	const slopeAt = (offset: number) => (
		(Math.abs(offset) <= laneW ? template.crossfallLane : template.crossfallLane) * Math.sign(offset || 0)
	);
	let cut = 0, fill = 0;
	for (let i = 0; i < offsets.length - 1; i++) {
		const s0 = offsets[i];
		const s1 = offsets[i + 1];
		const oMid = 0.5 * (s0 + s1);
		const xMid = pointOnCenter.x + dir.x * oMid;
		const yMid = pointOnCenter.y + dir.y * oMid;
		const zSurf = heightAt(xMid, yMid);
		const zDesign = centerZ + slopeAt(oMid) * oMid;
		const dz = zDesign - zSurf;
		const stripWidth = (s1 - s0);
		const area = dz * stripWidth; // signed area slice (m^2)
		if (area > 0) fill += area; else cut += -area;
	}
	return { cut, fill };
}

function computeVolumesEndArea(): { cut: number; fill: number } {
	const pts = alignment.getPoints();
	if (pts.length < 2) return { cut: 0, fill: 0 };
	let totalCut = 0;
	let totalFill = 0;
	for (let i = 0; i < pts.length - 1; i++) {
		const a = pts[i];
		const b = pts[i + 1];
		const segLen = a.distanceTo(b);
		if (segLen <= 1e-6) continue;
		const tan = new THREE.Vector2().subVectors(b, a).normalize();
		const perp = new THREE.Vector2(-tan.y, tan.x).normalize();
		const areaA = computeCrossSectionAreaAt(a, perp, roadTemplate);
		const areaB = computeCrossSectionAreaAt(b, perp, roadTemplate);
		// Trapezoidal: V = L/2 * (A1 + A2)
		const cutVol = segLen * 0.5 * (areaA.cut + areaB.cut);
		const fillVol = segLen * 0.5 * (areaA.fill + areaB.fill);
		totalCut += cutVol;
		totalFill += fillVol;
	}
	return { cut: totalCut, fill: totalFill };
}

function updateVolumesHUD() {
	const v = computeVolumesEndArea();
	if (volumeEl) volumeEl.textContent = `Cut: ${v.cut.toFixed(1)} m³  Fill: ${v.fill.toFixed(1)} m³`;
}

// Initial compute
updateVolumesHUD();


